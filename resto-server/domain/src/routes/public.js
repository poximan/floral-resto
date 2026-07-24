function parseMesaNumero(params) {
  const mesaNumero = String(params.mesaNumero ?? '').trim();

  if (!mesaNumero) {
    throw new Error('La mesa es invalida');
  }

  return mesaNumero;
}

export async function publicRoutes(app, mesaService) {
  app.get('/internal/public/bootstrap', async () => ({
    service: 'domain',
    capabilities: {
      sharedComanda: true,
      multipleComandasPerMesaSession: true,
      visualUsdConversion: true,
      realtimeViaWebSocket: true,
    },
  }));

  app.post('/internal/public/mesas/:mesaNumero/session', async (request, reply) => {
    const mesaNumero = parseMesaNumero(request.params);
    const requestedClientSessionId = request.body?.clientSessionId ?? null;
    const requestedClientName = request.body?.clientName ?? null;
    const context = await mesaService.getMesaContext(mesaNumero, requestedClientSessionId, requestedClientName);

    reply.code(201);
    return context;
  });

  app.post('/internal/public/mesas/:mesaNumero/connect', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;

    return mesaService.connectClient(mesaNumero, clientSessionId);
  });

  app.get('/internal/public/mesas/:mesaNumero/menu', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.query?.clientSessionId ?? null;

    return mesaService.getMenu(mesaNumero, clientSessionId);
  });

  app.post('/internal/public/mesas/:mesaNumero/disconnect', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;
    const immediate = request.body?.immediate === true;

    return mesaService.disconnectClient(mesaNumero, clientSessionId, { immediate });
  });

  app.get('/internal/public/mesas/:mesaNumero/state', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.query?.clientSessionId ?? null;

    return mesaService.getState(mesaNumero, clientSessionId);
  });

  app.post('/internal/public/mesas/:mesaNumero/comandas/items', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;
    const productoId = Number.parseInt(request.body?.productoId, 10);
    const action = request.body?.action ?? null;

    return mesaService.updateComandaItem(mesaNumero, clientSessionId, productoId, action);
  });

  app.post('/internal/public/mesas/:mesaNumero/comandas/confirm', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;

    return mesaService.confirmComanda(mesaNumero, clientSessionId);
  });

  app.post('/internal/public/mesas/:mesaNumero/waiter-call', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;

    return mesaService.callWaiter(mesaNumero, clientSessionId);
  });

  app.post('/internal/public/mesas/:mesaNumero/consulta/open', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;
    const contenido = request.body?.contenido ?? null;

    return mesaService.openConsulta(mesaNumero, clientSessionId, contenido);
  });

  app.post('/internal/public/mesas/:mesaNumero/consulta/message', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;
    const contenido = request.body?.contenido ?? null;

    return mesaService.sendConsultaMessageFromClient(mesaNumero, clientSessionId, contenido);
  });

  app.post('/internal/public/mesas/:mesaNumero/consulta/close', async (request) => {
    const mesaNumero = parseMesaNumero(request.params);
    const clientSessionId = request.body?.clientSessionId ?? null;

    return mesaService.closeConsultaFromClient(mesaNumero, clientSessionId);
  });
}
