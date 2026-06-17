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
  const { categorias, subcategorias, productos } = entityDaos;

  return {
    listCategories: () => categorias.listForAdmin(),
    listSubcategories: () => subcategorias.listForAdmin(),
    createCategory: (titulo, orden) => categorias.create(titulo, orden),
    getCategoryByIdForUpdate: (categoryId) => categorias.getByIdForUpdate(categoryId),
    getCategoryById: (categoryId) => categorias.getSummaryById(categoryId),
    updateCategory: (categoryId, titulo, orden, activa) =>
      categorias.update(categoryId, titulo, orden, activa),
    listActiveProductsByCategory: (categoryId) => productos.listActiveByCategory(categoryId),
    deleteCategory: (categoryId) => categorias.deleteById(categoryId),
    listProducts: () => productos.listForAdmin(),
    getSubcategoryById: (subcategoryId) => subcategorias.getSummaryById(subcategoryId),
    createProduct: (subcategoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo) =>
      productos.create(subcategoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo),
    getProductByIdForUpdate: (productId) => productos.getByIdForUpdate(productId),
    updateProduct: (
      productId,
      subcategoriaId,
      titulo,
      descripcion,
      precioArsCentavos,
      imagenNombreArchivo,
      activo,
    ) => productos.update(
      productId,
      subcategoriaId,
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

export function createPluginConfigRepository(entityDaos) {
  const { mesas, pluginsOperativos } = entityDaos;

  return {
    getPluginConfig: (pluginId) => pluginsOperativos.getById(pluginId),
    getPluginConfigForUpdate: (pluginId) => pluginsOperativos.getByIdForUpdate(pluginId),
    updatePluginEnabled: (pluginId, enabled) => pluginsOperativos.updateEnabled(pluginId, enabled),
    updatePluginConfig: (pluginId, config) => pluginsOperativos.updateConfig(pluginId, config),
    listMesaIds: () => mesas.listIds(),
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
    comandaSesiones,
    comandaItems,
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
    getOpenComanda: (mesaSesionId) => comandaSesiones.getOpenByMesaSesion(mesaSesionId),
    createOpenComanda: (mesaSesionId) => comandaSesiones.createOpen(mesaSesionId),
    syncComandaWithCatalog: async (mesaSesionId) => {
      const comanda = await comandaSesiones.getOpenByMesaSesion(mesaSesionId);
      if (!comanda) {
        return [];
      }

      return comandaItems.deleteInactiveCatalogItems(comanda.id);
    },
    getVisualUsdExchangeRate: async () => {
      const row = await configuracionVisual.getSingleton();
      return Number.parseFloat(row?.usd_exchange_rate ?? '0');
    },
    getMenuRows: (mesaSesionId) => productos.listMenuRows(mesaSesionId),
    getCatalogRevision: () => productos.getCatalogRevision(),
    getComandaRows: async (mesaSesionId) => {
      const comanda = await comandaSesiones.getOpenByMesaSesion(mesaSesionId);
      if (!comanda) {
        return [];
      }

      return comandaItems.listRows(comanda.id);
    },
    getMisComandaRows: async (mesaSesionId, clientSessionId) => {
      const comanda = await comandaSesiones.getOpenByMesaSesion(mesaSesionId);
      if (!comanda) {
        return [];
      }

      return comandaItems.listOwnedAggregatedRows(comanda.id, clientSessionId);
    },
    getComandaRowsByComandaId: (comandaSesionId) => comandaItems.listRows(comandaSesionId),
    getMisComandaRowsByComandaId: (comandaSesionId, clientSessionId) =>
      comandaItems.listOwnedAggregatedRows(comandaSesionId, clientSessionId),
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
    listConfirmedComandas: (mesaSesionId) => comandaSesiones.listConfirmedByMesaSesion(mesaSesionId),
    getConfirmedComandaItems: (comandaSesionId) => comandaItems.listAggregatedByComandaSesion(comandaSesionId),
    getProduct: (productoId) => productos.getBasicById(productoId),
    getOwnedComandaItem: (comandaSesionId, productoId, clientSessionId) =>
      comandaItems.getOwnedItem(comandaSesionId, productoId, clientSessionId),
    getComandaProductQuantity: (comandaSesionId, productoId) => comandaItems.getProductQuantity(comandaSesionId, productoId),
    insertComandaItem: (comandaSesionId, productoId, clientSessionId, titulo, descripcion, precioArsCentavos, cantidad = 1) =>
      comandaItems.insertItem(comandaSesionId, productoId, clientSessionId, titulo, descripcion, precioArsCentavos, cantidad),
    incrementComandaItem: (itemId, amount = 1) => comandaItems.incrementItem(itemId, amount),
    decrementComandaItem: (itemId, amount = 1) => comandaItems.decrementItem(itemId, amount),
    deleteComandaItem: (itemId) => comandaItems.deleteById(itemId),
    getNextComandaNumber: (mesaSesionId) => comandaSesiones.getNextComandaNumber(mesaSesionId),
    listComandaRowsForConfirmation: (comandaSesionId) => comandaItems.listRowsForConfirmation(comandaSesionId),
    confirmComanda: (comandaSesionId, numeroOrden, totalArsCentavos) =>
      comandaSesiones.confirmOpen(comandaSesionId, numeroOrden, totalArsCentavos),
    createKitchenOrder: (comandaSesionId) => pedidosCocina.createPending(comandaSesionId),
    clearOpenComanda: async (mesaSesionId) => {
      await comandaItems.deleteByOpenMesaSesion(mesaSesionId);
      await comandaSesiones.clearOpenByMesaSesion(mesaSesionId);
    },
    discardOpenAndPendingComandas: async (mesaSesionId) => {
      await pedidosCocina.deleteByDiscardableMesaSesion(mesaSesionId);
      await comandaItems.deleteByDiscardableMesaSesion(mesaSesionId);
      await comandaSesiones.clearDiscardableByMesaSesion(mesaSesionId);
    },
    createWaiterCall: (mesaSesionId, clientSessionId) => llamadosMozo.createPending(mesaSesionId, clientSessionId),
    createConsulta: (mesaSesionId, clientSessionId) => consultasMaster.createPending(mesaSesionId, clientSessionId),
    insertConsultaMessage: (consultaId, autorTipo, autorReferencia, contenido) =>
      consultasDetail.insertMessage(consultaId, autorTipo, autorReferencia, contenido),
    closeConsulta: (consultaId, cerradoPor) => consultasMaster.close(consultaId, cerradoPor),
    listPendingDisconnects: () => mesaClientes.listPendingDisconnects(),
    listOwnedComandaRows: async (mesaSesionId, clientSessionId) => {
      const comanda = await comandaSesiones.getOpenByMesaSesion(mesaSesionId);
      return comanda ? comandaItems.listOwnedRows(comanda.id, clientSessionId) : [];
    },
    listOrphanComandaRows: async (mesaSesionId) => {
      const comanda = await comandaSesiones.getOpenByMesaSesion(mesaSesionId);
      return comanda ? comandaItems.listOrphanRows(comanda.id) : [];
    },
    getComandaItemByOwner: async (mesaSesionId, productoId, clientSessionId) => {
      const comanda = await comandaSesiones.getOpenByMesaSesion(mesaSesionId);
      return comanda ? comandaItems.getOwnedItem(comanda.id, productoId, clientSessionId) : null;
    },
    reassignComandaItemOwner: (itemId, targetClientSessionId) =>
      comandaItems.reassignOwner(itemId, targetClientSessionId),
    orphanMesaComandaItems: async (mesaSesionId) => {
      const comanda = await comandaSesiones.getOpenByMesaSesion(mesaSesionId);
      return comanda ? comandaItems.orphanByComandaSesion(comanda.id) : [];
    },
  };
}

export function createMesaAdminRepository(entityDaos) {
  const {
    mesas,
    mesaSesiones,
    mesaClientes,
    comandaSesiones,
    comandaItems,
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
    discardOpenAndPendingComandas: async (mesaSesionId) => {
      await pedidosCocina.deleteByDiscardableMesaSesion(mesaSesionId);
      await comandaItems.deleteByDiscardableMesaSesion(mesaSesionId);
      await comandaSesiones.clearDiscardableByMesaSesion(mesaSesionId);
    },
  };
}

export function createWaiterRepository(entityDaos) {
  const {
    consultasMaster,
    consultasDetail,
    pedidosCocina,
    comandaItems,
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
    listKitchenOrderItems: (comandaSesionId) => comandaItems.listKitchenItems(comandaSesionId),
    receiveKitchenOrder: (kitchenOrderId, actorNombre) =>
      pedidosCocina.receiveById(kitchenOrderId, actorNombre),
    markKitchenOrderAsPaid: (kitchenOrderId, actorNombre) =>
      pedidosCocina.markPaidById(kitchenOrderId, actorNombre),
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
    pluginConfig: createPluginConfigRepository(entityDaos),
    mesaPublic: createMesaPublicRepository(entityDaos),
    mesaAdmin: createMesaAdminRepository(entityDaos),
    waiter: createWaiterRepository(entityDaos),
    dashboard: createDashboardRepository(client),
  };
}
