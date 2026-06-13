import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const requiredEnv = [
  'ADMIN_DASHBOARD_HOST',
  'ADMIN_DASHBOARD_PORT',
  'ADMIN_DASHBOARD_USERNAME',
  'ADMIN_DASHBOARD_PASSWORD',
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

await app.register(websocket);

const sessionIdleCloseMs = Number.parseInt(process.env.ADMIN_SESSION_IDLE_CLOSE_MS ?? '120000', 10);
const maxEvents = Number.parseInt(process.env.ADMIN_MAX_EVENTS ?? '500', 10);
const syslogPort = Number.parseInt(process.env.ADMIN_SYSLOG_PORT ?? '5514', 10);
const syslogHost = process.env.ADMIN_SYSLOG_HOST ?? '0.0.0.0';

const sessions = new Map();
const recentEvents = [];
const wsClients = new Set();
let lastCpuSample = null;

const healthTargets = [
  { name: 'admin-dashboard', url: null },
  { name: 'public-router', url: 'http://public-router/health' },
  { name: 'edge-adapter-tunel', url: 'http://edge-adapter-tunel/health' },
  { name: 'tunel-service', url: 'http://tunel-service:8083/health' },
  { name: 'web-server', url: 'http://web-server/' },
  { name: 'http-gw', url: 'http://http-gw:8080/health' },
  { name: 'domain', url: 'http://http-gw:8080/health', dependencyName: 'domain' },
  { name: 'postgres', url: 'http://http-gw:8080/health', dependencyName: 'postgres' },
  { name: 'mqtt-client', url: 'http://mqtt-client:8082/health' },
];

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonFromSyslog(message) {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return null;
  }

  return safeJsonParse(message.slice(start, end + 1));
}

function getBasicAuthPayload(request) {
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) {
    return null;
  }

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  };
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function requireAdminAuth(request, reply) {
  if (request.url === '/health' || request.url === '/internal/access-event') {
    return;
  }

  const auth = getBasicAuthPayload(request);
  const valid = auth
    && constantTimeEquals(auth.username, process.env.ADMIN_DASHBOARD_USERNAME)
    && constantTimeEquals(auth.password, process.env.ADMIN_DASHBOARD_PASSWORD);

  if (!valid) {
    reply.header('WWW-Authenticate', 'Basic realm="resto-edge-admin", charset="UTF-8"');
    return reply.code(401).send({ error: 'Credenciales invalidas' });
  }
}

function classifyPublicArea(pathname, referer = '') {
  if (pathname === '/carta' || pathname.startsWith('/carta/')) {
    return 'carta';
  }

  if (pathname === '/gestion' || pathname.startsWith('/gestion/')) {
    return 'gestion';
  }

  if (pathname.startsWith('/api/public/')) {
    return 'carta';
  }

  if (pathname.startsWith('/api/internal/')) {
    return 'gestion';
  }

  try {
    const refererPathname = referer ? new URL(referer).pathname : '';
    if (refererPathname === '/carta' || refererPathname.startsWith('/carta/')) {
      return 'carta';
    }
    if (refererPathname === '/gestion' || refererPathname.startsWith('/gestion/')) {
      return 'gestion';
    }
  } catch {
    return null;
  }

  return null;
}

function getClientKey(event, area) {
  const ip = event.forwardedFor || event.remoteAddr || 'ip-desconocida';
  const userAgent = event.userAgent || 'ua-desconocido';
  const userAgentHash = crypto.createHash('sha1').update(userAgent).digest('hex').slice(0, 12);
  return `${area}:${ip}:${userAgentHash}`;
}

function closeIdleSessions(nowMs) {
  for (const session of sessions.values()) {
    if (session.status === 'active' && nowMs - session.lastSeenMs > sessionIdleCloseMs) {
      session.status = 'closed_by_inactivity';
      session.closedAt = new Date(session.lastSeenMs).toISOString();
      session.durationMs = session.lastSeenMs - session.firstSeenMs;
    }
  }
}

function recordAccessEvent(rawEvent) {
  const pathname = rawEvent.path ?? '/';
  const area = classifyPublicArea(pathname, rawEvent.referer);
  const now = Date.now();

  const event = {
    at: rawEvent.time ?? new Date(now).toISOString(),
    area: area ?? 'otra',
    method: rawEvent.method ?? '',
    path: pathname,
    status: Number.isFinite(Number.parseInt(rawEvent.status ?? '', 10))
      ? Number.parseInt(rawEvent.status, 10)
      : null,
    requestTimeMs: Math.round(Number.parseFloat(rawEvent.requestTime ?? '0') * 1000),
    remoteAddr: rawEvent.remoteAddr ?? '',
    forwardedFor: rawEvent.forwardedFor ?? '',
    userAgent: rawEvent.userAgent ?? '',
    protocol: rawEvent.protocol ?? '',
    upgrade: rawEvent.upgrade ?? '',
  };

  recentEvents.unshift(event);
  if (recentEvents.length > maxEvents) {
    recentEvents.pop();
  }

  if (area) {
    const key = getClientKey(event, area);
    const current = sessions.get(key);

    if (!current || current.status !== 'active') {
      sessions.set(key, {
        key,
        area,
        ip: event.forwardedFor || event.remoteAddr,
        userAgent: event.userAgent,
        firstSeenAt: event.at,
        firstSeenMs: now,
        lastSeenAt: event.at,
        lastSeenMs: now,
        status: 'active',
        requests: 1,
        websocketRequests: event.upgrade.toLowerCase() === 'websocket' ? 1 : 0,
        resources: [event.path],
      });
    } else {
      current.lastSeenAt = event.at;
      current.lastSeenMs = now;
      current.requests += 1;
      if (event.upgrade.toLowerCase() === 'websocket') {
        current.websocketRequests += 1;
      }
      current.resources.unshift(event.path);
      current.resources = Array.from(new Set(current.resources)).slice(0, 20);
    }
  }

  closeIdleSessions(now);
  broadcastSnapshot();
}

function getHeaderValue(request, headerName) {
  const value = request.headers[headerName.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function recordMirroredAccessEvent(request) {
  recordAccessEvent({
    time: getHeaderValue(request, 'x-edge-time'),
    remoteAddr: getHeaderValue(request, 'x-edge-remote-addr'),
    forwardedFor: getHeaderValue(request, 'x-edge-forwarded-for'),
    method: getHeaderValue(request, 'x-edge-method'),
    path: getHeaderValue(request, 'x-edge-path'),
    query: getHeaderValue(request, 'x-edge-query'),
    status: getHeaderValue(request, 'x-edge-status'),
    requestTime: getHeaderValue(request, 'x-edge-request-time'),
    protocol: getHeaderValue(request, 'x-edge-protocol'),
    upgrade: getHeaderValue(request, 'x-edge-upgrade'),
    referer: getHeaderValue(request, 'x-edge-referer'),
    userAgent: getHeaderValue(request, 'x-edge-user-agent'),
  });
}

async function readTextFile(pathname) {
  try {
    return await readFile(pathname, 'utf8');
  } catch {
    return null;
  }
}

async function readMemoryInfo() {
  const content = await readTextFile('/proc/meminfo');
  if (!content) {
    return null;
  }

  const values = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([^:]+):\s+(\d+)/);
    if (match) {
      values[match[1]] = Number.parseInt(match[2], 10) * 1024;
    }
  }

  return {
    totalBytes: values.MemTotal ?? null,
    availableBytes: values.MemAvailable ?? null,
  };
}

async function readLoadAverage() {
  const content = await readTextFile('/proc/loadavg');
  if (!content) {
    return null;
  }

  const [one, five, fifteen] = content.trim().split(/\s+/).map(Number.parseFloat);
  return { one, five, fifteen };
}

async function readCpuSample() {
  const content = await readTextFile('/proc/stat');
  const line = content?.split('\n').find((item) => item.startsWith('cpu '));
  if (!line) {
    return null;
  }

  const values = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = values[3] + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

async function readCpuUsagePercent() {
  const current = await readCpuSample();
  if (!current) {
    return null;
  }

  if (!lastCpuSample) {
    lastCpuSample = current;
    return null;
  }

  const idleDelta = current.idle - lastCpuSample.idle;
  const totalDelta = current.total - lastCpuSample.total;
  lastCpuSample = current;

  if (totalDelta <= 0) {
    return null;
  }

  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}

async function readContainerMemoryBytes() {
  const cgroupV2 = await readTextFile('/sys/fs/cgroup/memory.current');
  if (cgroupV2) {
    return Number.parseInt(cgroupV2.trim(), 10);
  }

  const cgroupV1 = await readTextFile('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  return cgroupV1 ? Number.parseInt(cgroupV1.trim(), 10) : null;
}

async function readSystemMetrics() {
  const [memory, loadAverage, cpuUsagePercent, dashboardMemoryBytes] = await Promise.all([
    readMemoryInfo(),
    readLoadAverage(),
    readCpuUsagePercent(),
    readContainerMemoryBytes(),
  ]);

  return {
    sampledAt: new Date().toISOString(),
    dockerVm: {
      memory,
      loadAverage,
      cpuUsagePercent,
      source: '/proc dentro del contenedor admin-dashboard',
    },
    adminDashboardContainer: {
      memoryBytes: dashboardMemoryBytes,
      source: 'cgroup del contenedor admin-dashboard',
    },
    perContainerResources: {
      available: false,
      reason: 'No se monta Docker socket ni se usan privilegios elevados; se evita exponer control de Docker.',
    },
  };
}

async function checkHealthTarget(target) {
  if (!target.url) {
    return {
      name: target.name,
      status: 'ok',
      detail: 'proceso actual',
      checkedAt: new Date().toISOString(),
    };
  }

  const startedAt = performance.now();
  try {
    const response = await fetch(target.url, {
      signal: AbortSignal.timeout(1500),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : null;

    if (target.dependencyName) {
      const dependency = payload?.dependencies?.[target.dependencyName];
      return {
        name: target.name,
        status: dependency?.status ?? 'unknown',
        detail: dependency?.detail ?? `reportado por ${target.url}`,
        statusCode: response.status,
        responseTimeMs: Math.round(performance.now() - startedAt),
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      name: target.name,
      status: response.status < 500 ? 'ok' : 'error',
      statusCode: response.status,
      detail: payload?.status ? `status=${payload.status}` : null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      name: target.name,
      status: 'unreachable',
      error: error.message,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function getTunnelEntrypoint() {
  try {
    const response = await fetch('http://tunel-service:8083/entrypoint', {
      signal: AbortSignal.timeout(1500),
    });
    const payload = await response.json();
    return {
      ready: Boolean(payload.ready),
      publicUrl: payload.publicUrl ?? null,
      lastError: payload.lastError ?? null,
    };
  } catch (error) {
    return {
      ready: false,
      publicUrl: null,
      lastError: error.message,
    };
  }
}

function buildPublicUrl(baseUrl, pathname) {
  if (!baseUrl) {
    return pathname;
  }

  return new URL(pathname, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

async function buildSnapshot() {
  const now = Date.now();
  closeIdleSessions(now);

  const [metrics, health, tunnel] = await Promise.all([
    readSystemMetrics(),
    Promise.all(healthTargets.map(checkHealthTarget)),
    getTunnelEntrypoint(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    sessionIdleCloseMs,
    sessions: Array.from(sessions.values())
      .sort((left, right) => right.lastSeenMs - left.lastSeenMs)
      .map((session) => ({
        area: session.area,
        ip: session.ip,
        userAgent: session.userAgent,
        firstSeenAt: session.firstSeenAt,
        lastSeenAt: session.lastSeenAt,
        closedAt: session.closedAt ?? null,
        status: session.status,
        requests: session.requests,
        websocketRequests: session.websocketRequests,
        activeForMs: session.status === 'active' ? now - session.firstSeenMs : null,
        durationMs: session.status === 'active' ? null : session.durationMs,
        resources: session.resources,
      })),
    recentEvents,
    health,
    metrics,
    tunnel,
    links: {
      carta: buildPublicUrl(tunnel.publicUrl, '/carta'),
      gestion: buildPublicUrl(tunnel.publicUrl, '/gestion'),
    },
  };
}

async function broadcastSnapshot() {
  const payload = JSON.stringify({
    type: 'snapshot',
    payload: await buildSnapshot(),
  });

  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

const syslogSocket = dgram.createSocket('udp4');

syslogSocket.on('message', (message) => {
  const payload = extractJsonFromSyslog(message.toString('utf8'));
  if (payload) {
    recordAccessEvent(payload);
  }
});

syslogSocket.on('error', (error) => {
  app.log.error({ error: error.message }, 'Error en receptor syslog de admin-dashboard');
});

syslogSocket.bind(syslogPort, syslogHost, () => {
  app.log.info({ host: syslogHost, port: syslogPort }, 'admin-dashboard escucha logs syslog UDP');
});

app.addHook('preHandler', requireAdminAuth);

app.get('/health', async () => ({
  service: 'admin-dashboard',
  status: 'ok',
  sessions: sessions.size,
  events: recentEvents.length,
}));

app.post('/internal/access-event', async (request) => {
  recordMirroredAccessEvent(request);
  return { ok: true };
});

app.get('/admin', async (_, reply) => {
  reply.type('text/html; charset=utf-8');
  return html;
});

app.get('/admin/', async (_, reply) => {
  reply.type('text/html; charset=utf-8');
  return html;
});

app.get('/admin/api/snapshot', async () => buildSnapshot());

app.get('/admin/ws', { websocket: true }, (socket) => {
  wsClients.add(socket);
  buildSnapshot()
    .then((snapshot) => {
      socket.send(JSON.stringify({ type: 'snapshot', payload: snapshot }));
    })
    .catch((error) => {
      app.log.error({ error: error.message }, 'No se pudo enviar snapshot inicial');
    });

  socket.on('close', () => {
    wsClients.delete(socket);
  });
});

setInterval(() => {
  broadcastSnapshot().catch((error) => {
    app.log.error({ error: error.message }, 'No se pudo publicar snapshot admin');
  });
}, 5000).unref();

const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin edge</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe8;
        --card: #fffdfa;
        --ink: #211a16;
        --muted: #6f625a;
        --line: rgba(33, 26, 22, 0.12);
        --accent: #b95b38;
        --ok: #247847;
        --warn: #9a6a00;
        --bad: #a83232;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Trebuchet MS", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top left, #fff7ec 0, var(--bg) 42%, #eadfd2 100%);
        color: var(--ink);
      }

      main {
        width: min(1180px, calc(100% - 28px));
        margin: 0 auto;
        padding: 24px 0 40px;
      }

      header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-end;
        margin-bottom: 18px;
      }

      .header-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: flex-end;
      }

      .quick-links {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .quick-links a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 36px;
        padding: 8px 12px;
        border: 1px solid rgba(185, 91, 56, 0.28);
        border-radius: 999px;
        background: #fffaf4;
        color: var(--accent);
        font-family: sans-serif;
        font-size: 0.86rem;
        font-weight: 700;
        text-decoration: none;
      }

      h1, h2 {
        margin: 0;
      }

      h1 {
        font-size: clamp(2rem, 4vw, 3rem);
        letter-spacing: -0.03em;
        line-height: 0.95;
      }

      h2 {
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .muted {
        color: var(--muted);
      }

      .hint {
        margin-top: 8px;
        color: var(--muted);
        font-family: sans-serif;
        font-size: 0.86rem;
      }

      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        grid-template-rows: auto minmax(360px, calc(100vh - 360px));
        gap: 14px;
        align-items: stretch;
      }

      .card {
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: rgba(255, 253, 250, 0.9);
        box-shadow: 0 20px 60px rgba(33, 26, 22, 0.08);
      }

      .session-card,
      .events-card {
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .session-card,
      .events-card {
        min-height: 0;
      }

      .scroll-panel {
        min-height: 0;
        overflow: auto;
        margin-top: 12px;
        padding-right: 4px;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        margin-top: 12px;
      }

      .stat {
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: #fffaf4;
      }

      .stat strong {
        display: block;
        font-size: 1.35rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-family: sans-serif;
        font-size: 0.9rem;
      }

      th, td {
        padding: 9px 8px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .pill {
        display: inline-flex;
        padding: 4px 8px;
        border-radius: 999px;
        background: #efe3d5;
        color: var(--ink);
        font-family: sans-serif;
        font-size: 0.78rem;
      }

      .ok { color: var(--ok); }
      .warn { color: var(--warn); }
      .bad { color: var(--bad); }

      .resources {
        max-width: 360px;
        color: var(--muted);
        word-break: break-word;
      }

      @media (max-width: 760px) {
        header {
          display: block;
        }

        .header-actions {
          align-items: flex-start;
          margin-top: 14px;
        }

        .quick-links {
          justify-content: flex-start;
        }

        .grid {
          grid-template-columns: 1fr;
          grid-template-rows: none;
        }

        .session-card,
        .events-card {
          max-height: 60vh;
          height: auto;
        }

        table {
          display: block;
          overflow-x: auto;
          white-space: nowrap;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Admin</h1>
        </div>
        <div class="header-actions">
          <nav id="public-links" class="quick-links"></nav>
          <p id="updated" class="muted">Esperando datos...</p>
        </div>
      </header>

      <section class="grid">
        <article class="card">
          <h2>Salud servicios</h2>
          <div id="health"></div>
        </article>

        <article class="card">
          <h2>Recursos</h2>
          <div id="metrics"></div>
        </article>

        <article class="card session-card">
          <h2>Sesiones carta / gestion</h2>
          <div id="stats" class="stats"></div>
          <div id="sessions" class="scroll-panel"></div>
        </article>

        <article class="card events-card">
          <h2>Eventos recientes</h2>
          <div id="events" class="scroll-panel"></div>
        </article>
      </section>
    </main>

    <script>
      const formatDuration = (ms) => {
        if (ms === null || ms === undefined) return '-';
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
      };

      const formatBytes = (bytes) => {
        if (!Number.isFinite(bytes)) return '-';
        const units = ['B', 'KB', 'MB', 'GB'];
        let value = bytes;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
          value /= 1024;
          unit += 1;
        }
        return value.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
      };

      const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      }[char]));

      const renderTable = (headers, rows) => {
        if (!rows.length) {
          return '<p class="muted">Sin datos todavia.</p>';
        }
        return '<table><thead><tr>' + headers.map((header) => '<th>' + header + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
      };

      function render(snapshot) {
        const active = snapshot.sessions.filter((session) => session.status === 'active');
        const closed = snapshot.sessions.filter((session) => session.status !== 'active');
        const cartaActive = active.filter((session) => session.area === 'carta');
        const gestionActive = active.filter((session) => session.area === 'gestion');
        const observedRequests = snapshot.recentEvents.filter((event) => event.area === 'carta' || event.area === 'gestion');
        const observedWebsockets = snapshot.sessions.reduce((sum, session) => sum + session.websocketRequests, 0);

        document.getElementById('updated').textContent = 'Actualizado ' + new Date(snapshot.generatedAt).toLocaleString();
        document.getElementById('public-links').innerHTML = [
          '<a href="' + escapeHtml(snapshot.links.carta) + '" target="_blank" rel="noreferrer">Abrir carta</a>',
          '<a href="' + escapeHtml(snapshot.links.gestion) + '" target="_blank" rel="noreferrer">Abrir gestion</a>',
        ].join('');
        document.getElementById('stats').innerHTML = [
          ['Clientes viendo carta ahora', cartaActive.length],
          ['Usuarios en gestion ahora', gestionActive.length],
          ['Sesiones cerradas por inactividad', closed.length],
          ['Requests carta/gestion observados', observedRequests.length],
          ['WebSockets observados', observedWebsockets],
        ].map(([label, value]) => '<div class="stat"><span class="muted">' + label + '</span><strong>' + value + '</strong></div>').join('');

        document.getElementById('sessions').innerHTML = renderTable(
          ['area', 'estado', 'ip', 'duracion', 'requests', 'ws', 'recursos'],
          snapshot.sessions.map((session) => '<tr>'
            + '<td><span class="pill">' + escapeHtml(session.area) + '</span></td>'
            + '<td>' + escapeHtml(session.status) + '</td>'
            + '<td>' + escapeHtml(session.ip) + '</td>'
            + '<td>' + formatDuration(session.activeForMs ?? session.durationMs) + '</td>'
            + '<td>' + session.requests + '</td>'
            + '<td>' + session.websocketRequests + '</td>'
            + '<td class="resources">' + escapeHtml(session.resources.slice(0, 5).join(', ')) + '</td>'
            + '</tr>'),
        );
        if (!snapshot.sessions.length) {
          document.getElementById('sessions').innerHTML += '<p class="hint">Solo se observan accesos que entran por el public-router de resto_edge. Si usas directamente localhost:5175 o localhost:5174, esa actividad no pasa por este dashboard.</p>';
        }

        document.getElementById('health').innerHTML = renderTable(
          ['servicio', 'estado', 'detalle'],
          snapshot.health.map((item) => {
            const cls = item.status === 'ok' ? 'ok' : item.status === 'unreachable' ? 'warn' : 'bad';
            const detail = item.error || item.detail || ('HTTP ' + item.statusCode + ' en ' + item.responseTimeMs + 'ms');
            return '<tr><td>' + escapeHtml(item.name) + '</td><td class="' + cls + '">' + escapeHtml(item.status) + '</td><td>' + escapeHtml(detail) + '</td></tr>';
          }),
        );

        const vm = snapshot.metrics.dockerVm;
        const container = snapshot.metrics.adminDashboardContainer;
        document.getElementById('metrics').innerHTML = [
          '<p><strong>VM Docker visible:</strong></p>',
          '<p>CPU: ' + (vm.cpuUsagePercent ?? '-') + '%</p>',
          '<p>Promedio de carga CPU: ' + (vm.loadAverage ? [vm.loadAverage.one, vm.loadAverage.five, vm.loadAverage.fifteen].join(' / ') : '-') + '</p>',
          '<p class="muted">Orden: ultimo 1 minuto / 5 minutos / 15 minutos.</p>',
          '<p>Memoria disponible: ' + formatBytes(vm.memory?.availableBytes) + ' / ' + formatBytes(vm.memory?.totalBytes) + '</p>',
          '<p><strong>admin-dashboard:</strong> ' + formatBytes(container.memoryBytes) + '</p>',
          '<p class="muted">' + escapeHtml(snapshot.metrics.perContainerResources.reason) + '</p>',
        ].join('');

        document.getElementById('events').innerHTML = renderTable(
          ['hora', 'area', 'metodo', 'path', 'status', 'ms', 'tipo'],
          snapshot.recentEvents.slice(0, 30).map((event) => '<tr>'
            + '<td>' + escapeHtml(new Date(event.at).toLocaleTimeString()) + '</td>'
            + '<td>' + escapeHtml(event.area) + '</td>'
            + '<td>' + escapeHtml(event.method) + '</td>'
            + '<td>' + escapeHtml(event.path) + '</td>'
            + '<td>' + escapeHtml(event.status) + '</td>'
            + '<td>' + escapeHtml(event.requestTimeMs) + '</td>'
            + '<td>' + escapeHtml(event.upgrade && event.upgrade.toLowerCase() === 'websocket' ? 'websocket' : event.path.startsWith('/api/') ? 'api' : 'web') + '</td>'
            + '</tr>'),
        );
      }

      async function loadInitialSnapshot() {
        const response = await fetch('/admin/api/snapshot');
        render(await response.json());
      }

      function connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(protocol + '//' + location.host + '/admin/ws');
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'snapshot') {
            render(message.payload);
          }
        });
        socket.addEventListener('close', () => setTimeout(connect, 2000));
      }

      loadInitialSnapshot().catch(console.error);
      connect();
    </script>
  </body>
</html>`;

await app.listen({
  host: process.env.ADMIN_DASHBOARD_HOST,
  port: Number.parseInt(process.env.ADMIN_DASHBOARD_PORT, 10),
});
