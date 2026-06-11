import { createMesaAdminDbAdapter } from '../db/adapters/mesa-admin-db-adapter.js';
import { DomainError } from './domain-error.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS } from './domain-event-service.js';
import { publishMesaPublicRefresh, publishMobileCurrentRefresh } from './mesa-service-shared.js';

function isUniqueMesaNombreViolation(error) {
  return error?.code === '23505' && error?.constraint === 'uq_mesas_nombre';
}

function normalizeMesaNombre(value) {
  const nombre = String(value ?? '').trim();

  if (!nombre) {
    throw new DomainError(400, 'El nombre de mesa es obligatorio');
  }

  return nombre;
}

function mapMesa(row) {
  return {
    id: Number(row.id),
    numero: row.nombre,
    nombre: row.nombre,
    sesionActiva: row.sesion_activa,
    mesaSesionId: row.mesa_sesion_id ? Number(row.mesa_sesion_id) : null,
    comandaConfirmada: Number(row.comandas_confirmadas_count ?? 0) > 0,
    comandasConfirmadasCount: Number(row.comandas_confirmadas_count ?? 0),
  };
}

function mapMesaMutation(row) {
  return {
    id: Number(row.id),
    numero: row.nombre,
    nombre: row.nombre,
  };
}

async function listMesas(db) {
  return db.withConnection(async ({ repository }) => {
    const rows = await repository.listMesas();
    return rows.map(mapMesa);
  });
}

async function createMesa(db, recordAuditEvent, payload, actorNombre) {
  const nombre = normalizeMesaNombre(payload.nombre);

  return db.withTransaction(async ({ client, repository }) => {
    let mesa = null;
    try {
      mesa = await repository.createMesa(nombre);
    } catch (error) {
      if (isUniqueMesaNombreViolation(error)) {
        throw new DomainError(409, 'Ya existe una mesa con ese nombre');
      }

      throw error;
    }

    await recordAuditEvent(client, {
      agregado: 'mesas',
      agregadoId: mesa.id,
      evento: 'mesa_creada',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        nombre,
      },
    });

    return mapMesaMutation(mesa);
  });
}

async function closeMesa(db, recordAuditEvent, publishDomainEvent, mesaNumero, actorNombre) {
  const nombre = normalizeMesaNombre(mesaNumero);

  return db.withTransaction(async ({ client, repository }) => {
    const mesa = await repository.getMesaByNumeroForUpdate(nombre);
    if (!mesa) {
      throw new DomainError(404, 'La mesa no existe');
    }

    const mesaSesion = await repository.getOpenSessionForClose(mesa.id);
    if (!mesaSesion) {
      throw new DomainError(409, 'La mesa no tiene una sesion activa para cerrar');
    }

    const actor = actorNombre ?? 'mozo';

    await repository.closeMesaSession(mesaSesion.id);
    await repository.disconnectMesaClients(mesaSesion.id);
    await repository.closePendingConsultas(mesaSesion.id, `mozo:${actor}`);
    await repository.receivePendingWaiterCalls(mesaSesion.id, actor);
    await repository.receivePendingKitchenOrders(mesaSesion.id, actor);
    await repository.markConfirmedComandasAsPaid(mesaSesion.id);
    await repository.clearOpenComanda(mesaSesion.id);

    await recordAuditEvent(client, {
      agregado: 'mesa_sesiones',
      agregadoId: mesaSesion.id,
      evento: 'mesa_cerrada',
      actorTipo: 'mozo',
      actorReferencia: actor,
      payload: {
        mesaNumero: mesa.nombre,
        comandaConfirmada: Number(mesaSesion.comandas_confirmadas_count) > 0,
        comandasConfirmadasCount: Number(mesaSesion.comandas_confirmadas_count),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'mesa_cerrada',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardRevenue,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteConsultas,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoConsultas,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendientePedidosCocina,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoPedidosCocina,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteLlamadosMozo,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoLlamadosMozo,
      ],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'mesa_cerrada', mesa.nombre);

    return {
      mesaNumero: mesa.nombre,
      mesaNombre: mesa.nombre,
      mesaSesionId: Number(mesaSesion.id),
      comandaConfirmada: Number(mesaSesion.comandas_confirmadas_count) > 0,
      comandasConfirmadasCount: Number(mesaSesion.comandas_confirmadas_count),
      cerrada: true,
    };
  });
}

async function openMesa(db, recordAuditEvent, publishDomainEvent, mesaNumero, actorNombre) {
  const nombre = normalizeMesaNombre(mesaNumero);

  return db.withTransaction(async ({ client, repository }) => {
    const mesa = await repository.getMesaByNumeroForUpdate(nombre);
    if (!mesa) {
      throw new DomainError(404, 'La mesa no existe');
    }

    const activeSessionId = await repository.getActiveSessionId(mesa.id);
    if (activeSessionId) {
      throw new DomainError(409, 'La mesa ya tiene una sesion activa');
    }

    const actor = actorNombre ?? 'mozo';
    const mesaSesion = await repository.createMesaSession(mesa.id);

    await recordAuditEvent(client, {
      agregado: 'mesa_sesiones',
      agregadoId: mesaSesion.id,
      evento: 'mesa_sesion_abierta_por_mozo',
      actorTipo: 'mozo',
      actorReferencia: actor,
      payload: {
        mesaNumero: mesa.nombre,
      },
    });

    await publishMesaPublicRefresh(client, publishDomainEvent, 'mesa_sesion_abierta_por_mozo', mesa.nombre);

    return {
      mesaNumero: mesa.nombre,
      mesaNombre: mesa.nombre,
      mesaSesionId: Number(mesaSesion.id),
      abierta: true,
    };
  });
}

export function createMesaAdminService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createMesaAdminDbAdapter(pool);

  return {
    listMesas: () => listMesas(db),
    createMesa: (payload, actorNombre) => createMesa(db, recordAuditEvent, payload, actorNombre),
    openMesa: (mesaNumero, actorNombre) =>
      openMesa(db, recordAuditEvent, publishDomainEvent, mesaNumero, actorNombre),
    closeMesa: (mesaNumero, actorNombre) =>
      closeMesa(db, recordAuditEvent, publishDomainEvent, mesaNumero, actorNombre),
  };
}
