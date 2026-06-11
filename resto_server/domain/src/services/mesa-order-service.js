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
  syncComandaWithCatalog,
  touchMesaClient,
} from './mesa-service-shared.js';

const maxProductCounterQuantity = 15;

async function ensureOpenComanda(repository, mesaSesionId) {
  return (await repository.getOpenComanda(mesaSesionId)) ?? repository.createOpenComanda(mesaSesionId);
}

async function updateComandaItem(
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
    throw new DomainError(400, 'La accion de la comanda es invalida');
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
    await syncComandaWithCatalog(repository, mesaSesion.id);

    const product = await repository.getProduct(productoId);
    if (!product || !product.activo) {
      throw new DomainError(404, 'El producto no existe o ya no esta disponible');
    }

    const comanda = await ensureOpenComanda(repository, mesaSesion.id);
    const existing = await repository.getOwnedComandaItem(comanda.id, productoId, clientSessionId);

    if (action === 'add') {
      const currentProductQuantity = await repository.getComandaProductQuantity(comanda.id, productoId);
      if (currentProductQuantity >= maxProductCounterQuantity) {
        throw new DomainError(409, `El contador admite hasta ${maxProductCounterQuantity} unidades por producto`);
      }

      if (!existing) {
        await repository.insertComandaItem(
          comanda.id,
          productoId,
          clientSessionId,
          product.titulo,
          product.descripcion,
          product.precio_ars_centavos,
          1,
        );
      } else {
        await repository.incrementComandaItem(existing.id, 1);
      }
    } else if (!existing) {
      throw new DomainError(409, 'Solo puedes descartar productos de tu propiedad en la mesa');
    } else if (Number(existing.cantidad) <= 1) {
      await repository.deleteComandaItem(existing.id);
    } else {
      await repository.decrementComandaItem(existing.id, 1);
    }

    await recordAuditEvent(client, {
      agregado: 'mesa_sesiones',
      agregadoId: mesaSesion.id,
      evento: action === 'add' ? 'comanda_item_agregado' : 'comanda_item_descartado',
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

    await publishMesaPublicRefresh(client, publishDomainEvent, `comanda_${action}`, mesa.nombre);

    const state = await buildMesaState(repository, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(repository, mesaSesion.id);

    return {
      menu: mapMenuRowsToCategories(menuRows),
      state,
    };
  });
}

async function confirmComanda(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
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

    await syncComandaWithCatalog(repository, mesaSesion.id);

    const comanda = await repository.getOpenComanda(mesaSesion.id);
    if (!comanda) {
      throw new DomainError(409, 'No hay una comanda abierta para confirmar');
    }

    const comandaRows = await repository.listComandaRowsForConfirmation(comanda.id);
    if (comandaRows.length === 0) {
      throw new DomainError(409, 'No se puede confirmar una comanda vacia');
    }

    const totalArsCentavos = comandaRows.reduce(
      (accumulator, row) => accumulator + (Number(row.precio_ars_centavos) * Number(row.cantidad)),
      0,
    );
    const nextComandaNumber = await repository.getNextComandaNumber(mesaSesion.id);
    const comandaConfirmada = await repository.confirmComanda(comanda.id, nextComandaNumber, totalArsCentavos);

    await repository.createKitchenOrder(comandaConfirmada.id);

    await recordAuditEvent(client, {
      agregado: 'comanda_sesiones',
      agregadoId: comandaConfirmada.id,
      evento: 'comanda_confirmada',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        mesaSesionId: Number(mesaSesion.id),
        numeroOrden: Number(comandaConfirmada.numero_orden),
        totalArsCentavos: Number(comandaConfirmada.total_ars_centavos),
        items: comandaRows.map((row) => ({
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
      'comanda_confirmada',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendientePedidosCocina,
      ],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'comanda_confirmada', mesa.nombre);

    const state = await buildMesaState(repository, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(repository, mesaSesion.id);

    return {
      menu: mapMenuRowsToCategories(menuRows),
      state,
      comandaConfirmada: {
        id: Number(comandaConfirmada.id),
        numeroOrden: Number(comandaConfirmada.numero_orden),
        totalArsCentavos: Number(comandaConfirmada.total_ars_centavos),
        confirmadaEn: comandaConfirmada.confirmada_en,
      },
    };
  });
}

export function createMesaOrderService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createMesaPublicDbAdapter(pool);

  return {
    updateComandaItem: (mesaNumero, clientSessionId, productoId, action) =>
      updateComandaItem(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, productoId, action),
    confirmComanda: (mesaNumero, clientSessionId) =>
      confirmComanda(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
  };
}
