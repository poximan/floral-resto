import { createWaiterDbAdapter } from '../db/adapters/waiter-db-adapter.js';
import { DomainError } from './domain-error.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS } from './domain-event-service.js';
import { publishMesaPublicRefresh, publishMobileCurrentRefresh } from './mesa-service-shared.js';

function mapConsultaDetail(consulta, mensajes) {
  return {
    id: Number(consulta.id),
    mesaNumero: String(consulta.mesa_numero),
    mesaSesionId: Number(consulta.mesa_sesion_id),
    clienteSesionId: consulta.cliente_sesion_id,
    clienteNombre: consulta.cliente_nombre ?? null,
    estado: consulta.estado,
    creadaEn: consulta.creada_en,
    cerradaEn: consulta.cerrada_en,
    mensajes: mensajes.map((row) => ({
      id: Number(row.id),
      autorTipo: row.autor_tipo,
      autorReferencia: row.autor_referencia,
      autorNombre: row.autor_nombre ?? null,
      contenido: row.contenido,
      creadaEn: row.creada_en,
    })),
  };
}

async function getConsultaDetail(db, consultaId) {
  return db.withConnection(async ({ repository }) => {
    const consulta = await repository.getConsulta(consultaId);
    if (!consulta) {
      throw new DomainError(404, 'La consulta no existe');
    }

    const mensajes = await repository.listConsultaMessages(consultaId);
    return mapConsultaDetail(consulta, mensajes);
  });
}

async function sendConsultaMessageFromWaiter(
  db,
  recordAuditEvent,
  publishDomainEvent,
  consultaId,
  actorNombre,
  contenido,
) {
  if (!contenido?.trim()) {
    throw new DomainError(400, 'El mensaje es obligatorio');
  }

  await db.withTransaction(async ({ client, repository }) => {
    const consulta = await repository.getConsulta(consultaId, { forUpdate: true });
    if (!consulta) {
      throw new DomainError(404, 'La consulta no existe');
    }
    if (consulta.estado !== 'pendiente') {
      throw new DomainError(409, 'La consulta ya fue cerrada');
    }

    await repository.insertConsultaMessage(consultaId, 'mozo', actorNombre ?? 'mozo', contenido.trim());

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: consultaId,
      evento: 'consulta_mensaje_mozo',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        contenido: contenido.trim(),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'consulta_mensaje_mozo',
      [MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteConsultas],
    );

    await publishMesaPublicRefresh(
      client,
      publishDomainEvent,
      'consulta_mensaje_mozo',
      consulta.mesa_numero,
    );
  });

  return getConsultaDetail(db, consultaId);
}

async function closeConsultaFromWaiter(db, recordAuditEvent, publishDomainEvent, consultaId, actorNombre) {
  await db.withTransaction(async ({ client, repository }) => {
    const consulta = await repository.getConsulta(consultaId, { forUpdate: true });
    if (!consulta) {
      throw new DomainError(404, 'La consulta no existe');
    }
    if (consulta.estado !== 'pendiente') {
      throw new DomainError(409, 'La consulta ya fue cerrada');
    }

    await repository.closeConsulta(consultaId, `mozo:${actorNombre ?? 'mozo'}`);

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: consultaId,
      evento: 'consulta_cerrada_por_mozo',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {},
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'consulta_cerrada_por_mozo',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendienteConsultas,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoConsultas,
      ],
    );

    await publishMesaPublicRefresh(
      client,
      publishDomainEvent,
      'consulta_cerrada_por_mozo',
      consulta.mesa_numero,
    );
  });

  return getConsultaDetail(db, consultaId);
}

export function createWaiterConsultaService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createWaiterDbAdapter(pool);

  return {
    getConsultaDetail: (consultaId) => getConsultaDetail(db, consultaId),
    sendConsultaMessageFromWaiter: (consultaId, actorNombre, contenido) =>
      sendConsultaMessageFromWaiter(
        db,
        recordAuditEvent,
        publishDomainEvent,
        consultaId,
        actorNombre,
        contenido,
      ),
    closeConsultaFromWaiter: (consultaId, actorNombre) =>
      closeConsultaFromWaiter(db, recordAuditEvent, publishDomainEvent, consultaId, actorNombre),
  };
}
