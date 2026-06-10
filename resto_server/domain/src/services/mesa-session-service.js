import { createMesaPublicDbAdapter } from '../db/adapters/mesa-public-db-adapter.js';
import { adoptOrphanCartItems, applyCartOwnershipOnConfirmedDeparture } from './mesa-cart-ownership-service.js';
import {
  assignLeaderIfMissing,
  buildMesaState,
  clearPendingDisconnectTimer,
  countConnectedMesaClients,
  ensureMesaAndSession,
  ensureMesaClient,
  getDisconnectTimerKey,
  getMenuRows,
  hasPendingDisconnect,
  lockMesaSession,
  mapMenuRowsToCategories,
  pendingDisconnectTimers,
  publishMesaPublicRefresh,
  requireActiveMesaClientSession,
  scheduleMesaClientDisconnect,
  syncCartWithCatalog,
  touchMesaClient,
} from './mesa-service-shared.js';

async function getMesaContext(
  db,
  recordAuditEvent,
  publishDomainEvent,
  mesaNumero,
  requestedClientSessionId,
  requestedClientName,
) {
  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion, mesaSesionCreada } = await ensureMesaAndSession(repository, mesaNumero);
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);
    const {
      clientSessionId,
      clientName,
      clientCreated,
      clientReconnected,
    } = await ensureMesaClient(
      repository,
      mesaSesion.id,
      requestedClientSessionId,
      requestedClientName,
    );
    const leaderClientSessionId = await assignLeaderIfMissing(repository, mesaSesion.id);
    const currentIsLeader = leaderClientSessionId === clientSessionId;

    const adoptedOrphanItemsCount = currentIsLeader
      ? await adoptOrphanCartItems(repository, mesaSesion.id, clientSessionId)
      : 0;

    if (mesaSesionCreada) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: 'mesa_sesion_abierta',
        actorTipo: 'cliente',
        actorReferencia: clientSessionId,
        payload: {
          mesaNumero: mesa.nombre,
        },
      });
    }

    if (clientCreated) {
      await recordAuditEvent(client, {
        agregado: 'mesa_clientes',
        agregadoId: `${mesaSesion.id}:${clientSessionId}`,
        evento: 'cliente_mesa_ingresado',
        actorTipo: 'cliente',
        actorReferencia: clientSessionId,
        payload: {
          mesaNumero: mesa.nombre,
          mesaSesionId: Number(mesaSesion.id),
          clienteNombre: clientName,
        },
      });
    } else if (clientReconnected) {
      await recordAuditEvent(client, {
        agregado: 'mesa_clientes',
        agregadoId: `${mesaSesion.id}:${clientSessionId}`,
        evento: 'cliente_mesa_reconectado',
        actorTipo: 'cliente',
        actorReferencia: clientSessionId,
        payload: {
          mesaNumero: mesa.nombre,
          mesaSesionId: Number(mesaSesion.id),
          clienteNombre: clientName,
        },
      });
    }

    if (adoptedOrphanItemsCount > 0) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: 'carrito_huerfano_heredado',
        actorTipo: 'cliente',
        actorReferencia: clientSessionId,
        payload: {
          mesaNumero: mesa.nombre,
          cantidadItemsHeredados: adoptedOrphanItemsCount,
        },
      });
    }

    if (mesaSesionCreada || clientCreated || clientReconnected) {
      await publishMesaPublicRefresh(
        client,
        publishDomainEvent,
        adoptedOrphanItemsCount > 0
          ? 'carrito_huerfano_heredado'
          : clientCreated
            ? 'cliente_mesa_ingresado'
            : clientReconnected
              ? 'cliente_mesa_reconectado'
              : 'mesa_sesion_abierta',
        mesa.nombre,
      );
    }

    const state = await buildMesaState(repository, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(repository, mesaSesion.id);

    return {
      mesaNumero: mesa.nombre,
      mesaSesionId: Number(mesaSesion.id),
      clientSessionId,
      clientName,
      isLeader: currentIsLeader,
      menu: mapMenuRowsToCategories(menuRows),
      state,
    };
  });
}

async function finalizeClientDisconnect(
  db,
  recordAuditEvent,
  publishDomainEvent,
  mesaNumero,
  clientSessionId,
  { force = false } = {},
) {
  return db.withTransaction(async ({ client, repository }) => {
    const mesa = await repository.getMesaByNumero(mesaNumero);
    if (!mesa) {
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const unlockedMesaSesion = await repository.getActiveMesaSession(mesa.id);
    const mesaSesion = unlockedMesaSesion
      ? await lockMesaSession(repository, unlockedMesaSesion.id)
      : null;
    if (!mesaSesion) {
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const mesaCliente = await repository.getMesaClient(mesaSesion.id, clientSessionId);
    if (!mesaCliente || mesaCliente.conectada === false || (!force && !hasPendingDisconnect(mesaCliente))) {
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const disconnectDeadlineMs = new Date(mesaCliente.desconexion_programada_en).getTime();
    if (!force && Number.isFinite(disconnectDeadlineMs) && disconnectDeadlineMs > Date.now()) {
      return {
        disconnected: false,
        ignored: true,
      };
    }

    await repository.markMesaClientDisconnected(mesaSesion.id, clientSessionId);

    const previousLeaderClientSessionId = mesaSesion.lider_cliente_sesion_id ?? null;
    const nextLeaderClientSessionId = await assignLeaderIfMissing(repository, mesaSesion.id);
    const connectedClients = await countConnectedMesaClients(repository, mesaSesion.id);
    const cartOwnershipResult = await applyCartOwnershipOnConfirmedDeparture(
      repository,
      mesaSesion.id,
      clientSessionId,
      nextLeaderClientSessionId,
      connectedClients,
    );

    await recordAuditEvent(client, {
      agregado: 'mesa_clientes',
      agregadoId: `${mesaSesion.id}:${clientSessionId}`,
      evento: 'cliente_mesa_desconectado',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        mesaSesionId: Number(mesaSesion.id),
      },
    });

    if (previousLeaderClientSessionId && previousLeaderClientSessionId !== nextLeaderClientSessionId) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: nextLeaderClientSessionId ? 'liderazgo_transferido' : 'liderazgo_vacante',
        actorTipo: 'sistema',
        actorReferencia: 'mesa_disconnect',
        payload: {
          mesaNumero: mesa.nombre,
          liderActualClienteSesionId: nextLeaderClientSessionId,
        },
      });
    }

    if (cartOwnershipResult.mode === 'orphaned' && cartOwnershipResult.itemCount > 0) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: 'carrito_pendiente_huerfano',
        actorTipo: 'sistema',
        actorReferencia: 'mesa_disconnect',
        payload: {
          mesaNumero: mesa.nombre,
          cantidadItemsHuerfanos: cartOwnershipResult.itemCount,
        },
      });
    } else if (cartOwnershipResult.mode === 'transferred' && cartOwnershipResult.itemCount > 0) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: 'carrito_pendiente_reasignado',
        actorTipo: 'sistema',
        actorReferencia: 'mesa_disconnect',
        payload: {
          mesaNumero: mesa.nombre,
          cantidadItemsReasignados: cartOwnershipResult.itemCount,
          propietarioActualClienteSesionId: cartOwnershipResult.ownerClientSessionId,
        },
      });
    }

    await publishMesaPublicRefresh(client, publishDomainEvent, 'cliente_mesa_desconectado', mesa.nombre);

    return {
      disconnected: true,
      ignored: false,
      mesaSesionId: Number(mesaSesion.id),
      leaderClientSessionId: nextLeaderClientSessionId,
    };
  });
}

function scheduleClientDisconnectFinalization(
  db,
  recordAuditEvent,
  publishDomainEvent,
  mesaNumero,
  mesaSesionId,
  clientSessionId,
  graceSeconds,
) {
  clearPendingDisconnectTimer(mesaSesionId, clientSessionId);

  const timerKey = getDisconnectTimerKey(mesaSesionId, clientSessionId);
  const timerId = setTimeout(() => {
    pendingDisconnectTimers.delete(timerKey);

    finalizeClientDisconnect(
      db,
      recordAuditEvent,
      publishDomainEvent,
      mesaNumero,
      clientSessionId,
    ).catch(() => {
      // Sin accion.
    });
  }, graceSeconds * 1000);

  pendingDisconnectTimers.set(timerKey, timerId);
}

function scheduleRecoveredClientDisconnectFinalization(
  db,
  recordAuditEvent,
  publishDomainEvent,
  mesaNumero,
  mesaSesionId,
  clientSessionId,
  disconnectScheduledAt,
) {
  clearPendingDisconnectTimer(mesaSesionId, clientSessionId);

  const disconnectDeadlineMs = new Date(disconnectScheduledAt).getTime();
  const delayMs = Number.isFinite(disconnectDeadlineMs)
    ? Math.max(0, disconnectDeadlineMs - Date.now())
    : 0;
  const timerKey = getDisconnectTimerKey(mesaSesionId, clientSessionId);
  const timerId = setTimeout(() => {
    pendingDisconnectTimers.delete(timerKey);

    finalizeClientDisconnect(
      db,
      recordAuditEvent,
      publishDomainEvent,
      mesaNumero,
      clientSessionId,
    ).catch(() => {
      // Sin accion.
    });
  }, delayMs);

  pendingDisconnectTimers.set(timerKey, timerId);
}

async function connectClient(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion } = await requireActiveMesaClientSession(
      repository,
      mesaNumero,
      clientSessionId,
    );
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);
    const leaderBefore = mesaSesion.lider_cliente_sesion_id ?? null;

    await touchMesaClient(repository, mesaSesion.id, clientSessionId);

    const leaderAfter = await assignLeaderIfMissing(repository, mesaSesion.id);
    const adoptedOrphanItemsCount = leaderAfter === clientSessionId
      ? await adoptOrphanCartItems(repository, mesaSesion.id, clientSessionId)
      : 0;

    if (adoptedOrphanItemsCount > 0) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: 'carrito_huerfano_heredado',
        actorTipo: 'cliente',
        actorReferencia: clientSessionId,
        payload: {
          mesaNumero: mesa.nombre,
          cantidadItemsHeredados: adoptedOrphanItemsCount,
        },
      });
    }

    if (leaderBefore !== leaderAfter || adoptedOrphanItemsCount > 0) {
      await publishMesaPublicRefresh(
        client,
        publishDomainEvent,
        adoptedOrphanItemsCount > 0 ? 'carrito_huerfano_heredado' : 'cliente_mesa_conectado',
        mesa.nombre,
      );
    }

    return {
      connected: true,
      mesaSesionId: Number(mesaSesion.id),
      leaderClientSessionId: leaderAfter,
    };
  });
}

async function getMenu(db, mesaNumero, clientSessionId) {
  return db.withTransaction(async ({ repository }) => {
    const { mesa, mesaSesion } = await requireActiveMesaClientSession(repository, mesaNumero, clientSessionId);

    await touchMesaClient(repository, mesaSesion.id, clientSessionId);
    await assignLeaderIfMissing(repository, mesaSesion.id);
    await syncCartWithCatalog(repository, mesaSesion.id);
    const rows = await getMenuRows(repository, mesaSesion.id);

    return {
      mesaNumero: mesa.nombre,
      mesaSesionId: Number(mesaSesion.id),
      categorias: mapMenuRowsToCategories(rows),
    };
  });
}

async function disconnectClient(
  db,
  recordAuditEvent,
  publishDomainEvent,
  disconnectGraceSeconds,
  mesaNumero,
  clientSessionId,
  { immediate = false } = {},
) {
  if (!clientSessionId) {
    return {
      disconnected: false,
      ignored: true,
    };
  }

  const result = await db.withTransaction(async ({ repository }) => {
    const mesa = await repository.getMesaByNumero(mesaNumero);
    if (!mesa) {
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const mesaSesion = await repository.getActiveMesaSession(mesa.id);
    if (!mesaSesion) {
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const mesaCliente = await repository.getMesaClient(mesaSesion.id, clientSessionId);
    if (!mesaCliente) {
      return {
        disconnected: false,
        ignored: true,
      };
    }

    if (mesaCliente.conectada === false) {
      return {
        disconnected: true,
        ignored: true,
      };
    }

    if (!immediate) {
      await scheduleMesaClientDisconnect(
        repository,
        mesaSesion.id,
        clientSessionId,
        disconnectGraceSeconds,
      );
    }

    return {
      disconnected: false,
      pending: !immediate,
      immediate,
      mesaNumero: mesa.nombre,
      mesaSesionId: Number(mesaSesion.id),
    };
  });

  if (result.immediate) {
    return finalizeClientDisconnect(
      db,
      recordAuditEvent,
      publishDomainEvent,
      result.mesaNumero,
      clientSessionId,
      { force: true },
    );
  }

  if (result.pending) {
    scheduleClientDisconnectFinalization(
      db,
      recordAuditEvent,
      publishDomainEvent,
      result.mesaNumero,
      result.mesaSesionId,
      clientSessionId,
      disconnectGraceSeconds,
    );
  }

  return result.pending
    ? {
        disconnected: false,
        pending: true,
        mesaSesionId: result.mesaSesionId,
      }
    : result;
}

async function recoverPendingDisconnects(db, recordAuditEvent, publishDomainEvent) {
  const pendingDisconnects = await db.withConnection(async ({ repository }) => {
    const rows = await repository.listPendingDisconnects();

    return rows.map((row) => ({
      mesaSesionId: Number(row.mesa_sesion_id),
      mesaNumero: String(row.mesa_numero),
      clientSessionId: row.cliente_sesion_id,
      disconnectScheduledAt: row.desconexion_programada_en,
    }));
  });

  for (const pendingDisconnect of pendingDisconnects) {
    scheduleRecoveredClientDisconnectFinalization(
      db,
      recordAuditEvent,
      publishDomainEvent,
      pendingDisconnect.mesaNumero,
      pendingDisconnect.mesaSesionId,
      pendingDisconnect.clientSessionId,
      pendingDisconnect.disconnectScheduledAt,
    );
  }

  return {
    recoveredDisconnects: pendingDisconnects.length,
  };
}

async function getState(db, mesaNumero, clientSessionId) {
  return db.withTransaction(async ({ repository }) => {
    const { mesa, mesaSesion } = await requireActiveMesaClientSession(repository, mesaNumero, clientSessionId);

    await touchMesaClient(repository, mesaSesion.id, clientSessionId);
    await assignLeaderIfMissing(repository, mesaSesion.id);
    return buildMesaState(repository, mesa, mesaSesion, clientSessionId);
  });
}

export function createMesaSessionService(pool, config, recordAuditEvent, publishDomainEvent) {
  const db = createMesaPublicDbAdapter(pool);

  return {
    recoverPendingDisconnects: () =>
      recoverPendingDisconnects(db, recordAuditEvent, publishDomainEvent),
    getMesaContext: (mesaNumero, requestedClientSessionId, requestedClientName) =>
      getMesaContext(
        db,
        recordAuditEvent,
        publishDomainEvent,
        mesaNumero,
        requestedClientSessionId,
        requestedClientName,
      ),
    connectClient: (mesaNumero, clientSessionId) =>
      connectClient(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
    getMenu: (mesaNumero, clientSessionId) => getMenu(db, mesaNumero, clientSessionId),
    disconnectClient: (mesaNumero, clientSessionId, options) =>
      disconnectClient(
        db,
        recordAuditEvent,
        publishDomainEvent,
        config.mesaClientDisconnectGraceSeconds,
        mesaNumero,
        clientSessionId,
        options,
      ),
    getState: (mesaNumero, clientSessionId) => getState(db, mesaNumero, clientSessionId),
  };
}
