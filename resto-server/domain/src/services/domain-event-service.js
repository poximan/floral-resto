export const MOBILE_CURRENT_FRAGMENT_KEYS = {
  dashboardMetrics: 'dashboard.metrics',
  dashboardRevenue: 'dashboard.revenue',
  queuePendienteConsultas: 'queue.pendiente.consultas',
  queueAtendidoConsultas: 'queue.atendido.consultas',
  queuePendientePedidosCocina: 'queue.pendiente.pedidosCocina',
  queueAtendidoPedidosCocina: 'queue.atendido.pedidosCocina',
  queueCobradaPedidosCocina: 'queue.cobrada.pedidosCocina',
  queuePendienteLlamadosMozo: 'queue.pendiente.llamadosMozo',
  queueAtendidoLlamadosMozo: 'queue.atendido.llamadosMozo',
};

export function uniqueFragmentKeys(fragmentKeys) {
  return Array.from(new Set(fragmentKeys.filter(Boolean)));
}

const domainEventSubscribers = new Set();

export function subscribeDomainEvents(subscriber) {
  domainEventSubscribers.add(subscriber);

  return () => {
    domainEventSubscribers.delete(subscriber);
  };
}

export async function publishDomainEvent(client, payload) {
  const message = JSON.stringify({
    emittedAt: new Date().toISOString(),
    ...payload,
  });

  for (const subscriber of domainEventSubscribers) {
    try {
      subscriber(message);
    } catch {
      // Sin accion.
    }
  }
}
