import Fastify from 'fastify';
import { loadEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import { healthRoute } from './routes/health.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { publicRoutes } from './routes/public.js';
import { waiterRoutes } from './routes/waiter.js';
import { adminRoutes } from './routes/admin.js';
import { mobileRoutes } from './routes/mobile.js';
import { createMesaService } from './services/mesa-service.js';
import { createWaiterService } from './services/waiter-service.js';
import { createAdminService } from './services/admin-service.js';
import { createAuthService } from './services/auth-service.js';
import { recordAuditEvent } from './services/audit-service.js';
import { publishDomainEvent } from './services/domain-event-service.js';
import { DomainError } from './services/domain-error.js';

const config = loadEnv();
const pool = createPool(config);
const mesaService = createMesaService(pool, config, recordAuditEvent, publishDomainEvent);
const waiterService = createWaiterService(pool, recordAuditEvent, publishDomainEvent);
const adminService = createAdminService(pool, config, recordAuditEvent, publishDomainEvent);
const authService = createAuthService(pool, config, recordAuditEvent, publishDomainEvent);

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof DomainError) {
    reply.code(error.statusCode).send({
      error: error.message,
    });
    return;
  }

  if (
    error instanceof Error &&
    [
      'El estado solicitado es invalido',
      'El identificador de consulta es invalido',
      'El identificador del pedido de cocina es invalido',
      'El identificador del llamado a mozo es invalido',
      'La categoria es invalida',
      'El producto es invalido',
      'La mesa es invalida',
      'El rol solicitado es invalido',
    ].includes(error.message)
  ) {
    reply.code(400).send({
      error: error.message,
    });
    return;
  }

  request.log.error(error);
  reply.code(500).send({
    error: 'Ocurrio un error interno en el servicio de dominio',
  });
});

await healthRoute(app, config, pool);
await bootstrapRoutes(app, config);
await authRoutes(app, authService);
await eventRoutes(app);
await publicRoutes(app, mesaService);
await waiterRoutes(app, waiterService, authService);
await adminRoutes(app, adminService, authService);
await mobileRoutes(app, adminService, authService);

await mesaService.recoverPendingDisconnects();

await app.listen({
  host: config.domainHost,
  port: config.domainPort,
});
