import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { createReadStream } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

const requiredEnv = [
  'HTTP_GW_HOST',
  'HTTP_GW_PORT',
  'HTTP_GW_DOMAIN_BASE_URL',
  'TUNEL_SERVICE_BASE_URL',
  'MENU_ASSETS_DIR',
  'BUSINESS_TIMEZONE',
  'MQTT_BASE_TOPIC',
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

const mesaEventSubscribers = new Map();
const internalPanelSubscribers = new Set();
const mesaRefreshTimers = new Map();
const heartbeatIntervalMs = 8_000;
const domainEventReconnectDelayMs = 5_000;

let domainEventStreamConnected = false;
let domainEventReconnectTimer = null;
let domainEventAbortController = null;
const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? 'restobar_web_session';
const publicAssetsDir = path.dirname(process.env.MENU_ASSETS_DIR);
const restaurantIconFileName = 'resto_icon.png';

function buildAllowedLocalOrigins() {
  const ports = [
    process.env.WEB_CARTA_PORT,
    process.env.WEB_GESTION_PORT,
  ].filter(Boolean);

  return ports.flatMap((port) => [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
}

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowedOrigins = new Set([
      ...buildAllowedLocalOrigins(),
      process.env.CLOUDFLARE_PUBLIC_CLIENT_URL,
    ].filter(Boolean));

    callback(null, allowedOrigins.has(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
await app.register(websocket);
function getDomainUrl(pathname, searchParams = null) {
  const url = new URL(pathname, process.env.HTTP_GW_DOMAIN_BASE_URL);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }
  return url;
}

function getDomainEventsUrl() {
  return new URL('/internal/events/stream', process.env.HTTP_GW_DOMAIN_BASE_URL);
}

function getTunnelServiceUrl(pathname) {
  return new URL(pathname, process.env.TUNEL_SERVICE_BASE_URL);
}

function buildPublicEntrypointUrl(baseUrl, pathname) {
  if (!baseUrl) {
    return null;
  }

  return new URL(pathname, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

function getAuthorizationHeader(request) {
  const authorization = request.headers.authorization ?? '';
  return authorization.startsWith('Bearer ') ? authorization : null;
}

function parseCookies(cookieHeader) {
  const cookies = {};

  for (const chunk of String(cookieHeader ?? '').split(';')) {
    const separatorIndex = chunk.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = chunk.slice(0, separatorIndex).trim();
    const rawValue = chunk.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }

  return cookies;
}

function getSessionTokenValue(value) {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? null : normalized;
}

function getSessionTokenFromRequest(request) {
  const bearerToken = getAuthorizationHeader(request);
  if (bearerToken) {
    return getSessionTokenValue(bearerToken.slice('Bearer '.length));
  }

  const cookies = parseCookies(request.headers.cookie ?? '');
  return getSessionTokenValue(cookies[sessionCookieName] ?? null);
}

function buildDomainSessionHeaders(request) {
  const sessionToken = getSessionTokenFromRequest(request);

  if (!sessionToken) {
    return {};
  }

  return {
    Authorization: `Bearer ${sessionToken}`,
  };
}

function buildSessionCookieHeader(sessionToken) {
  return [
    `${sessionCookieName}=${encodeURIComponent(sessionToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ].join('; ');
}

function buildExpiredSessionCookieHeader() {
  return [
    `${sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

function sanitizeSessionPayload(session) {
  if (!session) {
    return session;
  }

  const { sessionToken, ...safeSession } = session;
  return safeSession;
}

function getMenuAssetPath(fileName) {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    const error = new Error('El nombre del asset del menu es invalido');
    error.statusCode = 400;
    throw error;
  }

  return path.join(process.env.MENU_ASSETS_DIR, fileName);
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value ?? '').trim());
}

function getContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function registerMesaSubscriber(mesaNumero, subscriber) {
  const key = String(mesaNumero);
  const subscribers = mesaEventSubscribers.get(key) ?? new Set();
  subscribers.add(subscriber);
  mesaEventSubscribers.set(key, subscribers);
}

function unregisterMesaSubscriber(mesaNumero, subscriber) {
  const key = String(mesaNumero);
  const subscribers = mesaEventSubscribers.get(key);

  if (!subscribers) {
    return;
  }

  subscribers.delete(subscriber);

  if (subscribers.size === 0) {
    mesaEventSubscribers.delete(key);
  }
}

function getMesaSubscribers(mesaNumero) {
  return Array.from(mesaEventSubscribers.get(String(mesaNumero)) ?? []);
}

function registerInternalPanelSubscriber(subscriber) {
  internalPanelSubscribers.add(subscriber);
}

function unregisterInternalPanelSubscriber(subscriber) {
  internalPanelSubscribers.delete(subscriber);
}

function broadcastInternalDomainEvent(payload) {
  const serializedPayload = JSON.stringify({
    type: 'domain_event',
    payload,
  });

  for (const subscriber of internalPanelSubscribers) {
    if (subscriber.socket.readyState !== 1) {
      continue;
    }

    subscriber.socket.send(serializedPayload);
  }
}

async function publishSnapshotToSubscriber(subscriber) {
  try {
    const payload = await callDomain(
      `/internal/public/mesas/${encodePathSegment(subscriber.mesaNumero)}/state`,
      {},
      { clientSessionId: subscriber.clientSessionId },
    );
    const serializedPayload = JSON.stringify(payload);

    if (serializedPayload !== subscriber.lastPayload) {
      if (subscriber.socket.readyState !== 1) {
        return;
      }

      subscriber.socket.send(JSON.stringify({
        type: 'mesa_state',
        payload,
      }));
      subscriber.lastPayload = serializedPayload;
    }
  } catch (error) {
    if (subscriber.socket.readyState !== 1) {
      return;
    }

    subscriber.socket.send(JSON.stringify({
      type: 'session_error',
      error: error.message,
    }));
  }
}

function scheduleMesaSubscribersRefresh(mesaNumero) {
  const key = String(mesaNumero);

  if (mesaRefreshTimers.has(key)) {
    return;
  }

  mesaRefreshTimers.set(key, setTimeout(async () => {
    mesaRefreshTimers.delete(key);
    const subscribers = getMesaSubscribers(mesaNumero);
    await Promise.all(subscribers.map((subscriber) => publishSnapshotToSubscriber(subscriber)));
  }, 120));
}

function scheduleAllMesaSubscribersRefresh() {
  for (const mesaNumero of mesaEventSubscribers.keys()) {
    scheduleMesaSubscribersRefresh(mesaNumero);
  }
}

function handleDomainNotification(message) {
  let payload;

  try {
    payload = JSON.parse(message);
  } catch {
  app.log.warn({ message }, 'Se ignoro una notificacion de dominio invalida en http-gw');
    return;
  }

  if (payload.type === 'mesa_public_refresh' && payload.mesaNumero) {
    scheduleMesaSubscribersRefresh(payload.mesaNumero);
  } else if (payload.type === 'mesa_public_refresh_all') {
    scheduleAllMesaSubscribersRefresh();
  }

  broadcastInternalDomainEvent(payload);
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
      scheduleDomainEventReconnect('error-en-reconexion-http-gw');
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
      throw new Error('El domain rechazo el stream interno de eventos de http-gw');
    }

    domainEventStreamConnected = true;
    app.log.info('Gateway conectado al stream interno de eventos del domain');

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

async function callDomain(pathname, options = {}, searchParams = null) {
  const response = await fetch(getDomainUrl(pathname, searchParams), {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error ?? 'El servicio de dominio rechazo la solicitud';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function callTunnelService(pathname) {
  const response = await fetch(getTunnelServiceUrl(pathname), {
    signal: AbortSignal.timeout(4_000),
  });
  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error ?? 'El tunel-service rechazo la solicitud';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function readTunnelState() {
  try {
    const tunnelState = await callTunnelService('/entrypoint');

    return {
      ...tunnelState,
      publicUrl: buildPublicEntrypointUrl(tunnelState.publicUrl, '/carta'),
    };
  } catch (error) {
    return {
      service: 'tunel-service',
      ready: false,
      publicUrl: null,
      startedAt: null,
      lastOutputAt: null,
      lastError: error.message,
      source: 'tunel-service-unavailable',
    };
  }
}

async function requireInternalSession(request, allowedRoles) {
  const session = await callDomain(
    '/internal/auth/session',
    {
      headers: buildDomainSessionHeaders(request),
    },
  );

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
    const error = new Error('La sesion interna no tiene permisos para esta operacion');
    error.statusCode = 403;
    throw error;
  }

  return session;
}

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if ((error.statusCode ?? 500) === 401 && request.url.startsWith('/api/internal/')) {
    reply.header('Set-Cookie', buildExpiredSessionCookieHeader());
  }
  reply.code(error.statusCode ?? 500).send({
    error: error.message ?? 'Ocurrio un error interno en http-gw',
  });
});

app.get('/health', async () => ({
  service: 'http-gw',
  status: 'ok',
  businessTimezone: process.env.BUSINESS_TIMEZONE,
  domainEventStreamConnected,
}));

app.get('/assets/menu/:fileName', async (request, reply) => {
  const fileName = request.params.fileName;
  const filePath = getMenuAssetPath(fileName);

  try {
    await access(filePath);
  } catch {
    reply.code(404).send({
      error: 'El asset del menu no existe',
    });
    return reply;
  }

  reply.header('Cache-Control', 'public, max-age=300');
  reply.type(getContentType(fileName));
  return reply.send(createReadStream(filePath));
});

app.get('/assets/resto_icon.png', async (request, reply) => {
  const filePath = path.join(publicAssetsDir, restaurantIconFileName);

  try {
    await access(filePath);
  } catch {
    reply.code(404).send({
      error: 'El icono del restaurante no existe',
    });
    return reply;
  }

  reply.header('Cache-Control', 'public, max-age=300');
  reply.type(getContentType(restaurantIconFileName));
  return reply.send(createReadStream(filePath));
});

app.get('/api/public/bootstrap', async () => {
  const domainBootstrap = await callDomain('/internal/public/bootstrap');
  const tunnelState = await readTunnelState();

  return {
    ...domainBootstrap,
    businessName: process.env.BUSINESS_NAME ?? null,
    publicClientUrl: tunnelState.publicUrl,
    businessTimezone: process.env.BUSINESS_TIMEZONE,
  };
});

app.get('/api/internal/tunel', async () => readTunnelState());

app.post('/api/public/mesas/:mesaNumero/session', async (request, reply) => {
  const mesaPath = encodePathSegment(request.params.mesaNumero);
  const payload = await callDomain(
    `/internal/public/mesas/${mesaPath}/session`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
        clientName: request.body?.clientName ?? null,
      }),
    },
  );

  reply.code(201);
  return payload;
});

app.get('/api/public/mesas/:mesaNumero/menu', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/menu`,
    {},
    {
      clientSessionId: request.query?.clientSessionId ?? null,
    },
  ));

app.post('/api/public/mesas/:mesaNumero/disconnect', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/disconnect`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
        immediate: request.body?.immediate === true,
      }),
    },
  ));

app.get('/api/public/mesas/:mesaNumero/state', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/state`,
    {},
    {
      clientSessionId: request.query?.clientSessionId ?? null,
    },
  ));

app.post('/api/public/mesas/:mesaNumero/comandas/items', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/comandas/items`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
        productoId: request.body?.productoId ?? null,
        action: request.body?.action ?? null,
      }),
    },
  ));

app.post('/api/public/mesas/:mesaNumero/comandas/confirm', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/comandas/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
      }),
    },
  ));

app.post('/api/public/mesas/:mesaNumero/waiter-call', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/waiter-call`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
      }),
    },
  ));

app.post('/api/public/mesas/:mesaNumero/consulta/open', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/consulta/open`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
        contenido: request.body?.contenido ?? null,
      }),
    },
  ));

app.post('/api/public/mesas/:mesaNumero/consulta/message', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/consulta/message`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
        contenido: request.body?.contenido ?? null,
      }),
    },
  ));

app.post('/api/public/mesas/:mesaNumero/consulta/close', async (request) =>
  callDomain(
    `/internal/public/mesas/${encodePathSegment(request.params.mesaNumero)}/consulta/close`,
    {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: request.body?.clientSessionId ?? null,
      }),
    },
  ));

app.get('/api/public/mesas/:mesaNumero/socket', { websocket: true }, async (socket, request) => {
  const mesaNumero = request.params.mesaNumero;
  const mesaPath = encodePathSegment(mesaNumero);
  const clientSessionId = request.query?.clientSessionId ?? null;
  const subscriber = {
    mesaNumero,
    clientSessionId,
    socket,
    lastPayload: '',
    disconnected: false,
  };

  registerMesaSubscriber(mesaNumero, subscriber);

  try {
    await callDomain(
      `/internal/public/mesas/${mesaPath}/connect`,
      {
        method: 'POST',
        body: JSON.stringify({
          clientSessionId,
        }),
      },
    );
  } catch (error) {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({
        type: 'session_error',
        error: error.message,
      }));
      socket.close();
    }

    unregisterMesaSubscriber(mesaNumero, subscriber);
    return;
  }

  if (socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: 'ready',
      mesaNumero: String(mesaNumero),
    }));
  }

  await publishSnapshotToSubscriber(subscriber);

  const heartbeatId = setInterval(() => {
    if (socket.readyState !== 1) {
      return;
    }

    socket.send(JSON.stringify({
      type: 'keepalive',
      mesaNumero: String(mesaNumero),
    }));
  }, heartbeatIntervalMs);

  const disconnectMesaClient = async () => {
    if (subscriber.disconnected) {
      return;
    }

    subscriber.disconnected = true;
    clearInterval(heartbeatId);
    unregisterMesaSubscriber(mesaNumero, subscriber);

    try {
      await callDomain(
        `/internal/public/mesas/${mesaPath}/disconnect`,
        {
          method: 'POST',
          body: JSON.stringify({
            clientSessionId,
          }),
        },
      );
    } catch (error) {
      app.log.warn(
        { error: error.message, mesaNumero, clientSessionId },
        'No se pudo notificar la desconexion de la carta al dominio',
      );
    }
  };

  socket.on('close', () => {
    disconnectMesaClient().catch((error) => {
      app.log.error(error);
    });
  });

  socket.on('error', (error) => {
    app.log.warn({ error: error.message, mesaNumero }, 'El socket publico de mesa reporto un error');
  });
});

app.post('/api/internal/auth/login', async (request, reply) => {
  const payload = await callDomain('/internal/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      role: request.body?.role ?? null,
      username: request.body?.username ?? null,
      password: request.body?.password ?? null,
    }),
  });

  reply.header('Set-Cookie', buildSessionCookieHeader(payload.sessionToken));
  reply.code(201);
  return sanitizeSessionPayload(payload);
});

app.get('/api/internal/auth/session', async (request) =>
  sanitizeSessionPayload(await callDomain('/internal/auth/session', {
    headers: buildDomainSessionHeaders(request),
  })));

app.post('/api/internal/auth/logout', async (request, reply) => {
  const payload = await callDomain('/internal/auth/logout', {
    method: 'POST',
    headers: buildDomainSessionHeaders(request),
  });

  reply.header('Set-Cookie', buildExpiredSessionCookieHeader());
  return payload;
});

app.get('/api/internal/socket', { websocket: true }, async (socket, request) => {
  let subscriber = null;

  try {
    const session = await requireInternalSession(request, ['mozo', 'encargado']);

    subscriber = {
      socket,
      role: session.role,
    };

    registerInternalPanelSubscriber(subscriber);

    if (socket.readyState === 1) {
      socket.send(JSON.stringify({
        type: 'ready',
        role: session.role,
      }));
    }
  } catch (error) {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({
        type: 'session_error',
        error: error.message,
      }));
    }

    socket.close();
    return;
  }

  socket.on('close', () => {
    if (subscriber) {
      unregisterInternalPanelSubscriber(subscriber);
    }
  });

  socket.on('error', () => {
    if (subscriber) {
      unregisterInternalPanelSubscriber(subscriber);
    }
  });
});

app.get('/api/internal/shell', async (request) => {
  const session = await requireInternalSession(request);

  return {
    session: sanitizeSessionPayload(session),
    roles: ['mozo', 'encargado'],
    mqttBaseTopic: process.env.MQTT_BASE_TOPIC,
    domainBaseUrl: process.env.HTTP_GW_DOMAIN_BASE_URL,
  };
});

app.get('/api/internal/dashboard', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain('/internal/admin/dashboard', {
    headers: buildDomainSessionHeaders(request),
  });
});

app.get('/api/internal/config', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain('/internal/admin/config', {
    headers: buildDomainSessionHeaders(request),
  });
});

app.put('/api/internal/config', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain('/internal/admin/config', {
    method: 'PUT',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify({
      visualUsdExchangeRate: request.body?.visualUsdExchangeRate ?? null,
    }),
  });
});

app.get('/api/internal/assets/menu-images', async (request) => {
  await requireInternalSession(request, ['encargado']);
  const directory = process.env.MENU_ASSETS_DIR;
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      nombre: entry.name,
      rutaRelativa: path.posix.join('/assets/menu', entry.name),
    }))
    .sort((left, right) => left.nombre.localeCompare(right.nombre, 'es'));
});

app.get('/api/internal/categorias', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain('/internal/admin/categorias', {
    headers: buildDomainSessionHeaders(request),
  });
});

app.get('/api/internal/subcategorias', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain('/internal/admin/subcategorias', {
    headers: buildDomainSessionHeaders(request),
  });
});

app.post('/api/internal/categorias', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain('/internal/admin/categorias', {
    method: 'POST',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify(request.body ?? {}),
  });
});

app.put('/api/internal/categorias/:categoriaId', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain(`/internal/admin/categorias/${request.params.categoriaId}`, {
    method: 'PUT',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify(request.body ?? {}),
  });
});

app.delete('/api/internal/categorias/:categoriaId', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain(`/internal/admin/categorias/${request.params.categoriaId}`, {
    method: 'DELETE',
    headers: buildDomainSessionHeaders(request),
  });
});

app.get('/api/internal/productos', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain('/internal/admin/productos', {
    headers: buildDomainSessionHeaders(request),
  });
});

app.post('/api/internal/productos', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain('/internal/admin/productos', {
    method: 'POST',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify(request.body ?? {}),
  });
});

app.put('/api/internal/productos/:productoId', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain(`/internal/admin/productos/${request.params.productoId}`, {
    method: 'PUT',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify(request.body ?? {}),
  });
});

app.delete('/api/internal/productos/:productoId', async (request) => {
  await requireInternalSession(request, ['encargado']);
  return callDomain(`/internal/admin/productos/${request.params.productoId}`, {
    method: 'DELETE',
    headers: buildDomainSessionHeaders(request),
  });
});

app.get('/api/internal/mesas', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain('/internal/admin/mesas', {
    headers: buildDomainSessionHeaders(request),
  });
});

app.post('/api/internal/mesas', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain('/internal/admin/mesas', {
    method: 'POST',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify(request.body ?? {}),
  });
});

app.post('/api/internal/mesas/:mesaNumero/open', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(`/internal/admin/mesas/${encodePathSegment(request.params.mesaNumero)}/open`, {
    method: 'POST',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify({}),
  });
});

app.post('/api/internal/mesas/:mesaNumero/close', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(`/internal/admin/mesas/${encodePathSegment(request.params.mesaNumero)}/close`, {
    method: 'POST',
    headers: buildDomainSessionHeaders(request),
    body: JSON.stringify({}),
  });
});

app.get('/api/internal/mozo/queues', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(
    '/internal/waiter/queues',
    {
      headers: buildDomainSessionHeaders(request),
    },
    {
      status: request.query?.status ?? 'pendiente',
    },
  );
});

app.get('/api/internal/mozo/consultas/:consultaId', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(`/internal/waiter/consultas/${request.params.consultaId}`, {
    headers: buildDomainSessionHeaders(request),
  });
});

app.post('/api/internal/mozo/consultas/:consultaId/message', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(
    `/internal/waiter/consultas/${request.params.consultaId}/message`,
    {
      method: 'POST',
      headers: buildDomainSessionHeaders(request),
      body: JSON.stringify({
        contenido: request.body?.contenido ?? null,
      }),
    },
  );
});

app.post('/api/internal/mozo/consultas/:consultaId/close', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(
    `/internal/waiter/consultas/${request.params.consultaId}/close`,
    {
      method: 'POST',
      headers: buildDomainSessionHeaders(request),
      body: JSON.stringify({}),
    },
  );
});

app.get('/api/internal/mozo/pedidos-cocina/:pedidoCocinaId', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(`/internal/waiter/pedidos-cocina/${request.params.pedidoCocinaId}`, {
    headers: buildDomainSessionHeaders(request),
  });
});

app.post('/api/internal/mozo/pedidos-cocina/:pedidoCocinaId/receive', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(
    `/internal/waiter/pedidos-cocina/${request.params.pedidoCocinaId}/receive`,
    {
      method: 'POST',
      headers: buildDomainSessionHeaders(request),
      body: JSON.stringify({}),
    },
  );
});

app.get('/api/internal/mozo/llamados-mozo/:llamadoMozoId', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(`/internal/waiter/llamados-mozo/${request.params.llamadoMozoId}`, {
    headers: buildDomainSessionHeaders(request),
  });
});

app.post('/api/internal/mozo/llamados-mozo/:llamadoMozoId/receive', async (request) => {
  await requireInternalSession(request, ['mozo']);
  return callDomain(
    `/internal/waiter/llamados-mozo/${request.params.llamadoMozoId}/receive`,
    {
      method: 'POST',
      headers: buildDomainSessionHeaders(request),
      body: JSON.stringify({}),
    },
  );
});

await app.listen({
  host: process.env.HTTP_GW_HOST,
  port: Number.parseInt(process.env.HTTP_GW_PORT, 10),
});

startDomainEventStream().catch((error) => {
  app.log.error(error);
  scheduleDomainEventReconnect('error-en-arranque-http-gw');
});
