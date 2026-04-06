import { spawn } from 'node:child_process';
import Fastify from 'fastify';

const requiredEnv = [
  'TUNEL_SERVICE_HOST',
  'TUNEL_SERVICE_PORT',
  'TUNEL_TARGET_URL',
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

const tunnelUrlPattern = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/;
const reconnectDelayMs = 5_000;

let tunnelProcess = null;
let publicUrl = null;
let startedAt = null;
let lastOutputAt = null;
let lastError = null;
let restartTimer = null;

function updateFromOutput(chunk) {
  const line = chunk.toString('utf8').trim();

  if (!line) {
    return;
  }

  lastOutputAt = new Date().toISOString();
  app.log.info({ line }, 'Salida de tunel-service');

  const match = line.match(tunnelUrlPattern);
  if (match) {
    publicUrl = match[0];
    lastError = null;
  }
}

function scheduleRestart(reason) {
  if (restartTimer) {
    return;
  }

  app.log.warn({ reason, reconnectDelayMs }, 'Se reintentara levantar cloudflared');
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startTunnel();
  }, reconnectDelayMs);
}

function startTunnel() {
  if (tunnelProcess) {
    return;
  }

  publicUrl = null;
  lastError = null;
  startedAt = new Date().toISOString();

  const args = [
    'tunnel',
    '--no-autoupdate',
    '--protocol',
    'http2',
    '--url',
    process.env.TUNEL_TARGET_URL,
  ];

  tunnelProcess = spawn('cloudflared', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  tunnelProcess.stdout.on('data', updateFromOutput);
  tunnelProcess.stderr.on('data', updateFromOutput);

  tunnelProcess.on('error', (error) => {
    lastError = error.message;
    tunnelProcess = null;
    scheduleRestart('spawn-error');
  });

  tunnelProcess.on('exit', (code, signal) => {
    lastError = code === 0 ? null : `cloudflared termino con code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    tunnelProcess = null;
    scheduleRestart('process-exit');
  });
}

function stopTunnel() {
  if (!tunnelProcess) {
    return;
  }

  tunnelProcess.kill('SIGTERM');
  tunnelProcess = null;
}

app.get('/health', async () => ({
  service: 'tunel-service',
  status: 'ok',
  tunnelRunning: tunnelProcess !== null,
  ready: Boolean(publicUrl),
  publicUrl,
  targetUrl: process.env.TUNEL_TARGET_URL,
  lastError,
}));

app.get('/entrypoint', async () => ({
  service: 'tunel-service',
  ready: Boolean(publicUrl),
  publicUrl,
  targetUrl: process.env.TUNEL_TARGET_URL,
  startedAt,
  lastOutputAt,
  lastError,
}));

app.addHook('onClose', async () => {
  stopTunnel();
});

startTunnel();

await app.listen({
  host: process.env.TUNEL_SERVICE_HOST,
  port: Number.parseInt(process.env.TUNEL_SERVICE_PORT, 10),
});
