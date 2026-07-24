import { createMesaPublicDbAdapter } from '../db/adapters/mesa-public-db-adapter.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS } from './domain-event-service.js';
import { DomainError } from './domain-error.js';
import {
  buildMesaState,
  getPendingCall,
  getPendingConsulta,
  lockMesaSession,
  publishMesaPublicRefresh,
  publishMobileCurrentRefresh,
  requireActiveMesaClientSession,
} from './mesa-service-shared.js';

async function callWaiter(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion } = await requireActiveMesaClientSession(
      repository,
      mesaNumero,
      clientSessionId,
    );
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);

    const pendingCall = await getPendingCall(repository, mesaSesion.id);
    if (pendingCall) {
      throw new DomainError(409, 'La mesa ya tiene un llamado a mozo pendiente');
    }

    const callResult = await repository.createWaiterCall(mesaSesion.id, clientSessionId);

    await recordAuditEvent(client, {
      agregado: 'llamados_mozo',
      agregadoId: callResult.id,
      evento: 'llamado_creado',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        mesaSesionId: Number(mesaSesion.id),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'llamado_creado',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteLlamadosMozo,
      ],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'llamado_creado', mesa.nombre);

    return buildMesaState(repository, mesa, mesaSesion, clientSessionId);
  });
}

async function openConsulta(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, contenido) {
  if (!contenido?.trim()) {
    throw new DomainError(400, 'El contenido de la consulta es obligatorio');
  }

  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion } = await requireActiveMesaClientSession(
      repository,
      mesaNumero,
      clientSessionId,
    );
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);

    const pendingConsulta = await getPendingConsulta(repository, mesaSesion.id);
    if (pendingConsulta) {
      throw new DomainError(409, 'La mesa ya tiene una consulta abierta');
    }

    const consulta = await repository.createConsulta(mesaSesion.id, clientSessionId);
    await repository.insertConsultaMessage(consulta.id, 'cliente', clientSessionId, contenido.trim());

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: consulta.id,
      evento: 'consulta_abierta',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        mesaSesionId: Number(mesaSesion.id),
        contenido: contenido.trim(),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'consulta_abierta',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteConsultas,
      ],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'consulta_abierta', mesa.nombre);

    return buildMesaState(repository, mesa, mesaSesion, clientSessionId);
  });
}

async function sendConsultaMessageFromClient(
  db,
  recordAuditEvent,
  publishDomainEvent,
  mesaNumero,
  clientSessionId,
  contenido,
) {
  if (!contenido?.trim()) {
    throw new DomainError(400, 'El mensaje es obligatorio');
  }

  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion } = await requireActiveMesaClientSession(
      repository,
      mesaNumero,
      clientSessionId,
    );
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);

    const pendingConsulta = await getPendingConsulta(repository, mesaSesion.id);
    if (!pendingConsulta) {
      throw new DomainError(409, 'La mesa no tiene una consulta abierta');
    }

    await repository.insertConsultaMessage(pendingConsulta.id, 'cliente', clientSessionId, contenido.trim());

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: pendingConsulta.id,
      evento: 'consulta_mensaje_cliente',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        mesaSesionId: Number(mesaSesion.id),
        contenido: contenido.trim(),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'consulta_mensaje_cliente',
      [MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteConsultas],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'consulta_mensaje_cliente', mesa.nombre);

    return buildMesaState(repository, mesa, mesaSesion, clientSessionId);
  });
}

async function closeConsultaFromClient(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  return db.withTransaction(async ({ client, repository }) => {
    const { mesa, mesaSesion: unlockedMesaSesion } = await requireActiveMesaClientSession(
      repository,
      mesaNumero,
      clientSessionId,
    );
    const mesaSesion = await lockMesaSession(repository, unlockedMesaSesion.id);

    const pendingConsulta = await getPendingConsulta(repository, mesaSesion.id);
    if (!pendingConsulta) {
      throw new DomainError(409, 'La mesa no tiene una consulta abierta');
    }

    await repository.closeConsulta(pendingConsulta.id, `cliente:${clientSessionId}`);

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: pendingConsulta.id,
      evento: 'consulta_cerrada_por_cliente',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.nombre,
        mesaSesionId: Number(mesaSesion.id),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'consulta_cerrada_por_cliente',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteConsultas,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoConsultas,
      ],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'consulta_cerrada_por_cliente', mesa.nombre);

    return buildMesaState(repository, mesa, mesaSesion, clientSessionId);
  });
}

export function createMesaSupportService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createMesaPublicDbAdapter(pool);

  return {
    callWaiter: (mesaNumero, clientSessionId) =>
      callWaiter(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
    openConsulta: (mesaNumero, clientSessionId, contenido) =>
      openConsulta(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, contenido),
    sendConsultaMessageFromClient: (mesaNumero, clientSessionId, contenido) =>
      sendConsultaMessageFromClient(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, contenido),
    closeConsultaFromClient: (mesaNumero, clientSessionId) =>
      closeConsultaFromClient(db, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
  };
}
