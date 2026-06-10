import crypto from 'node:crypto';
import Fastify from 'fastify';
import mqtt from 'mqtt';

const requiredEnv = [
  'MQTT_CLIENT_HOST',
  'MQTT_CLIENT_PORT',
  'MQTT_CLIENT_DOMAIN_BASE_URL',
  'MQTT_CLIENT_TUNEL_SERVICE_BASE_URL',
  'MQTT_HOST',
  'MQTT_PORT',
  'MQTT_USERNAME',
  'MQTT_PASSWORD',
  'MQTT_BASE_TOPIC',
  'MQTT_CLIENT_ID_PREFIX',
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Falta variable obligatoria ${key}`);
  }
}

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

const baseTopic = process.env.MQTT_BASE_TOPIC.replace(/\/$/, '');
const inboundTopics = {
  loginRequest: `${baseTopic}/android/in/auth/login/request`,
  historyRequest: `${baseTopic}/android/in/history/request`,
  closeManagerWebSessionRequest: `${baseTopic}/android/in/system/web-session/close/request`,
  webEntrypointRequest: `${baseTopic}/android/in/system/web-entrypoint/request`,
};

let brokerConnected = false;
let activeMobileSession = null;
const currentFragmentHashes = new Map();
const currentFragmentRefreshQueue = new Set();
let currentFragmentRefreshTimer = null;

const CURRENT_FRAGMENT_KEYS = {
  dashboardMetrics: 'dashboard.metrics',
  dashboardRevenue: 'dashboard.revenue',
  queuePendienteConsultas: 'queue.pendiente.consultas',
  queueAtendidoConsultas: 'queue.atendido.consultas',
  queuePendientePedidosCocina: 'queue.pendiente.pedidosCocina',
  queueAtendidoPedidosCocina: 'queue.atendido.pedidosCocina',
  queuePendienteLlamadosMozo: 'queue.pendiente.llamadosMozo',
  queueAtendidoLlamadosMozo: 'queue.atendido.llamadosMozo',
};

const ALL_CURRENT_FRAGMENT_KEYS = Object.values(CURRENT_FRAGMENT_KEYS);

const brokerClient = mqtt.connect({
  protocol: 'mqtts',
  host: process.env.MQTT_HOST,
  port: Number.parseInt(process.env.MQTT_PORT, 10),
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `${process.env.MQTT_CLIENT_ID_PREFIX}-mqtt-client-${crypto.randomUUID()}`,
  connectTimeout: 15_000,
  reconnectPeriod: 5_000,
  clean: true,
});

const domainEventReconnectDelayMs = 5_000;
const tunnelEntrypointRetryDelayMs = 500;
const tunnelEntrypointMaxWaitMs = 10_000;
let domainEventStreamConnected = false;
let domainEventReconnectTimer = null;
let domainEventAbortController = null;

function getDomainUrl(pathname) {
  return new URL(pathname, process.env.MQTT_CLIENT_DOMAIN_BASE_URL);
}

function getDomainEventsUrl() {
  return new URL('/internal/events/stream', process.env.MQTT_CLIENT_DOMAIN_BASE_URL);
}

function getTunnelServiceUrl(pathname) {
  return new URL(pathname, process.env.MQTT_CLIENT_TUNEL_SERVICE_BASE_URL);
}

function buildPublicEntrypointUrl(publicUrl, pathname) {
  if (!publicUrl) {
    return null;
  }

  return new URL(pathname, publicUrl).toString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildOutboundTopics(deviceId) {
  const deviceRoot = `${baseTopic}/android/out/${deviceId}`;

  return {
    loginResponse: `${deviceRoot}/auth/login/response`,
    currentDashboardMetrics: `${deviceRoot}/current/dashboard/metrics`,
    currentDashboardRevenue: `${deviceRoot}/current/dashboard/revenue`,
    currentQueue: (statusBucket, queueType) => `${deviceRoot}/current/queue/${statusBucket}/${queueType}`,
    historyMeta: (requestId) => `${deviceRoot}/history/${requestId}/meta`,
    historyDashboardMetrics: (requestId) => `${deviceRoot}/history/${requestId}/dashboard/metrics`,
    historyDashboardRevenue: (requestId) => `${deviceRoot}/history/${requestId}/dashboard/revenue`,
    historyQueue: (requestId, queueType) => `${deviceRoot}/history/${requestId}/queue/${queueType}`,
    historyComplete: (requestId) => `${deviceRoot}/history/${requestId}/complete`,
    systemWebSessionClosed: `${deviceRoot}/system/web-session/closed`,
    systemWebSessionCloseRejected: `${deviceRoot}/system/web-session/close-rejected`,
    systemWebEntrypointCurrent: `${deviceRoot}/system/web-entrypoint/current`,
  };
}

function buildCurrentFragmentDefinition(fragmentKey, deviceId) {
  const topics = buildOutboundTopics(deviceId);

  switch (fragmentKey) {
    case CURRENT_FRAGMENT_KEYS.dashboardMetrics:
      return {
        topic: topics.currentDashboardMetrics,
        pathname: '/internal/mobile/current/dashboard/metrics',
      };
    case CURRENT_FRAGMENT_KEYS.dashboardRevenue:
      return {
        topic: topics.currentDashboardRevenue,
        pathname: '/internal/mobile/current/dashboard/revenue',
      };
    case CURRENT_FRAGMENT_KEYS.queuePendienteConsultas:
      return {
        topic: topics.currentQueue('pendientes', 'consultas'),
        pathname: '/internal/mobile/current/queues/pendiente/consultas',
      };
    case CURRENT_FRAGMENT_KEYS.queueAtendidoConsultas:
      return {
        topic: topics.currentQueue('atendidos', 'consultas'),
        pathname: '/internal/mobile/current/queues/atendido/consultas',
      };
    case CURRENT_FRAGMENT_KEYS.queuePendientePedidosCocina:
      return {
        topic: topics.currentQueue('pendientes', 'pedidos-cocina'),
        pathname: '/internal/mobile/current/queues/pendiente/pedidosCocina',
      };
    case CURRENT_FRAGMENT_KEYS.queueAtendidoPedidosCocina:
      return {
        topic: topics.currentQueue('atendidos', 'pedidos-cocina'),
        pathname: '/internal/mobile/current/queues/atendido/pedidosCocina',
      };
    case CURRENT_FRAGMENT_KEYS.queuePendienteLlamadosMozo:
      return {
        topic: topics.currentQueue('pendientes', 'llamados-mozo'),
        pathname: '/internal/mobile/current/queues/pendiente/llamadosMozo',
      };
    case CURRENT_FRAGMENT_KEYS.queueAtendidoLlamadosMozo:
      return {
        topic: topics.currentQueue('atendidos', 'llamados-mozo'),
        pathname: '/internal/mobile/current/queues/atendido/llamadosMozo',
      };
    default:
      throw new Error(`Fragmento actual desconocido: ${fragmentKey}`);
  }
}

function uniqueFragmentKeys(fragmentKeys) {
  return Array.from(new Set(fragmentKeys.filter(Boolean)));
}

function withDeviceContext(payload, deviceId) {
  return {
    ...payload,
    deviceId,
  };
}

async function callDomain(pathname, options = {}) {
  const response = await fetch(getDomainUrl(pathname), {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload?.error ?? 'El dominio rechazo la solicitud del cliente MQTT');
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function readTunnelState({ requestId = null, deviceId = null } = {}) {
  const deadline = Date.now() + tunnelEntrypointMaxWaitMs;
  let lastPayload = null;
  let lastError = null;
  let attempt = 0;

  while (Date.now() <= deadline) {
    attempt += 1;
    try {
      app.log.info(
        { requestId, deviceId, attempt },
        'mqtt-client consulta URL efimera a tunel-service',
      );
      const response = await fetch(getTunnelServiceUrl('/entrypoint'));
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? 'El tunel-service rechazo la consulta de URL efimera');
      }

      lastPayload = payload;
      app.log.info(
        {
          requestId,
          deviceId,
          attempt,
          ready: Boolean(payload.ready),
          publicUrl: payload.publicUrl ?? null,
          lastError: payload.lastError ?? null,
        },
        'mqtt-client recibio estado de tunel-service',
      );
      if (payload.ready && payload.publicUrl) {
        return payload;
      }
    } catch (error) {
      lastError = error;
      app.log.warn(
        {
          requestId,
          deviceId,
          attempt,
          error: error.message,
        },
        'mqtt-client no pudo consultar tunel-service',
      );
    }

    await sleep(tunnelEntrypointRetryDelayMs);
  }

  if (lastPayload) {
    app.log.warn(
      {
        requestId,
        deviceId,
        ready: Boolean(lastPayload.ready),
        publicUrl: lastPayload.publicUrl ?? null,
        lastError: lastPayload.lastError ?? null,
      },
      'mqtt-client agoto espera de URL efimera y usara ultimo estado conocido',
    );
    return lastPayload;
  }

  throw lastError ?? new Error('tunel-service no entrego URL efimera vigente');
}

function parseJsonPayload(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('El payload MQTT no es JSON valido');
  }
}

function createPayloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildRejectedLogin(requestId, deviceId, reason) {
  return {
    type: 'login_response',
    requestId,
    deviceId,
    accepted: false,
    reason,
    generatedAt: new Date().toISOString(),
  };
}

async function publishJson(topic, payload) {
  if (!brokerConnected) {
    throw new Error('El cliente MQTT no esta conectado al broker');
  }

  app.log.info(
    {
      topic,
      type: payload?.type ?? null,
      requestId: payload?.requestId ?? null,
      deviceId: payload?.deviceId ?? null,
    },
    'mqtt-client publica payload MQTT',
  );

  await brokerClient.publishAsync(topic, JSON.stringify(payload), {
    qos: 1,
  });
}

function ensureActiveMobileSession(deviceId) {
  if (!activeMobileSession) {
    throw new Error('No hay un encargado movil autenticado');
  }

  if (activeMobileSession.deviceId !== deviceId) {
    throw new Error('El dispositivo no coincide con la sesion movil activa');
  }
}

async function fetchCurrentFragment(fragmentKey) {
  if (!activeMobileSession) {
    return null;
  }

  const definition = buildCurrentFragmentDefinition(fragmentKey, activeMobileSession.deviceId);
  const payload = await callDomain(definition.pathname);

  return {
    topic: definition.topic,
    payload: withDeviceContext(payload, activeMobileSession.deviceId),
  };
}

async function publishCurrentFragment(fragmentKey, force = false) {
  const fragment = await fetchCurrentFragment(fragmentKey);

  if (!fragment) {
    return;
  }

  const nextHash = createPayloadHash(fragment.payload);
  const previousHash = currentFragmentHashes.get(fragment.topic);

  if (force || nextHash !== previousHash) {
    await publishJson(fragment.topic, fragment.payload);
    currentFragmentHashes.set(fragment.topic, nextHash);
  }
}

async function publishCurrentFragments(fragmentKeys, reason, force = false) {
  if (!activeMobileSession) {
    return;
  }

  for (const fragmentKey of uniqueFragmentKeys(fragmentKeys)) {
    await publishCurrentFragment(fragmentKey, force);
  }

  if (reason === 'login') {
    app.log.info({ deviceId: activeMobileSession.deviceId }, 'Estado actual fragmentado publicado luego del login MQTT');
  }
}

function scheduleCurrentFragmentRefresh(fragmentKeys, reason) {
  if (!activeMobileSession) {
    return;
  }

  for (const fragmentKey of uniqueFragmentKeys(fragmentKeys)) {
    currentFragmentRefreshQueue.add(fragmentKey);
  }

  if (currentFragmentRefreshTimer) {
    return;
  }

  currentFragmentRefreshTimer = setTimeout(() => {
    const nextBatch = Array.from(currentFragmentRefreshQueue);
    currentFragmentRefreshQueue.clear();
    currentFragmentRefreshTimer = null;

    publishCurrentFragments(nextBatch, reason, false).catch((error) => {
      app.log.error(error);
    });
  }, 250);
}

function buildHistoryFragments(dataset, deviceId, requestId) {
  const topics = buildOutboundTopics(deviceId);
  const fragmentBase = {
    deviceId,
    requestId,
    generatedAt: dataset.generatedAt,
    scope: 'history',
    fromUtc: dataset.requestedRange.fromUtc,
    toUtc: dataset.requestedRange.toUtc,
  };

  return [
    {
      topic: topics.historyMeta(requestId),
      payload: {
        ...fragmentBase,
        type: 'history_meta',
      },
    },
    {
      topic: topics.historyDashboardMetrics(requestId),
      payload: {
        ...fragmentBase,
        type: 'history_dashboard_metrics',
        metrics: dataset.dashboard.colas,
      },
    },
    {
      topic: topics.historyDashboardRevenue(requestId),
      payload: {
        ...fragmentBase,
        type: 'history_dashboard_revenue',
        totalArsCentavos: dataset.dashboard.dineroTotalJornadaArsCentavos,
        items: dataset.dashboard.dineroPorMesa,
      },
    },
    {
      topic: topics.historyQueue(requestId, 'consultas'),
      payload: {
        ...fragmentBase,
        type: 'history_queue_fragment',
        queueType: 'consultas',
        items: dataset.colas.consultas ?? [],
      },
    },
    {
      topic: topics.historyQueue(requestId, 'pedidos-cocina'),
      payload: {
        ...fragmentBase,
        type: 'history_queue_fragment',
        queueType: 'pedidosCocina',
        items: dataset.colas.pedidosCocina ?? [],
      },
    },
    {
      topic: topics.historyQueue(requestId, 'llamados-mozo'),
      payload: {
        ...fragmentBase,
        type: 'history_queue_fragment',
        queueType: 'llamadosMozo',
        items: dataset.colas.llamadosMozo ?? [],
      },
    },
    {
      topic: topics.historyComplete(requestId),
      payload: {
        ...fragmentBase,
        type: 'history_complete',
        ok: true,
      },
    },
  ];
}

async function publishCurrentState(reason, forceAll = false) {
  await publishCurrentFragments(ALL_CURRENT_FRAGMENT_KEYS, reason, forceAll);
}

async function publishHistoryState(requestId, deviceId, historyPayload) {
  const fragments = buildHistoryFragments(historyPayload, deviceId, requestId);

  for (const fragment of fragments) {
    await publishJson(fragment.topic, fragment.payload);
  }
}

async function publishHistoryError(requestId, deviceId, errorMessage, range) {
  const topics = buildOutboundTopics(deviceId);

  await publishJson(topics.historyComplete(requestId), {
    type: 'history_complete',
    deviceId,
    requestId,
    scope: 'history',
    generatedAt: new Date().toISOString(),
    fromUtc: range?.fromUtc ?? '',
    toUtc: range?.toUtc ?? '',
    error: errorMessage,
  });
}

async function handleLoginRequest(payload) {
  const requestId = payload.requestId ?? null;
  const deviceId = payload.deviceId?.trim() ?? '';

  app.log.info(
    { requestId, deviceId },
    'mqtt-client recibio request MQTT de login Android',
  );

  if (!requestId || !deviceId) {
    if (deviceId) {
      const topics = buildOutboundTopics(deviceId);
      await publishJson(
        topics.loginResponse,
        buildRejectedLogin(requestId, deviceId, 'Faltan requestId o deviceId'),
      );
    }
    return;
  }

  const topics = buildOutboundTopics(deviceId);

  if (activeMobileSession && activeMobileSession.deviceId !== deviceId) {
    await publishJson(
      topics.loginResponse,
      buildRejectedLogin(
        requestId,
        deviceId,
        'Ya existe otro encargado movil conectado. Debes cerrar esa sesion antes de ingresar.',
      ),
    );
    return;
  }

  try {
    const identity = await callDomain('/internal/mobile/auth/manager-login', {
      method: 'POST',
      body: JSON.stringify({
        username: payload.username ?? null,
        password: payload.password ?? null,
      }),
    });

    activeMobileSession = {
      deviceId,
      actorNombre: identity.actorNombre,
      role: identity.role,
      connectedAt: new Date().toISOString(),
      lastRequestAt: new Date().toISOString(),
    };
    app.log.info(
      {
        requestId,
        deviceId,
        actorNombre: identity.actorNombre,
        role: identity.role,
      },
      'mqtt-client activo sesion movil',
    );
    currentFragmentHashes.clear();

    await publishJson(topics.loginResponse, {
      type: 'login_response',
      requestId,
      deviceId,
      accepted: true,
      actorNombre: identity.actorNombre,
      role: identity.role,
      generatedAt: new Date().toISOString(),
    });

    await publishCurrentState('login', true);
  } catch (error) {
    app.log.warn(
      { requestId, deviceId, error: error.message },
      'mqtt-client rechazo login Android',
    );
    await publishJson(
      topics.loginResponse,
      buildRejectedLogin(requestId, deviceId, error.message),
    );
  }
}

async function handleHistoryRequest(payload) {
  const requestId = payload.requestId ?? null;
  const deviceId = payload.deviceId?.trim() ?? '';
  const range = {
    fromUtc: payload.fromUtc ?? '',
    toUtc: payload.toUtc ?? '',
  };

  try {
    if (!requestId || !deviceId) {
      throw new Error('Faltan requestId o deviceId');
    }

    ensureActiveMobileSession(deviceId);
    activeMobileSession.lastRequestAt = new Date().toISOString();

    const historyPayload = await callDomain('/internal/mobile/history', {
      method: 'POST',
      body: JSON.stringify(range),
    });

    await publishHistoryState(requestId, deviceId, historyPayload);
  } catch (error) {
    if (requestId && deviceId) {
      await publishHistoryError(requestId, deviceId, error.message, range);
    }
  }
}

async function handleCloseManagerWebSession(payload) {
  const requestId = payload.requestId ?? null;
  const deviceId = payload.deviceId?.trim() ?? '';

  if (!requestId || !deviceId) {
    return;
  }

  const topics = buildOutboundTopics(deviceId);

  try {
    ensureActiveMobileSession(deviceId);
    activeMobileSession.lastRequestAt = new Date().toISOString();

    await callDomain('/internal/mobile/manager-web-session/close', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (error) {
    await publishJson(topics.systemWebSessionCloseRejected, {
      type: 'manager_web_session_close_rejected',
      requestId,
      deviceId,
      error: error.message,
      generatedAt: new Date().toISOString(),
    });
  }
}

async function handleWebEntrypointRequest(payload) {
  const requestId = payload.requestId ?? null;
  const deviceId = payload.deviceId?.trim() ?? '';

  app.log.info(
    {
      requestId,
      deviceId,
      hasActiveMobileSession: Boolean(activeMobileSession),
      activeMobileSessionDeviceId: activeMobileSession?.deviceId ?? null,
    },
    'mqtt-client recibio request MQTT de URL efimera',
  );

  if (!requestId || !deviceId) {
    app.log.warn(
      { requestId, deviceId },
      'mqtt-client ignora request de URL efimera por payload incompleto',
    );
    return;
  }

  const topics = buildOutboundTopics(deviceId);

  try {
    ensureActiveMobileSession(deviceId);
    activeMobileSession.lastRequestAt = new Date().toISOString();
    app.log.info(
      { requestId, deviceId },
      'mqtt-client valido sesion movil activa para URL efimera',
    );
    const tunnelState = await readTunnelState({ requestId, deviceId });
    const publicManagementUrl = buildPublicEntrypointUrl(tunnelState.publicUrl, '/gestion');

    await publishJson(topics.systemWebEntrypointCurrent, {
      type: 'web_entrypoint_current',
      requestId,
      deviceId,
      generatedAt: new Date().toISOString(),
      ready: Boolean(tunnelState.ready && tunnelState.publicUrl),
      publicUrl: tunnelState.publicUrl ?? null,
      publicManagementUrl,
      error: tunnelState.ready && tunnelState.publicUrl
        ? null
        : tunnelState.lastError ?? 'tunel-service aun no conoce una URL efimera vigente',
      source: 'tunel-service:/entrypoint',
    });
    app.log.info(
      {
        requestId,
        deviceId,
        outboundTopic: topics.systemWebEntrypointCurrent,
        ready: Boolean(tunnelState.ready && tunnelState.publicUrl),
        publicUrl: tunnelState.publicUrl ?? null,
        publicManagementUrl,
      },
      'mqtt-client publico URL efimera vigente hacia Android',
    );
  } catch (error) {
    app.log.error(
      {
        requestId,
        deviceId,
        outboundTopic: topics.systemWebEntrypointCurrent,
        error: error.message,
      },
      'mqtt-client fallo resolviendo URL efimera para Android',
    );
    await publishJson(topics.systemWebEntrypointCurrent, {
      type: 'web_entrypoint_current',
      requestId,
      deviceId,
      generatedAt: new Date().toISOString(),
      ready: false,
      publicUrl: null,
      publicManagementUrl: null,
      error: error.message,
      source: 'tunel-service:/entrypoint',
    });
  }
}

async function handleIncomingMessage(topic, buffer) {
  const payload = parseJsonPayload(buffer);

  if (topic === inboundTopics.loginRequest) {
    await handleLoginRequest(payload);
    return;
  }

  if (topic === inboundTopics.historyRequest) {
    await handleHistoryRequest(payload);
    return;
  }

  if (topic === inboundTopics.closeManagerWebSessionRequest) {
    await handleCloseManagerWebSession(payload);
    return;
  }

  if (topic === inboundTopics.webEntrypointRequest) {
    await handleWebEntrypointRequest(payload);
  }
}

async function publishManagerWebSessionEvent(eventPayload) {
  if (!activeMobileSession) {
    return;
  }

  const topics = buildOutboundTopics(activeMobileSession.deviceId);

  if (eventPayload.event === 'closed') {
    await publishJson(topics.systemWebSessionClosed, {
      type: 'manager_web_session_closed',
      deviceId: activeMobileSession.deviceId,
      generatedAt: eventPayload.emittedAt ?? new Date().toISOString(),
      reason: eventPayload.reason ?? 'desconocida',
      actorNombre: eventPayload.actorNombre ?? null,
    });
  }
}

function handleDomainNotification(message) {
  let payload;

  try {
    payload = JSON.parse(message);
  } catch (error) {
    app.log.warn({ message }, 'Se ignoro una notificacion de dominio invalida');
    return;
  }

  if (payload.type === 'mobile_current_refresh') {
    const fragments = Array.isArray(payload.fragments) ? payload.fragments : [];
    scheduleCurrentFragmentRefresh(fragments.length > 0 ? fragments : ALL_CURRENT_FRAGMENT_KEYS, payload.reason ?? 'domain');
    return;
  }

  if (payload.type === 'manager_web_session') {
    publishManagerWebSessionEvent(payload).catch((error) => {
      app.log.error(error);
    });
  }
}

function parseSseMessages(chunkBuffer) {
  const messages = [];
  let remaining = chunkBuffer;

  while (true) {
    const separatorIndex = remaining.indexOf('\n\n');
    if (separatorIndex < 0) {
      break;
    }

    const rawMessage = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);

    const data = rawMessage
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');

    if (data) {
      messages.push(data);
    }
  }

  return {
    messages,
    remaining,
  };
}

function scheduleDomainEventReconnect(reason) {
  domainEventStreamConnected = false;

  if (domainEventReconnectTimer) {
    return;
  }

  app.log.warn({ reason }, 'Se reintentara la conexion al stream interno de eventos del domain');
  domainEventReconnectTimer = setTimeout(() => {
    domainEventReconnectTimer = null;
    startDomainEventStream().catch((error) => {
      app.log.error(error);
      scheduleDomainEventReconnect('error-en-reconexion');
    });
  }, domainEventReconnectDelayMs);
}

async function startDomainEventStream() {
  if (domainEventAbortController) {
    return;
  }

  const abortController = new AbortController();
  domainEventAbortController = abortController;

  try {
    const response = await fetch(getDomainEventsUrl(), {
      headers: {
        Accept: 'text/event-stream',
      },
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error('El domain rechazo el stream interno de eventos del cliente MQTT');
    }

    domainEventStreamConnected = true;
    app.log.info('Publicador MQTT conectado al stream interno de eventos del domain');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pendingChunk = '';

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        throw new Error('El stream interno de eventos del domain se cerro');
      }

      pendingChunk += decoder.decode(value, { stream: true });
      const parsed = parseSseMessages(pendingChunk);
      pendingChunk = parsed.remaining;

      for (const message of parsed.messages) {
        handleDomainNotification(message);
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      app.log.warn(
        { error: error.message, retryDelayMs: domainEventReconnectDelayMs },
        'Se perdio la conexion al stream interno de eventos del domain',
      );
      scheduleDomainEventReconnect('domain-event-stream-closed');
    }
  } finally {
    domainEventStreamConnected = false;
    if (domainEventAbortController === abortController) {
      domainEventAbortController = null;
    }
  }
}

brokerClient.on('connect', async () => {
  brokerConnected = true;
  app.log.info('Broker MQTT conectado');
  await brokerClient.subscribeAsync(
    [
      inboundTopics.loginRequest,
      inboundTopics.historyRequest,
      inboundTopics.closeManagerWebSessionRequest,
      inboundTopics.webEntrypointRequest,
    ],
    {
      qos: 1,
    },
  );
});

brokerClient.on('reconnect', () => {
  app.log.warn('Reconectando al broker MQTT');
});

brokerClient.on('close', () => {
  brokerConnected = false;
  app.log.warn('Conexion MQTT cerrada');
});

brokerClient.on('error', (error) => {
  app.log.error(error);
});

brokerClient.on('message', (topic, buffer) => {
  app.log.info(
    {
      topic,
      payloadBytes: buffer.length,
    },
    'mqtt-client recibio mensaje MQTT',
  );
  handleIncomingMessage(topic, buffer).catch((error) => {
    app.log.error(error);
  });
});

app.get('/health', async () => ({
  service: 'mqtt-client',
  status: 'ok',
  brokerHost: process.env.MQTT_HOST,
  brokerPort: Number.parseInt(process.env.MQTT_PORT, 10),
  brokerConnected,
  domainEventStreamConnected,
}));

app.get('/topics', async () => ({
  baseTopic,
  inboundTopics,
  outboundTopicExamples: activeMobileSession
    ? buildOutboundTopics(activeMobileSession.deviceId)
    : buildOutboundTopics('{deviceId}'),
}));

app.get('/state', async () => ({
  brokerConnected,
  activeMobileSession,
  currentFragmentTopicCount: currentFragmentHashes.size,
  currentFragmentQueueSize: currentFragmentRefreshQueue.size,
}));

await app.listen({
  host: process.env.MQTT_CLIENT_HOST,
  port: Number.parseInt(process.env.MQTT_CLIENT_PORT, 10),
});

startDomainEventStream().catch((error) => {
  app.log.error(error);
  scheduleDomainEventReconnect('error-en-arranque');
});
