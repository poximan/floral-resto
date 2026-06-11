import { buildContractsSnapshot } from '../services/contracts-service.js';

export async function bootstrapRoutes(app, config) {
  app.get('/internal/bootstrap', async () => ({
    service: 'domain',
    status: 'implemented',
    postgres: {
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      schema: config.postgres.schema,
    },
  }));

  app.get('/internal/catalog/contracts', async () => ({
    categories: {
      requiredFields: ['titulo', 'orden'],
      deleteRule: 'bloquear-si-tiene-productos-activos',
    },
    products: {
      requiredFields: ['subcategoriaId', 'titulo', 'descripcion', 'precioArsCentavos'],
      optionalFields: ['imagenNombreArchivo'],
      sortRule: 'orden-categoria-y-luego-titulo-alfabetico',
    },
    mesas: {
      requiredFields: ['nombre'],
      deleteRule: 'bloquear-si-tiene-sesion-activa',
    },
  }));

  app.get('/internal/dashboard/contracts', async () => ({
    metrics: [
      'pendientes-por-cola',
      'atendidos-por-cola',
      'tiempos-minimos',
      'tiempos-maximos',
      'tiempos-medios',
      'dinero-total-jornada',
      'dinero-por-mesa-jornada',
    ],
  }));

  app.get('/internal/mobile/contracts', async () => ({
    login: {
      requestFields: ['requestId', 'deviceId', 'username', 'password'],
      responseFields: ['requestId', 'accepted', 'reason', 'deviceId'],
    },
    currentFragments: {
      dashboardMetrics: ['generatedAt', 'scope', 'fromUtc', 'toUtc', 'metrics'],
      dashboardRevenue: ['generatedAt', 'scope', 'fromUtc', 'toUtc', 'totalArsCentavos', 'items'],
      queue: ['generatedAt', 'scope', 'fromUtc', 'toUtc', 'queueType', 'status', 'items'],
    },
    history: {
      requestFields: ['requestId', 'deviceId', 'fromUtc', 'toUtc'],
      responseFields: ['requestId', 'generatedAt', 'requestedRange', 'dashboard', 'colas'],
    },
    systemEvents: {
      current: ['manager_web_session_closed', 'manager_web_session_close_rejected'],
    },
  }));

  app.get('/internal/contracts', async () => buildContractsSnapshot(config));
}
