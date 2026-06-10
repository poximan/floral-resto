import { createMesaPublicDbAdapter } from '../db/adapters/mesa-public-db-adapter.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS } from './domain-event-service.js';
import { DomainError } from './domain-error.js';
import {
  assignLeaderIfMissing,
  buildMesaState,
  getMenuRows,
  lockMesaSession,
  mapMenuRowsToCategories,
  publishMesaPublicRefresh,
  publishMobileCurrentRefresh,
  requireActiveMesaClientSession,
  syncCartWithCatalog,
  touchMesaClient,
} from './mesa-service-shared.js';

async function updateCartItem(
  db,
  recordAuditEvent,
  publishDomainEvent,
  mesaNumero,
  clientSessionId,
  productoId,
  action,
) {
  if (!productoId) {
    throw new DomainError(400, 'Falta productoId');
  }
  if (!['add', 'remove'].includes(action)) {
    throw new DomainError(400, 'La accion del carrito es invalida');
  }

  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion } = await requireActiveMesaClientSession(
      repository,
      mesaNumero,
      clientSessionId,
    );
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);

    await touchMesaClient(repository, mesaSesion.id, clientSessionId);
    await assignLeaderIfMissing(repository, mesaSesion.id);
    await syncCartWithCatalog(repository, mesaSesion.id);

    const product = await repository.getProduct(productoId);
    if (!product || !product.activo) {
      throw new DomainError(404, 'El producto no existe o ya no esta disponible');
    }

    const existing = await repository.getOwnedCartItem(mesaSesion.id, productoId, clientSessionId);

    if (action === 'add') {
      if (!existing) {
        await repository.insertCartItem(mesaSesion.id, productoId, clientSessionId, 1);
      } else {
        await repository.incrementCartItem(existing.id, 1);
      }
    } else if (!existing) {
      throw new DomainError(409, 'Solo puedes descartar productos de tu propiedad en la mesa');
    } else if (Number(existing.cantidad) <= 1) {
      await repository.deleteCartItem(existing.id);
    } else {
      await repository.decrementCartItem(existing.id, 1);
    }

    await recordAuditEvent(client, {
      agregado: 'mesa_sesiones',
      agregadoId: mesaSesion.id,
      evento: action === 'add' ? 'carrito_item_agregado' : 'carrito_item_descartado',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        productoId: Number(product.id),
        productoTitulo: product.titulo,
        accion: action,
        clienteSesionIdAfectada: clientSessionId,
      },
    });

    await publishMesaPublicRefresh(client, publishDomainEvent, `carrito_${action}`, mesa.nombre);

    const state = await buildMesaState(repository, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(repository, mesaSesion.id);

    return {
      menu: mapMenuRowsToCategories(menuRows),
      state,
    };
  });
}

async function confirmOrder(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion } = await requireActiveMesaClientSession(
      repository,
      mesaNumero,
      clientSessionId,
    );
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);

    if (mesaSesion.lider_cliente_sesion_id !== clientSessionId) {
      throw new DomainError(403, 'Solo el lider de la mesa puede confirmar el pedido');
    }

    await syncCartWithCatalog(repository, mesaSesion.id);

    const cartRows = await repository.listCartRowsForConfirmation(mesaSesion.id);
    if (cartRows.length === 0) {
      throw new DomainError(409, 'No se puede confirmar un pedido vacio');
    }

    const totalArsCentavos = cartRows.reduce(
      (accumulator, row) => accumulator + (Number(row.precio_ars_centavos) * Number(row.cantidad)),
      0,
    );
    const nextOrderNumber = await repository.getNextOrderNumber(mesaSesion.id);
    const pedidoSesion = await repository.createPedidoSesion(mesaSesion.id, nextOrderNumber, totalArsCentavos);

    for (const row of cartRows) {
      await repository.insertPedidoItemSnapshot(
        pedidoSesion.id,
        row.producto_id,
        row.cliente_sesion_id,
        row.titulo,
        row.descripcion,
        row.precio_ars_centavos,
        row.cantidad,
      );
    }

    await repository.createKitchenOrder(pedidoSesion.id);
    await repository.clearCart(mesaSesion.id);

    await recordAuditEvent(client, {
      agregado: 'pedido_sesiones',
      agregadoId: pedidoSesion.id,
      evento: 'pedido_confirmado',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        mesaSesionId: Number(mesaSesion.id),
        numeroOrden: Number(pedidoSesion.numero_orden),
        totalArsCentavos: Number(pedidoSesion.total_ars_centavos),
        items: cartRows.map((row) => ({
          productoId: Number(row.producto_id),
          titulo: row.titulo,
          cantidad: Number(row.cantidad),
          clienteSesionId: row.cliente_sesion_id,
        })),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'pedido_confirmado',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendientePedidosCocina,
      ],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'pedido_confirmado', mesa.nombre);

    const state = await buildMesaState(repository, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(repository, mesaSesion.id);

    return {
      menu: mapMenuRowsToCategories(menuRows),
      state,
      pedidoConfirmado: {
        id: Number(pedidoSesion.id),
        numeroOrden: Number(pedidoSesion.numero_orden),
        totalArsCentavos: Number(pedidoSesion.total_ars_centavos),
        confirmadoEn: pedidoSesion.confirmado_en,
      },
    };
  });
}

export function createMesaOrderService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createMesaPublicDbAdapter(pool);

  return {
    updateCartItem: (mesaNumero, clientSessionId, productoId, action) =>
      updateCartItem(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, productoId, action),
    confirmOrder: (mesaNumero, clientSessionId) =>
      confirmOrder(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
  };
}
