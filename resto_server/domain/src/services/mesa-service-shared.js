import { DomainError } from './domain-error.js';
import { generateClientSessionId } from './client-session-id.js';
import { uniqueFragmentKeys } from './domain-event-service.js';

export const pendingDisconnectTimers = new Map();

export function mapMenuRowsToCategories(rows) {
  const categories = [];
  const byCategoryId = new Map();
  const bySubcategoryId = new Map();

  for (const row of rows) {
    const categoryId = Number(row.categoria_id);
    const subcategoryId = Number(row.subcategoria_id);
    const productId = Number(row.producto_id);

    if (!byCategoryId.has(categoryId)) {
      const category = {
        id: categoryId,
        titulo: row.categoria_titulo,
        orden: Number(row.categoria_orden),
        subcategorias: [],
      };
      byCategoryId.set(categoryId, category);
      categories.push(category);
    }

    if (!bySubcategoryId.has(subcategoryId)) {
      const subcategory = {
        id: subcategoryId,
        titulo: row.subcategoria_titulo,
        orden: Number(row.subcategoria_orden),
        productos: [],
      };
      bySubcategoryId.set(subcategoryId, subcategory);
      byCategoryId.get(categoryId).subcategorias.push(subcategory);
    }

    bySubcategoryId.get(subcategoryId).productos.push({
      id: productId,
      titulo: row.producto_titulo,
      descripcion: row.producto_descripcion,
      precioArsCentavos: Number(row.precio_ars_centavos),
      imagenNombreArchivo: row.imagen_nombre_archivo,
      cantidadTotalMesa: Number(row.cantidad_total_mesa ?? 0),
    });
  }

  return categories;
}

export async function publishMobileCurrentRefresh(client, publishDomainEvent, reason, fragments) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'mobile_current_refresh',
    reason,
    fragments: uniqueFragmentKeys(fragments),
  });
}

export async function publishMesaPublicRefresh(client, publishDomainEvent, reason, mesaNumero) {
  if (!publishDomainEvent || !mesaNumero) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'mesa_public_refresh',
    reason,
    mesaNumero: String(mesaNumero),
  });
}

export function getDisconnectTimerKey(mesaSesionId, clientSessionId) {
  return `${mesaSesionId}:${clientSessionId}`;
}

export function clearPendingDisconnectTimer(mesaSesionId, clientSessionId) {
  const timerKey = getDisconnectTimerKey(mesaSesionId, clientSessionId);
  const timerId = pendingDisconnectTimers.get(timerKey);

  if (!timerId) {
    return;
  }

  clearTimeout(timerId);
  pendingDisconnectTimers.delete(timerKey);
}

export function hasPendingDisconnect(mesaCliente) {
  return Boolean(mesaCliente?.desconexion_programada_en);
}

export function normalizeOptionalClientName(value) {
  const normalized = String(value ?? '').trim();

  return normalized || null;
}

export async function touchMesaClient(repository, mesaSesionId, clientSessionId, clientName = null) {
  await repository.touchMesaClient(mesaSesionId, clientSessionId, normalizeOptionalClientName(clientName));
  clearPendingDisconnectTimer(mesaSesionId, clientSessionId);
}

export async function scheduleMesaClientDisconnect(repository, mesaSesionId, clientSessionId, graceSeconds) {
  await repository.scheduleMesaClientDisconnect(mesaSesionId, clientSessionId, graceSeconds);
}

export async function assignLeaderIfMissing(repository, mesaSesionId) {
  const nextLeader = await repository.getOldestConnectedClientSessionId(mesaSesionId);
  await repository.syncMesaLeader(mesaSesionId, nextLeader);
  return nextLeader;
}

async function generateUniqueClientSessionId(repository, mesaSesionId) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = generateClientSessionId();
    const exists = await repository.getMesaClient(mesaSesionId, candidate);

    if (!exists) {
      return candidate;
    }
  }

  throw new DomainError(500, 'No se pudo generar un identificador corto para el cliente');
}

export async function ensureMesaAndSession(repository, mesaNumero) {
  const mesa = await repository.getMesaByNumeroForUpdate(mesaNumero);
  if (!mesa) {
    throw new DomainError(404, `La mesa ${mesaNumero} no existe`);
  }

  let mesaSesion = await repository.getActiveMesaSession(mesa.id);
  let mesaSesionCreada = false;
  if (!mesaSesion) {
    mesaSesion = await repository.createMesaSession(mesa.id);
    mesaSesionCreada = true;
  }

  return { mesa, mesaSesion, mesaSesionCreada };
}

export async function countConnectedMesaClients(repository, mesaSesionId) {
  return repository.countConnectedMesaClients(mesaSesionId);
}

export async function ensureMesaAndExistingSession(repository, mesaNumero) {
  const mesa = await repository.getMesaByNumero(mesaNumero);
  if (!mesa) {
    throw new DomainError(404, `La mesa ${mesaNumero} no existe`);
  }

  const mesaSesion = await repository.getActiveMesaSession(mesa.id);
  if (!mesaSesion) {
    throw new DomainError(409, `La mesa ${mesaNumero} no tiene una sesion activa`);
  }

  return { mesa, mesaSesion };
}

export async function lockMesaSession(repository, mesaSesionId) {
  return repository.lockMesaSession(mesaSesionId);
}

export async function ensureMesaClient(repository, mesaSesionId, requestedClientSessionId, requestedClientName = null) {
  let clientSessionId = requestedClientSessionId?.trim().toUpperCase() ?? null;
  const clientName = normalizeOptionalClientName(requestedClientName);
  let mesaCliente = null;
  let clientCreated = false;
  let clientReconnected = false;

  if (clientSessionId) {
    mesaCliente = await repository.getMesaClient(mesaSesionId, clientSessionId);
  }

  if (mesaCliente && mesaCliente.conectada === false) {
    mesaCliente = null;
  }

  if (!mesaCliente) {
    clientSessionId = await generateUniqueClientSessionId(repository, mesaSesionId);
    mesaCliente = await repository.createMesaClient(mesaSesionId, clientSessionId, clientName);
    clientCreated = true;
  } else {
    clientReconnected = hasPendingDisconnect(mesaCliente);
    await touchMesaClient(repository, mesaSesionId, clientSessionId, clientName);
    mesaCliente = await repository.getMesaClient(mesaSesionId, clientSessionId);
  }

  await assignLeaderIfMissing(repository, mesaSesionId);

  return {
    clientSessionId,
    clientName: mesaCliente?.cliente_nombre ?? null,
    clientCreated,
    clientReconnected,
  };
}

export async function requireActiveMesaClientSession(repository, mesaNumero, clientSessionId) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }

  const { mesa, mesaSesion } = await ensureMesaAndExistingSession(repository, mesaNumero);
  const mesaCliente = await repository.getMesaClient(mesaSesion.id, clientSessionId);

  if (!mesaCliente || mesaCliente.conectada === false) {
    throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
  }

  return { mesa, mesaSesion, mesaCliente };
}

export async function syncComandaWithCatalog(repository, mesaSesionId) {
  const deletedRows = await repository.syncComandaWithCatalog(mesaSesionId);
  const deletedProducts = new Map();

  for (const row of deletedRows) {
    deletedProducts.set(Number(row.producto_id), {
      productoId: Number(row.producto_id),
      titulo: row.titulo,
    });
  }

  return Array.from(deletedProducts.values());
}

export async function getMenuRows(repository, mesaSesionId) {
  return repository.getMenuRows(mesaSesionId);
}

export async function getPendingCall(repository, mesaSesionId) {
  return repository.getPendingCall(mesaSesionId);
}

export async function getPendingConsulta(repository, mesaSesionId) {
  return repository.getPendingConsulta(mesaSesionId);
}

function mapComandaItems(rows) {
  return rows.map((row) => ({
    productoId: Number(row.producto_id),
    titulo: row.titulo ?? row.titulo_snapshot,
    descripcion: row.descripcion ?? row.descripcion_snapshot,
    precioArsCentavos: Number(row.precio_ars_centavos ?? row.precio_ars_centavos_snapshot),
    cantidadTotal: Number(row.cantidad_total),
    cantidadesPorCliente: row.cantidades_por_cliente ?? [],
  }));
}

async function getConfirmedComandasWithItems(repository, mesaSesionId, clientSessionId) {
  const comandas = await repository.listConfirmedComandas(mesaSesionId);

  return Promise.all(comandas.map(async (comanda) => {
    const items = mapComandaItems(await repository.getConfirmedComandaItems(comanda.id));
    const misItems = clientSessionId
      ? mapComandaItems(await repository.getMisComandaRowsByComandaId(comanda.id, clientSessionId))
      : [];

    return {
      id: Number(comanda.id),
      numeroOrden: Number(comanda.numero_orden),
      totalArsCentavos: Number(comanda.total_ars_centavos),
      confirmadaEn: comanda.confirmada_en,
      cobradaEn: comanda.cobrado_en,
      items,
      misItems,
      miTotalArsCentavos: misItems.reduce(
        (accumulator, item) => accumulator + (item.precioArsCentavos * item.cantidadTotal),
        0,
      ),
    };
  }));
}

export async function buildMesaState(repository, mesa, mesaSesion, clientSessionId) {
  const productosRemovidosDeComanda = await syncComandaWithCatalog(repository, mesaSesion.id);
  let leaderClientSessionId = await assignLeaderIfMissing(repository, mesaSesion.id);

  if (!leaderClientSessionId && clientSessionId) {
    await touchMesaClient(repository, mesaSesion.id, clientSessionId);
    leaderClientSessionId = await assignLeaderIfMissing(repository, mesaSesion.id);
  }

  const comandaRows = await repository.getComandaRows(mesaSesion.id);
  const misComandaRows = clientSessionId
    ? await repository.getMisComandaRows(mesaSesion.id, clientSessionId)
    : [];
  const currentMesaClient = clientSessionId
    ? await repository.getMesaClient(mesaSesion.id, clientSessionId)
    : null;
  const pendingCall = await repository.getPendingCall(mesaSesion.id);
  const pendingConsulta = await repository.getPendingConsulta(mesaSesion.id);
  const activeConsulta = await repository.getActiveConsultaWithMessages(mesaSesion.id);
  const confirmedComandas = await getConfirmedComandasWithItems(repository, mesaSesion.id, clientSessionId);
  const visualUsdExchangeRate = await repository.getVisualUsdExchangeRate();
  const catalogoRevisionValue = await repository.getCatalogRevision();

  const catalogoRevision = catalogoRevisionValue instanceof Date
    ? catalogoRevisionValue.toISOString()
    : catalogoRevisionValue
      ? String(catalogoRevisionValue)
      : null;

  const items = mapComandaItems(comandaRows);
  const misItems = mapComandaItems(misComandaRows);

  const totalArsCentavos = items.reduce(
    (accumulator, item) => accumulator + (item.precioArsCentavos * item.cantidadTotal),
    0,
  );
  const miTotalArsCentavos = misItems.reduce(
    (accumulator, item) => accumulator + (item.precioArsCentavos * item.cantidadTotal),
    0,
  );

  return {
    mesaNumero: mesa.nombre,
    mesaNombre: mesa.nombre,
    mesaSesionId: Number(mesaSesion.id),
    clientSessionId,
    clientName: currentMesaClient?.cliente_nombre ?? null,
    catalogoRevision,
    isLeader: leaderClientSessionId === clientSessionId,
    canConfirmComanda: leaderClientSessionId === clientSessionId && items.length > 0,
    comandaConfirmada: confirmedComandas.length > 0,
    totalComandasConfirmadas: confirmedComandas.length,
    visualUsdExchangeRate,
    productosRemovidosDeComanda,
    comandaActiva: {
      items,
      totalArsCentavos,
      misItems,
      miTotalArsCentavos,
    },
    comandasMesa: confirmedComandas,
    misComandas: confirmedComandas
      .map((comanda) => ({
        id: comanda.id,
        numeroOrden: comanda.numeroOrden,
        totalArsCentavos: comanda.miTotalArsCentavos,
        confirmadaEn: comanda.confirmadaEn,
        cobradaEn: comanda.cobradaEn,
        items: comanda.misItems,
      }))
      .filter((comanda) => comanda.items.length > 0),
    comandaConfirmadaDetalle: confirmedComandas[0] ?? null,
    llamadoMozoPendiente: pendingCall
      ? {
          id: Number(pendingCall.id),
          clienteSesionId: pendingCall.cliente_sesion_id,
          clienteNombre: pendingCall.cliente_nombre ?? null,
          creadaEn: pendingCall.creada_en,
        }
      : null,
    consultaPendiente: pendingConsulta
      ? {
          id: Number(pendingConsulta.id),
          clienteSesionId: pendingConsulta.cliente_sesion_id,
          clienteNombre: pendingConsulta.cliente_nombre ?? null,
          creadaEn: pendingConsulta.creada_en,
        }
      : null,
    consultaActiva: activeConsulta,
  };
}
