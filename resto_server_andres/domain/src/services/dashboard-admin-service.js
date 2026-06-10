import { createDashboardAdminDbAdapter } from '../db/adapters/dashboard-admin-db-adapter.js';
import { DomainError } from './domain-error.js';

function mapDashboardPayload(row, config, range) {
  return {
    jornadaInicioUtc: range.fromUtc,
    jornadaFinUtc: range.toUtc,
    businessTimezone: config.businessTimezone,
    jornadaStartTime: config.jornadaStartTime,
    dineroTotalJornadaArsCentavos: Number(row.dinero_total_jornada),
    colas: row.colas.map((metric) => ({
      cola: metric.cola,
      pendientes: Number(metric.pendientes),
      atendidos: Number(metric.atendidos),
      tiempoMedioSegundos: Number(metric.tiempo_medio_segundos),
      tiempoMinimoSegundos: Number(metric.tiempo_minimo_segundos),
      tiempoMaximoSegundos: Number(metric.tiempo_maximo_segundos),
    })),
    dineroPorMesa: row.dinero_por_mesa.map((item) => ({
      mesaNumero: String(item.mesa_numero),
      totalArsCentavos: Number(item.total_ars_centavos),
    })),
  };
}

async function getCurrentJornadaRange(db, config) {
  return db.withConnection(async ({ repository }) => {
    const row = await repository.getCurrentJornadaRange(config.businessTimezone, config.jornadaStartTime);

    return {
      fromUtc: row.inicio_utc,
      toUtc: row.fin_utc,
    };
  });
}

function normalizeRangePayload(payload) {
  const fromDate = new Date(payload.fromUtc ?? '');
  const toDate = new Date(payload.toUtc ?? '');

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new DomainError(400, 'El rango historico es invalido');
  }

  if (fromDate >= toDate) {
    throw new DomainError(400, 'El rango historico debe tener un inicio menor al fin');
  }

  return {
    fromUtc: fromDate.toISOString(),
    toUtc: toDate.toISOString(),
  };
}

async function getDashboardForRange(db, config, range) {
  return db.withConnection(async ({ repository }) => {
    const row = await repository.getDashboardRow(range);
    return mapDashboardPayload(row, config, range);
  });
}

async function getDashboard(db, config) {
  const range = await getCurrentJornadaRange(db, config);
  return getDashboardForRange(db, config, range);
}

function groupQueuesByStatus(queues) {
  return {
    pendientes: {
      consultas: queues.consultas.filter((item) => item.estado === 'pendiente'),
      pedidosCocina: queues.pedidosCocina.filter((item) => item.estado === 'pendiente'),
      llamadosMozo: queues.llamadosMozo.filter((item) => item.estado === 'pendiente'),
    },
    atendidos: {
      consultas: queues.consultas.filter((item) => item.estado === 'atendido'),
      pedidosCocina: queues.pedidosCocina.filter((item) => item.estado === 'atendido'),
      llamadosMozo: queues.llamadosMozo.filter((item) => item.estado === 'atendido'),
    },
  };
}

function normalizeMobileQueueStatus(status) {
  if (status === 'pendiente' || status === 'pendientes') {
    return 'pendiente';
  }

  if (status === 'atendido' || status === 'atendidos') {
    return 'atendido';
  }

  throw new DomainError(400, 'El estado solicitado es invalido');
}

function normalizeMobileQueueType(queueType) {
  if (queueType === 'consultas') {
    return 'consultas';
  }

  if (queueType === 'pedidosCocina' || queueType === 'pedidos-cocina') {
    return 'pedidosCocina';
  }

  if (queueType === 'llamadosMozo' || queueType === 'llamados-mozo') {
    return 'llamadosMozo';
  }

  throw new DomainError(400, 'La cola solicitada es invalida');
}

function buildDashboardMetricsFragment(dashboard, generatedAt, scope = 'current', requestId = null) {
  return {
    type: `${scope}_dashboard_metrics`,
    generatedAt,
    scope,
    requestId,
    fromUtc: dashboard.jornadaInicioUtc,
    toUtc: dashboard.jornadaFinUtc,
    metrics: dashboard.colas,
  };
}

function buildDashboardRevenueFragment(dashboard, generatedAt, scope = 'current', requestId = null) {
  return {
    type: `${scope}_dashboard_revenue`,
    generatedAt,
    scope,
    requestId,
    fromUtc: dashboard.jornadaInicioUtc,
    toUtc: dashboard.jornadaFinUtc,
    totalArsCentavos: dashboard.dineroTotalJornadaArsCentavos,
    items: dashboard.dineroPorMesa,
  };
}

function buildCurrentQueueFragment(range, realtimeQueues, status, queueType) {
  return {
    type: 'current_queue_fragment',
    generatedAt: new Date().toISOString(),
    scope: 'current',
    fromUtc: range.fromUtc,
    toUtc: range.toUtc,
    queueType,
    status,
    items: realtimeQueues[queueType].filter((item) => item.estado === status),
  };
}

function mapConsultas(rows) {
  return rows.map((row) => ({
    id: Number(row.id),
    estado: row.estado,
    mesaNumero: String(row.mesa_numero),
    mesaSesionId: Number(row.mesa_sesion_id),
    clienteSesionId: row.cliente_sesion_id,
    clienteNombre: row.cliente_nombre ?? null,
    creadaEn: row.creada_en,
    cerradaEn: row.cerrada_en,
    cerradaPor: row.cerrada_por,
    resumen: row.resumen,
    detalle: {
      mensajes: row.detalle_mensajes ?? [],
    },
  }));
}

function mapPedidosCocina(rows) {
  return rows.map((row) => ({
    id: Number(row.id),
    estado: row.estado,
    mesaNumero: String(row.mesa_numero),
    mesaSesionId: Number(row.mesa_sesion_id),
    creadaEn: row.creada_en,
    atendidaEn: row.atendida_en,
    atendidaPor: row.atendida_por,
    totalArsCentavos: Number(row.total_ars_centavos),
    detalle: {
      items: row.detalle_items ?? [],
    },
  }));
}

function mapLlamadosMozo(rows) {
  return rows.map((row) => ({
    id: Number(row.id),
    estado: row.estado,
    mesaNumero: String(row.mesa_numero),
    mesaSesionId: Number(row.mesa_sesion_id),
    creadaEn: row.creada_en,
    atendidaEn: row.atendida_en,
    atendidaPor: row.atendida_por,
    detalle: {},
  }));
}

async function getRealtimeMobileQueues(db, range) {
  return db.withConnection(async ({ repository }) => {
    const consultas = await repository.listRealtimeConsultas(range);
    const pedidosCocina = await repository.listRealtimePedidosCocina(range);
    const llamadosMozo = await repository.listRealtimeLlamadosMozo(range);

    return {
      consultas: mapConsultas(consultas),
      pedidosCocina: mapPedidosCocina(pedidosCocina),
      llamadosMozo: mapLlamadosMozo(llamadosMozo),
    };
  });
}

async function getHistoryQueues(db, range) {
  return db.withConnection(async ({ repository }) => {
    const consultas = await repository.listHistoryConsultas(range);
    const pedidosCocina = await repository.listHistoryPedidosCocina(range);
    const llamadosMozo = await repository.listHistoryLlamadosMozo(range);

    return {
      consultas: mapConsultas(consultas),
      pedidosCocina: mapPedidosCocina(pedidosCocina),
      llamadosMozo: mapLlamadosMozo(llamadosMozo),
    };
  });
}

async function getMobileSnapshot(db, config) {
  const range = await getCurrentJornadaRange(db, config);
  const [dashboard, realtimeQueues] = await Promise.all([
    getDashboardForRange(db, config, range),
    getRealtimeMobileQueues(db, range),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    scope: 'current',
    dashboard,
    colas: groupQueuesByStatus(realtimeQueues),
  };
}

async function getMobileCurrentDashboardMetrics(db, config) {
  const range = await getCurrentJornadaRange(db, config);
  const dashboard = await getDashboardForRange(db, config, range);
  return buildDashboardMetricsFragment(dashboard, new Date().toISOString());
}

async function getMobileCurrentDashboardRevenue(db, config) {
  const range = await getCurrentJornadaRange(db, config);
  const dashboard = await getDashboardForRange(db, config, range);
  return buildDashboardRevenueFragment(dashboard, new Date().toISOString());
}

async function getMobileCurrentQueueFragment(db, config, status, queueType) {
  const normalizedStatus = normalizeMobileQueueStatus(status);
  const normalizedQueueType = normalizeMobileQueueType(queueType);
  const range = await getCurrentJornadaRange(db, config);
  const realtimeQueues = await getRealtimeMobileQueues(db, range);
  return buildCurrentQueueFragment(range, realtimeQueues, normalizedStatus, normalizedQueueType);
}

async function getHistoryDataset(db, config, payload) {
  const range = normalizeRangePayload(payload);
  const [dashboard, historyQueues] = await Promise.all([
    getDashboardForRange(db, config, range),
    getHistoryQueues(db, range),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    scope: 'history',
    requestedRange: range,
    dashboard,
    colas: historyQueues,
  };
}

export function createDashboardAdminService(pool, config) {
  const db = createDashboardAdminDbAdapter(pool);

  return {
    getDashboard: () => getDashboard(db, config),
    getMobileSnapshot: () => getMobileSnapshot(db, config),
    getMobileCurrentDashboardMetrics: () => getMobileCurrentDashboardMetrics(db, config),
    getMobileCurrentDashboardRevenue: () => getMobileCurrentDashboardRevenue(db, config),
    getMobileCurrentQueueFragment: (status, queueType) =>
      getMobileCurrentQueueFragment(db, config, status, queueType),
    getHistoryDataset: (payload) => getHistoryDataset(db, config, payload),
  };
}
