import { bindDashboardReadModelDao } from '../dao/dashboard-read-model-dao.js';
import { bindEntityDaos } from '../dao/entity-daos.js';

export function createAuthSessionRepository(entityDaos) {
  const { rolesWebSessions } = entityDaos;

  return {
    getSessionByRole: (role) => rolesWebSessions.getByRole(role),
    getSessionByTokenHash: (sessionTokenHash) => rolesWebSessions.getByTokenHash(sessionTokenHash),
    deleteSessionByRole: (role) => rolesWebSessions.deleteByRole(role),
    deleteSessionByTokenHash: (sessionTokenHash) => rolesWebSessions.deleteByTokenHash(sessionTokenHash),
    createSession: (role, actorNombre, sessionTokenHash) =>
      rolesWebSessions.create(role, actorNombre, sessionTokenHash),
    touchSessionByTokenHash: (sessionTokenHash) => rolesWebSessions.touchByTokenHash(sessionTokenHash),
  };
}

export function createCatalogRepository(entityDaos) {
  const { categorias, productos } = entityDaos;

  return {
    listCategories: () => categorias.listForAdmin(),
    createCategory: (titulo, orden) => categorias.create(titulo, orden),
    getCategoryByIdForUpdate: (categoryId) => categorias.getByIdForUpdate(categoryId),
    getCategoryById: (categoryId) => categorias.getSummaryById(categoryId),
    updateCategory: (categoryId, titulo, orden, activa) =>
      categorias.update(categoryId, titulo, orden, activa),
    listActiveProductsByCategory: (categoryId) => productos.listActiveByCategory(categoryId),
    deleteCategory: (categoryId) => categorias.deleteById(categoryId),
    listProducts: () => productos.listForAdmin(),
    createProduct: (categoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo) =>
      productos.create(categoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo),
    getProductByIdForUpdate: (productId) => productos.getByIdForUpdate(productId),
    updateProduct: (
      productId,
      categoriaId,
      titulo,
      descripcion,
      precioArsCentavos,
      imagenNombreArchivo,
      activo,
    ) => productos.update(
      productId,
      categoriaId,
      titulo,
      descripcion,
      precioArsCentavos,
      imagenNombreArchivo,
      activo,
    ),
  };
}

export function createVisualConfigRepository(entityDaos) {
  const { configuracionVisual } = entityDaos;

  return {
    getVisualConfig: () => configuracionVisual.getSingleton(),
    updateVisualUsdExchangeRate: (visualUsdExchangeRate) =>
      configuracionVisual.updateUsdExchangeRate(visualUsdExchangeRate),
  };
}

export function createMesaPublicRepository(entityDaos) {
  const {
    mesas,
    productos,
    configuracionVisual,
    mesaSesiones,
    mesaClientes,
    mesaSesionLideres,
    mesaCarritoItems,
    pedidoSesiones,
    pedidoItems,
    consultasMaster,
    consultasDetail,
    llamadosMozo,
    pedidosCocina,
  } = entityDaos;

  return {
    getMesaByNumero: (mesaNumero) => mesas.getByNombre(mesaNumero),
    getMesaByNumeroForUpdate: (mesaNumero) => mesas.getByNombre(mesaNumero, { forUpdate: true }),
    getActiveMesaSession: (mesaId) => mesaSesiones.getActiveByMesaId(mesaId),
    lockMesaSession: (mesaSesionId) => mesaSesiones.lockById(mesaSesionId),
    createMesaSession: (mesaId) => mesaSesiones.createOpen(mesaId),
    getMesaClient: (mesaSesionId, clientSessionId) =>
      mesaClientes.getBySessionAndClient(mesaSesionId, clientSessionId),
    createMesaClient: (mesaSesionId, clientSessionId, clientName) =>
      mesaClientes.create(mesaSesionId, clientSessionId, clientName),
    touchMesaClient: (mesaSesionId, clientSessionId, clientName) =>
      mesaClientes.touch(mesaSesionId, clientSessionId, clientName),
    scheduleMesaClientDisconnect: (mesaSesionId, clientSessionId, graceSeconds) =>
      mesaClientes.scheduleDisconnect(mesaSesionId, clientSessionId, graceSeconds),
    markMesaClientDisconnected: (mesaSesionId, clientSessionId) =>
      mesaClientes.markDisconnected(mesaSesionId, clientSessionId),
    countConnectedMesaClients: (mesaSesionId) => mesaClientes.countConnected(mesaSesionId),
    getOldestConnectedClientSessionId: (mesaSesionId) =>
      mesaClientes.getOldestConnectedClientSessionId(mesaSesionId),
    syncMesaLeader: async (mesaSesionId, nextLeaderClientSessionId) => {
      if (!nextLeaderClientSessionId) {
        await mesaSesionLideres.deleteByMesaSesionId(mesaSesionId);
        return;
      }

      await mesaSesionLideres.upsert(mesaSesionId, nextLeaderClientSessionId);
    },
    syncCartWithCatalog: (mesaSesionId) => mesaCarritoItems.deleteInactiveCatalogItems(mesaSesionId),
    getVisualUsdExchangeRate: async () => {
      const row = await configuracionVisual.getSingleton();
      return Number.parseFloat(row?.usd_exchange_rate ?? '0');
    },
    getMenuRows: (mesaSesionId) => productos.listMenuRows(mesaSesionId),
    getCatalogRevision: () => productos.getCatalogRevision(),
    getCartRows: (mesaSesionId) => mesaCarritoItems.listCartRows(mesaSesionId),
    getPendingCall: (mesaSesionId) => llamadosMozo.getPendingByMesaSesion(mesaSesionId),
    getPendingConsulta: (mesaSesionId) => consultasMaster.getPendingByMesaSesion(mesaSesionId),
    getActiveConsultaWithMessages: async (mesaSesionId) => {
      const consulta = await consultasMaster.getPendingByMesaSesion(mesaSesionId);
      if (!consulta) {
        return null;
      }

      const mensajes = await consultasDetail.listByConsultaId(consulta.id);

      return {
        id: Number(consulta.id),
        creadaEn: consulta.creada_en,
        mensajes: mensajes.map((row) => ({
          id: Number(row.id),
          autorTipo: row.autor_tipo,
          autorReferencia: row.autor_referencia,
          autorNombre: row.autor_nombre ?? null,
          contenido: row.contenido,
          creadaEn: row.creada_en,
        })),
      };
    },
    listConfirmedOrders: (mesaSesionId) => pedidoSesiones.listConfirmedByMesaSesion(mesaSesionId),
    getConfirmedOrderItems: (pedidoSesionId) => pedidoItems.listAggregatedByPedidoSesion(pedidoSesionId),
    getProduct: (productoId) => productos.getBasicById(productoId),
    getOwnedCartItem: (mesaSesionId, productoId, clientSessionId) =>
      mesaCarritoItems.getOwnedItem(mesaSesionId, productoId, clientSessionId),
    insertCartItem: (mesaSesionId, productoId, clientSessionId, cantidad = 1) =>
      mesaCarritoItems.insertItem(mesaSesionId, productoId, clientSessionId, cantidad),
    incrementCartItem: (itemId, amount = 1) => mesaCarritoItems.incrementItem(itemId, amount),
    decrementCartItem: (itemId, amount = 1) => mesaCarritoItems.decrementItem(itemId, amount),
    deleteCartItem: (itemId) => mesaCarritoItems.deleteById(itemId),
    getNextOrderNumber: (mesaSesionId) => pedidoSesiones.getNextOrderNumber(mesaSesionId),
    listCartRowsForConfirmation: (mesaSesionId) => mesaCarritoItems.listRowsForConfirmation(mesaSesionId),
    createPedidoSesion: (mesaSesionId, numeroOrden, totalArsCentavos) =>
      pedidoSesiones.create(mesaSesionId, numeroOrden, totalArsCentavos),
    insertPedidoItemSnapshot: (
      pedidoSesionId,
      productoId,
      clienteSesionId,
      titulo,
      descripcion,
      precioArsCentavos,
      cantidad,
    ) => pedidoItems.createSnapshot(
      pedidoSesionId,
      productoId,
      clienteSesionId,
      titulo,
      descripcion,
      precioArsCentavos,
      cantidad,
    ),
    createKitchenOrder: (pedidoSesionId) => pedidosCocina.createPending(pedidoSesionId),
    clearCart: (mesaSesionId) => mesaCarritoItems.clearByMesaSesion(mesaSesionId),
    createWaiterCall: (mesaSesionId, clientSessionId) => llamadosMozo.createPending(mesaSesionId, clientSessionId),
    createConsulta: (mesaSesionId, clientSessionId) => consultasMaster.createPending(mesaSesionId, clientSessionId),
    insertConsultaMessage: (consultaId, autorTipo, autorReferencia, contenido) =>
      consultasDetail.insertMessage(consultaId, autorTipo, autorReferencia, contenido),
    closeConsulta: (consultaId, cerradoPor) => consultasMaster.close(consultaId, cerradoPor),
    listPendingDisconnects: () => mesaClientes.listPendingDisconnects(),
    listOwnedCartRows: (mesaSesionId, clientSessionId) =>
      mesaCarritoItems.listOwnedRows(mesaSesionId, clientSessionId),
    listOrphanCartRows: (mesaSesionId) => mesaCarritoItems.listOrphanRows(mesaSesionId),
    getCartItemByOwner: (mesaSesionId, productoId, clientSessionId) =>
      mesaCarritoItems.getOwnedItem(mesaSesionId, productoId, clientSessionId),
    reassignCartItemOwner: (itemId, targetClientSessionId) =>
      mesaCarritoItems.reassignOwner(itemId, targetClientSessionId),
    orphanMesaCartItems: (mesaSesionId) => mesaCarritoItems.orphanByMesaSesion(mesaSesionId),
  };
}

export function createMesaAdminRepository(entityDaos) {
  const {
    mesas,
    mesaSesiones,
    mesaClientes,
    mesaCarritoItems,
    pedidoSesiones,
    consultasMaster,
    llamadosMozo,
    pedidosCocina,
  } = entityDaos;

  return {
    listMesas: () => mesas.listWithActiveSessionSummary(),
    createMesa: (nombre) => mesas.create(nombre),
    getMesaByNumeroForUpdate: (mesaNumero) => mesas.getByNombre(mesaNumero, { forUpdate: true }),
    getActiveSessionId: (mesaId) => mesaSesiones.getActiveSessionId(mesaId),
    createMesaSession: (mesaId) => mesaSesiones.createOpen(mesaId),
    getOpenSessionForClose: (mesaId) => mesaSesiones.getOpenForClose(mesaId),
    closeMesaSession: (mesaSesionId) => mesaSesiones.close(mesaSesionId),
    disconnectMesaClients: (mesaSesionId) => mesaClientes.disconnectAll(mesaSesionId),
    closePendingConsultas: (mesaSesionId, cerradoPor) =>
      consultasMaster.closePendingByMesaSesion(mesaSesionId, cerradoPor),
    receivePendingWaiterCalls: (mesaSesionId, actorNombre) =>
      llamadosMozo.receivePendingByMesaSesion(mesaSesionId, actorNombre),
    receivePendingKitchenOrders: (mesaSesionId, actorNombre) =>
      pedidosCocina.receivePendingByMesaSesion(mesaSesionId, actorNombre),
    markConfirmedOrdersAsPaid: (mesaSesionId) => pedidoSesiones.markConfirmedOrdersAsPaid(mesaSesionId),
    clearMesaCart: (mesaSesionId) => mesaCarritoItems.clearByMesaSesion(mesaSesionId),
  };
}

export function createWaiterRepository(entityDaos) {
  const {
    consultasMaster,
    consultasDetail,
    pedidosCocina,
    pedidoItems,
    llamadosMozo,
  } = entityDaos;

  return {
    listConsultaQueue: (status) => consultasMaster.listQueue(status),
    listKitchenQueue: (status) => pedidosCocina.listQueue(status),
    listWaiterCallQueue: (status) => llamadosMozo.listQueue(status),
    getConsulta: (consultaId, options) => consultasMaster.getWithContext(consultaId, options),
    listConsultaMessages: (consultaId) => consultasDetail.listByConsultaId(consultaId),
    insertConsultaMessage: (consultaId, autorTipo, autorReferencia, contenido) =>
      consultasDetail.insertMessage(consultaId, autorTipo, autorReferencia, contenido),
    closeConsulta: (consultaId, cerradoPor) => consultasMaster.close(consultaId, cerradoPor),
    getKitchenOrder: (kitchenOrderId) => pedidosCocina.getWithContext(kitchenOrderId),
    listKitchenOrderItems: (pedidoSesionId) => pedidoItems.listKitchenItems(pedidoSesionId),
    receiveKitchenOrder: (kitchenOrderId, actorNombre) =>
      pedidosCocina.receiveById(kitchenOrderId, actorNombre),
    getWaiterCall: (waiterCallId) => llamadosMozo.getWithContext(waiterCallId),
    receiveWaiterCall: (waiterCallId, actorNombre) => llamadosMozo.receiveById(waiterCallId, actorNombre),
  };
}

export function createDashboardRepository(client) {
  const dashboardReadModel = bindDashboardReadModelDao(client);

  return {
    getCurrentJornadaRange: (businessTimezone, jornadaStartTime) =>
      dashboardReadModel.getCurrentJornadaRange(businessTimezone, jornadaStartTime),
    getDashboardRow: (range) => dashboardReadModel.getDashboardRow(range),
    listRealtimeConsultas: (range) => dashboardReadModel.listRealtimeConsultas(range),
    listRealtimePedidosCocina: (range) => dashboardReadModel.listRealtimePedidosCocina(range),
    listRealtimeLlamadosMozo: (range) => dashboardReadModel.listRealtimeLlamadosMozo(range),
    listHistoryConsultas: (range) => dashboardReadModel.listHistoryConsultas(range),
    listHistoryPedidosCocina: (range) => dashboardReadModel.listHistoryPedidosCocina(range),
    listHistoryLlamadosMozo: (range) => dashboardReadModel.listHistoryLlamadosMozo(range),
  };
}

export function bindDomainRepositories(client) {
  const entityDaos = bindEntityDaos(client);

  return {
    authSession: createAuthSessionRepository(entityDaos),
    catalog: createCatalogRepository(entityDaos),
    visualConfig: createVisualConfigRepository(entityDaos),
    mesaPublic: createMesaPublicRepository(entityDaos),
    mesaAdmin: createMesaAdminRepository(entityDaos),
    waiter: createWaiterRepository(entityDaos),
    dashboard: createDashboardRepository(client),
  };
}
