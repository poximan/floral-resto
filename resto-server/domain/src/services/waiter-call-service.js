import { createWaiterDbAdapter } from '../db/adapters/waiter-db-adapter.js';
import { DomainError } from './domain-error.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS } from './domain-event-service.js';
import { publishMesaPublicRefresh, publishMobileCurrentRefresh } from './mesa-service-shared.js';

async function getWaiterCallDetail(db, waiterCallId) {
  return db.withConnection(async ({ repository }) => {
    const waiterCall = await repository.getWaiterCall(waiterCallId);
    if (!waiterCall) {
      throw new DomainError(404, 'El llamado a mozo no existe');
    }

    return {
      id: Number(waiterCall.id),
      mesaNumero: String(waiterCall.mesa_numero),
      mesaSesionId: Number(waiterCall.mesa_sesion_id),
      estado: waiterCall.estado,
      creadaEn: waiterCall.creada_en,
      atendidaEn: waiterCall.atendida_en,
      atendidaPor: waiterCall.atendida_por,
      clienteSesionId: waiterCall.cliente_sesion_id,
      clienteNombre: waiterCall.cliente_nombre ?? null,
    };
  });
}

async function receiveWaiterCall(db, recordAuditEvent, publishDomainEvent, waiterCallId, actorNombre) {
  return db.withTransaction(async ({ client, repository }) => {
    const waiterCall = await repository.getWaiterCall(waiterCallId);
    if (!waiterCall || waiterCall.estado !== 'pendiente') {
      throw new DomainError(404, 'El llamado pendiente no existe');
    }

    const updateResult = await repository.receiveWaiterCall(waiterCallId, actorNombre ?? 'mozo');
    if (updateResult.rowCount === 0) {
      throw new DomainError(404, 'El llamado pendiente no existe');
    }

    await recordAuditEvent(client, {
      agregado: 'llamados_mozo',
      agregadoId: waiterCallId,
      evento: 'llamado_atendido',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {},
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'llamado_atendido',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteLlamadosMozo,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoLlamadosMozo,
      ],
    );

    await publishMesaPublicRefresh(
      client,
      publishDomainEvent,
      'llamado_atendido',
      waiterCall.mesa_numero,
    );

    return {
      id: Number(waiterCall.id),
      status: 'atendido',
    };
  });
}

export function createWaiterCallService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createWaiterDbAdapter(pool);

  return {
    getWaiterCallDetail: (waiterCallId) => getWaiterCallDetail(db, waiterCallId),
    receiveWaiterCall: (waiterCallId, actorNombre) =>
      receiveWaiterCall(db, recordAuditEvent, publishDomainEvent, waiterCallId, actorNombre),
  };
}
