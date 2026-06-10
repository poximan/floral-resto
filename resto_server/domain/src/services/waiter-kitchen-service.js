import { createWaiterDbAdapter } from '../db/adapters/waiter-db-adapter.js';
import { DomainError } from './domain-error.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS } from './domain-event-service.js';
import { publishMobileCurrentRefresh } from './mesa-service-shared.js';

async function getKitchenOrderDetail(db, kitchenOrderId) {
  return db.withConnection(async ({ repository }) => {
    const order = await repository.getKitchenOrder(kitchenOrderId);
    if (!order) {
      throw new DomainError(404, 'El pedido de cocina no existe');
    }

    const items = await repository.listKitchenOrderItems(order.pedido_sesion_id);

    return {
      id: Number(order.id),
      mesaNumero: String(order.mesa_numero),
      mesaSesionId: Number(order.mesa_sesion_id),
      estado: order.estado,
      creadaEn: order.creada_en,
      atendidaEn: order.atendida_en,
      totalArsCentavos: Number(order.total_ars_centavos),
      items: items.map((row) => ({
        titulo: row.titulo_snapshot,
        descripcion: row.descripcion_snapshot,
        precioArsCentavos: Number(row.precio_ars_centavos_snapshot),
        cantidad: Number(row.cantidad),
        clienteSesionId: row.cliente_sesion_id,
        clienteNombre: row.cliente_nombre ?? null,
      })),
    };
  });
}

async function receiveKitchenOrder(db, recordAuditEvent, publishDomainEvent, kitchenOrderId, actorNombre) {
  return db.withTransaction(async ({ client, repository }) => {
    const result = await repository.receiveKitchenOrder(kitchenOrderId, actorNombre ?? 'mozo');

    if (result.rowCount === 0) {
      throw new DomainError(404, 'El pedido de cocina pendiente no existe');
    }

    await recordAuditEvent(client, {
      agregado: 'pedidos_cocina',
      agregadoId: kitchenOrderId,
      evento: 'pedido_cocina_atendido',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {},
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'pedido_cocina_atendido',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendientePedidosCocina,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoPedidosCocina,
      ],
    );

    return {
      id: Number(result.rows[0].id),
      status: 'atendido',
    };
  });
}

export function createWaiterKitchenService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createWaiterDbAdapter(pool);

  return {
    getKitchenOrderDetail: (kitchenOrderId) => getKitchenOrderDetail(db, kitchenOrderId),
    receiveKitchenOrder: (kitchenOrderId, actorNombre) =>
      receiveKitchenOrder(db, recordAuditEvent, publishDomainEvent, kitchenOrderId, actorNombre),
  };
}
