import { createRoleGuard } from './auth.js';

function parseStatus(query) {
  const status = query?.status ?? 'pendiente';

  if (!['pendiente', 'atendido'].includes(status)) {
    throw new Error('El estado solicitado es invalido');
  }

  return status;
}

function parsePositiveId(value, errorMessage) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(errorMessage);
  }

  return parsed;
}

export async function waiterRoutes(app, waiterService, authService) {
  const mozoGuard = createRoleGuard(authService, ['mozo']);

  app.get('/internal/waiter/queues', { preHandler: mozoGuard }, async (request) => {
    const status = parseStatus(request.query);
    return waiterService.getWaiterQueues(status);
  });

  app.get('/internal/waiter/consultas/:consultaId', { preHandler: mozoGuard }, async (request) => {
    const consultaId = parsePositiveId(
      request.params.consultaId,
      'El identificador de consulta es invalido',
    );

    return waiterService.getConsultaDetail(consultaId);
  });

  app.post('/internal/waiter/consultas/:consultaId/message', { preHandler: mozoGuard }, async (request) => {
    const consultaId = parsePositiveId(
      request.params.consultaId,
      'El identificador de consulta es invalido',
    );

    const payload = await waiterService.sendConsultaMessageFromWaiter(
      consultaId,
      request.authSession.actorNombre,
      request.body?.contenido ?? null,
    );

    await authService.touchRelevantEvent(request.authSession.sessionToken);
    return payload;
  });

  app.post('/internal/waiter/consultas/:consultaId/close', { preHandler: mozoGuard }, async (request) => {
    const consultaId = parsePositiveId(
      request.params.consultaId,
      'El identificador de consulta es invalido',
    );

    const payload = await waiterService.closeConsultaFromWaiter(
      consultaId,
      request.authSession.actorNombre,
    );

    await authService.touchRelevantEvent(request.authSession.sessionToken);
    return payload;
  });

  app.get('/internal/waiter/pedidos-cocina/:pedidoCocinaId', { preHandler: mozoGuard }, async (request) => {
    const pedidoCocinaId = parsePositiveId(
      request.params.pedidoCocinaId,
      'El identificador del pedido de cocina es invalido',
    );

    return waiterService.getKitchenOrderDetail(pedidoCocinaId);
  });

  app.post('/internal/waiter/pedidos-cocina/:pedidoCocinaId/receive', { preHandler: mozoGuard }, async (request) => {
    const pedidoCocinaId = parsePositiveId(
      request.params.pedidoCocinaId,
      'El identificador del pedido de cocina es invalido',
    );

    const payload = await waiterService.receiveKitchenOrder(
      pedidoCocinaId,
      request.authSession.actorNombre,
    );

    await authService.touchRelevantEvent(request.authSession.sessionToken);
    return payload;
  });

  app.get('/internal/waiter/llamados-mozo/:llamadoMozoId', { preHandler: mozoGuard }, async (request) => {
    const llamadoMozoId = parsePositiveId(
      request.params.llamadoMozoId,
      'El identificador del llamado a mozo es invalido',
    );

    return waiterService.getWaiterCallDetail(llamadoMozoId);
  });

  app.post('/internal/waiter/llamados-mozo/:llamadoMozoId/receive', { preHandler: mozoGuard }, async (request) => {
    const llamadoMozoId = parsePositiveId(
      request.params.llamadoMozoId,
      'El identificador del llamado a mozo es invalido',
    );

    const payload = await waiterService.receiveWaiterCall(
      llamadoMozoId,
      request.authSession.actorNombre,
    );

    await authService.touchRelevantEvent(request.authSession.sessionToken);
    return payload;
  });
}
