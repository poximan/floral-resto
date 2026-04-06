import { DomainError } from './domain-error.js';
import { generateClientSessionId } from './client-session-id.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS, uniqueFragmentKeys } from './domain-event-service.js';
import {
  adoptOrphanCartItems,
  applyCartOwnershipOnConfirmedDeparture,
} from './mesa-cart-ownership-service.js';

const pendingDisconnectTimers = new Map();

function mapMenuRowsToCategories(rows) {
  const categories = [];
  const byCategoryId = new Map();

  for (const row of rows) {
    const categoryId = Number(row.categoria_id);
    const productId = Number(row.producto_id);

    if (!byCategoryId.has(categoryId)) {
      const category = {
        id: categoryId,
        titulo: row.categoria_titulo,
        orden: Number(row.categoria_orden),
        productos: [],
      };
      byCategoryId.set(categoryId, category);
      categories.push(category);
    }

    byCategoryId.get(categoryId).productos.push({
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

async function publishMobileCurrentRefresh(client, publishDomainEvent, reason, fragments) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'mobile_current_refresh',
    reason,
    fragments: uniqueFragmentKeys(fragments),
  });
}

async function publishMesaPublicRefresh(client, publishDomainEvent, reason, mesaNumero) {
  if (!publishDomainEvent || !mesaNumero) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'mesa_public_refresh',
    reason,
    mesaNumero: Number(mesaNumero),
  });
}

function getDisconnectTimerKey(mesaSesionId, clientSessionId) {
  return `${mesaSesionId}:${clientSessionId}`;
}

function clearPendingDisconnectTimer(mesaSesionId, clientSessionId) {
  const timerKey = getDisconnectTimerKey(mesaSesionId, clientSessionId);
  const timerId = pendingDisconnectTimers.get(timerKey);

  if (!timerId) {
    return;
  }

  clearTimeout(timerId);
  pendingDisconnectTimers.delete(timerKey);
}

async function getMesaByNumero(client, mesaNumero) {
  const result = await client.query(
    `
      SELECT id, numero, habilitada
      FROM mesas
      WHERE numero = $1
    `,
    [mesaNumero],
  );

  return result.rows[0] ?? null;
}

async function getActiveMesaSession(client, mesaId) {
  const result = await client.query(
    `
      SELECT id, mesa_id, estado, lider_cliente_sesion_id, creada_en, cerrada_en
      FROM mesa_sesiones
      WHERE mesa_id = $1
        AND estado = 'abierta'
      ORDER BY creada_en DESC
      LIMIT 1
    `,
    [mesaId],
  );

  return result.rows[0] ?? null;
}

async function getMesaClient(client, mesaSesionId, clientSessionId) {
  const result = await client.query(
    `
      SELECT
        id,
        mesa_sesion_id,
        cliente_sesion_id,
        conectada,
        creada_en,
        ultimo_seen_en,
        desconectada_en,
        desconexion_programada_en
      FROM mesa_clientes
      WHERE mesa_sesion_id = $1
        AND cliente_sesion_id = $2
      LIMIT 1
    `,
    [mesaSesionId, clientSessionId],
  );

  return result.rows[0] ?? null;
}

async function createMesaSession(client, mesaId) {
  const result = await client.query(
    `
      INSERT INTO mesa_sesiones (
        mesa_id,
        estado,
        lider_cliente_sesion_id
      )
      VALUES ($1, 'abierta', NULL)
      RETURNING id, mesa_id, estado, lider_cliente_sesion_id, creada_en, cerrada_en
    `,
    [mesaId],
  );

  return result.rows[0];
}

async function createMesaClient(client, mesaSesionId, clientSessionId) {
  const result = await client.query(
    `
      INSERT INTO mesa_clientes (
        mesa_sesion_id,
        cliente_sesion_id,
        conectada,
        desconexion_programada_en
      )
      VALUES ($1, $2, TRUE, NULL)
      RETURNING
        id,
        mesa_sesion_id,
        cliente_sesion_id,
        conectada,
        creada_en,
        ultimo_seen_en,
        desconectada_en,
        desconexion_programada_en
    `,
    [mesaSesionId, clientSessionId],
  );

  return result.rows[0];
}

async function touchMesaClient(client, mesaSesionId, clientSessionId) {
  await client.query(
    `
      UPDATE mesa_clientes
      SET conectada = TRUE,
          ultimo_seen_en = NOW(),
          desconectada_en = NULL,
          desconexion_programada_en = NULL
      WHERE mesa_sesion_id = $1
        AND cliente_sesion_id = $2
    `,
    [mesaSesionId, clientSessionId],
  );

  clearPendingDisconnectTimer(mesaSesionId, clientSessionId);
}

async function scheduleMesaClientDisconnect(client, mesaSesionId, clientSessionId, graceSeconds) {
  await client.query(
    `
      UPDATE mesa_clientes
      SET desconexion_programada_en = NOW() + ($3 * INTERVAL '1 second'),
          ultimo_seen_en = NOW()
      WHERE mesa_sesion_id = $1
        AND cliente_sesion_id = $2
    `,
    [mesaSesionId, clientSessionId, graceSeconds],
  );
}

function hasPendingDisconnect(mesaCliente) {
  return Boolean(mesaCliente?.desconexion_programada_en);
}

async function getOldestConnectedClientSessionId(client, mesaSesionId) {
  const oldestClientResult = await client.query(
    `
      SELECT cliente_sesion_id
      FROM mesa_clientes
      WHERE mesa_sesion_id = $1
        AND conectada = TRUE
      ORDER BY creada_en ASC
      LIMIT 1
    `,
    [mesaSesionId],
  );

  return oldestClientResult.rows[0]?.cliente_sesion_id ?? null;
}

async function syncMesaLeader(client, mesaSesionId, nextLeaderClientSessionId) {
  await client.query(
    `
      UPDATE mesa_sesiones
      SET lider_cliente_sesion_id = $2
      WHERE id = $1
    `,
    [mesaSesionId, nextLeaderClientSessionId],
  );
}

async function assignLeaderIfMissing(client, mesaSesionId) {
  const nextLeader = await getOldestConnectedClientSessionId(client, mesaSesionId);
  await syncMesaLeader(client, mesaSesionId, nextLeader);
  return nextLeader;
}

async function generateUniqueClientSessionId(client, mesaSesionId) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = generateClientSessionId();
    const exists = await getMesaClient(client, mesaSesionId, candidate);

    if (!exists) {
      return candidate;
    }
  }

  throw new DomainError(500, 'No se pudo generar un identificador corto para el cliente');
}

async function ensureMesaAndSession(client, mesaNumero) {
  const mesa = await getMesaByNumero(client, mesaNumero);
  if (!mesa) {
    throw new DomainError(404, `La mesa ${mesaNumero} no existe`);
  }
  if (!mesa.habilitada) {
    throw new DomainError(409, `La mesa ${mesaNumero} no esta habilitada`);
  }

  let mesaSesion = await getActiveMesaSession(client, mesa.id);
  let mesaSesionCreada = false;
  if (!mesaSesion) {
    mesaSesion = await createMesaSession(client, mesa.id);
    mesaSesionCreada = true;
  }

  return { mesa, mesaSesion, mesaSesionCreada };
}

async function countConnectedMesaClients(client, mesaSesionId) {
  const result = await client.query(
    `
      SELECT COUNT(*) AS total
      FROM mesa_clientes
      WHERE mesa_sesion_id = $1
        AND conectada = TRUE
    `,
    [mesaSesionId],
  );

  return Number(result.rows[0]?.total ?? 0);
}

async function ensureMesaAndExistingSession(client, mesaNumero) {
  const mesa = await getMesaByNumero(client, mesaNumero);
  if (!mesa) {
    throw new DomainError(404, `La mesa ${mesaNumero} no existe`);
  }
  if (!mesa.habilitada) {
    throw new DomainError(409, `La mesa ${mesaNumero} no esta habilitada`);
  }

  const mesaSesion = await getActiveMesaSession(client, mesa.id);
  if (!mesaSesion) {
    throw new DomainError(409, `La mesa ${mesaNumero} no tiene una sesion activa`);
  }

  return { mesa, mesaSesion };
}

async function ensureMesaClient(client, mesaSesionId, requestedClientSessionId) {
  let clientSessionId = requestedClientSessionId?.trim().toUpperCase() ?? null;
  let mesaCliente = null;
  let clientCreated = false;
  let clientReconnected = false;

  if (clientSessionId) {
    mesaCliente = await getMesaClient(client, mesaSesionId, clientSessionId);
  }

  if (mesaCliente && mesaCliente.conectada === false) {
    mesaCliente = null;
  }

  if (!mesaCliente) {
    clientSessionId = await generateUniqueClientSessionId(client, mesaSesionId);
    mesaCliente = await createMesaClient(client, mesaSesionId, clientSessionId);
    clientCreated = true;
  } else {
    clientReconnected = hasPendingDisconnect(mesaCliente);
    await touchMesaClient(client, mesaSesionId, clientSessionId);
  }

  const leaderClientSessionId = await assignLeaderIfMissing(client, mesaSesionId);

  return {
    mesaCliente,
    clientSessionId,
    clientCreated,
    clientReconnected,
    isLeader: leaderClientSessionId === clientSessionId,
  };
}

async function syncCartWithCatalog(client, mesaSesionId) {
  const deletedRowsResult = await client.query(
    `
      DELETE FROM mesa_carrito_items mci
      USING productos p
      WHERE mci.producto_id = p.id
        AND mci.mesa_sesion_id = $1
        AND p.activo = FALSE
      RETURNING mci.producto_id, p.titulo
    `,
    [mesaSesionId],
  );

  const deletedProducts = new Map();

  for (const row of deletedRowsResult.rows) {
    deletedProducts.set(Number(row.producto_id), {
      productoId: Number(row.producto_id),
      titulo: row.titulo,
    });
  }

  return Array.from(deletedProducts.values());
}

async function getVisualUsdExchangeRate(client) {
  const result = await client.query(
    `
      SELECT valor_texto
      FROM configuraciones_operativas
      WHERE clave = 'visual_usd_exchange_rate'
      LIMIT 1
    `,
  );

  return Number.parseFloat(result.rows[0]?.valor_texto ?? '0');
}

async function getMenuRows(client, mesaSesionId) {
  const result = await client.query(
    `
      SELECT
        c.id AS categoria_id,
        c.titulo AS categoria_titulo,
        c.orden AS categoria_orden,
        p.id AS producto_id,
        p.titulo AS producto_titulo,
        p.descripcion AS producto_descripcion,
        p.precio_ars_centavos,
        p.imagen_nombre_archivo,
        COALESCE(SUM(mci.cantidad), 0) AS cantidad_total_mesa
      FROM categorias c
      JOIN productos p
        ON p.categoria_id = c.id
      LEFT JOIN mesa_carrito_items mci
        ON mci.producto_id = p.id
       AND mci.mesa_sesion_id = $1
      WHERE c.activa = TRUE
        AND p.activo = TRUE
      GROUP BY
        c.id,
        c.titulo,
        c.orden,
        p.id,
        p.titulo,
        p.descripcion,
        p.precio_ars_centavos,
        p.imagen_nombre_archivo
      ORDER BY c.orden ASC, p.titulo ASC
    `,
    [mesaSesionId],
  );

  return result.rows;
}

async function getCatalogRevision(client) {
  const result = await client.query(
    `
      SELECT GREATEST(
        COALESCE((SELECT MAX(updated_at) FROM categorias), TO_TIMESTAMP(0)),
        COALESCE((SELECT MAX(updated_at) FROM productos), TO_TIMESTAMP(0))
      ) AS catalogo_revision
    `,
  );

  const revision = result.rows[0]?.catalogo_revision ?? null;

  if (revision instanceof Date) {
    return revision.toISOString();
  }

  return revision ? String(revision) : null;
}

async function getCartRows(client, mesaSesionId) {
  const result = await client.query(
    `
      SELECT
        p.id AS producto_id,
        p.titulo,
        p.descripcion,
        p.precio_ars_centavos,
        SUM(mci.cantidad) AS cantidad_total,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'clienteSesionId', mci.cliente_sesion_id,
            'cantidad', mci.cantidad
          )
          ORDER BY mci.cliente_sesion_id ASC
        ) AS cantidades_por_cliente
      FROM mesa_carrito_items mci
      JOIN productos p
        ON p.id = mci.producto_id
      WHERE mci.mesa_sesion_id = $1
        AND p.activo = TRUE
      GROUP BY p.id, p.titulo, p.descripcion, p.precio_ars_centavos
      ORDER BY p.titulo ASC
    `,
    [mesaSesionId],
  );

  return result.rows;
}

async function getPendingCall(client, mesaSesionId) {
  const result = await client.query(
    `
      SELECT id, creada_en
      FROM llamados_mozo
      WHERE mesa_sesion_id = $1
        AND estado = 'pendiente'
      ORDER BY creada_en DESC
      LIMIT 1
    `,
    [mesaSesionId],
  );

  return result.rows[0] ?? null;
}

async function getPendingConsulta(client, mesaSesionId) {
  const result = await client.query(
    `
      SELECT id, creada_en
      FROM consultas_master
      WHERE mesa_sesion_id = $1
        AND estado = 'pendiente'
      ORDER BY creada_en DESC
      LIMIT 1
    `,
    [mesaSesionId],
  );

  return result.rows[0] ?? null;
}

async function getActiveConsultaWithMessages(client, mesaSesionId) {
  const consultaResult = await client.query(
    `
      SELECT id, creada_en
      FROM consultas_master
      WHERE mesa_sesion_id = $1
        AND estado = 'pendiente'
      ORDER BY creada_en DESC
      LIMIT 1
    `,
    [mesaSesionId],
  );

  const consulta = consultaResult.rows[0] ?? null;
  if (!consulta) {
    return null;
  }

  const mensajesResult = await client.query(
    `
      SELECT id, autor_tipo, autor_referencia, contenido, creada_en
      FROM consultas_detail
      WHERE consulta_id = $1
      ORDER BY creada_en ASC, id ASC
    `,
    [consulta.id],
  );

  return {
    id: Number(consulta.id),
    creadaEn: consulta.creada_en,
    mensajes: mensajesResult.rows.map((row) => ({
      id: Number(row.id),
      autorTipo: row.autor_tipo,
      autorReferencia: row.autor_referencia,
      contenido: row.contenido,
      creadaEn: row.creada_en,
    })),
  };
}

async function listConfirmedOrders(client, mesaSesionId) {
  const result = await client.query(
    `
      SELECT id, numero_orden, total_ars_centavos, confirmado_en, cobrado_en
      FROM pedido_sesiones
      WHERE mesa_sesion_id = $1
      ORDER BY numero_orden DESC
    `,
    [mesaSesionId],
  );

  return result.rows;
}

async function getConfirmedOrderItems(client, pedidoSesionId) {
  const result = await client.query(
    `
      SELECT
        producto_id,
        titulo_snapshot,
        descripcion_snapshot,
        precio_ars_centavos_snapshot,
        SUM(cantidad) AS cantidad_total,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'clienteSesionId', cliente_sesion_id,
            'cantidad', cantidad
          )
          ORDER BY cliente_sesion_id ASC
        ) AS cantidades_por_cliente
      FROM pedido_items
      WHERE pedido_sesion_id = $1
      GROUP BY
        producto_id,
        titulo_snapshot,
        descripcion_snapshot,
        precio_ars_centavos_snapshot
      ORDER BY titulo_snapshot ASC
    `,
    [pedidoSesionId],
  );

  return result.rows;
}

async function getConfirmedOrdersWithItems(client, mesaSesionId) {
  const orders = await listConfirmedOrders(client, mesaSesionId);

  return Promise.all(orders.map(async (order) => ({
    id: Number(order.id),
    numeroOrden: Number(order.numero_orden),
    totalArsCentavos: Number(order.total_ars_centavos),
    confirmadoEn: order.confirmado_en,
    cobradoEn: order.cobrado_en,
    items: (await getConfirmedOrderItems(client, order.id)).map((row) => ({
      productoId: Number(row.producto_id),
      titulo: row.titulo_snapshot,
      descripcion: row.descripcion_snapshot,
      precioArsCentavos: Number(row.precio_ars_centavos_snapshot),
      cantidadTotal: Number(row.cantidad_total),
      cantidadesPorCliente: row.cantidades_por_cliente ?? [],
    })),
  })));
}

async function buildMesaState(client, mesa, mesaSesion, clientSessionId) {
  const productosRemovidosDelCarrito = await syncCartWithCatalog(client, mesaSesion.id);
  let leaderClientSessionId = await assignLeaderIfMissing(client, mesaSesion.id);

  if (!leaderClientSessionId && clientSessionId) {
    await touchMesaClient(client, mesaSesion.id, clientSessionId);
    leaderClientSessionId = await assignLeaderIfMissing(client, mesaSesion.id);
  }
  const cartRows = await getCartRows(client, mesaSesion.id);
  const pendingCall = await getPendingCall(client, mesaSesion.id);
  const pendingConsulta = await getPendingConsulta(client, mesaSesion.id);
  const activeConsulta = await getActiveConsultaWithMessages(client, mesaSesion.id);
  const confirmedOrders = await getConfirmedOrdersWithItems(client, mesaSesion.id);
  const visualUsdExchangeRate = await getVisualUsdExchangeRate(client);
  const catalogoRevision = await getCatalogRevision(client);

  const items = cartRows.map((row) => ({
    productoId: Number(row.producto_id),
    titulo: row.titulo,
    descripcion: row.descripcion,
    precioArsCentavos: Number(row.precio_ars_centavos),
    cantidadTotal: Number(row.cantidad_total),
    cantidadesPorCliente: row.cantidades_por_cliente ?? [],
  }));

  const totalArsCentavos = items.reduce(
    (accumulator, item) => accumulator + (item.precioArsCentavos * item.cantidadTotal),
    0,
  );

  return {
    mesaNumero: mesa.numero,
    mesaSesionId: Number(mesaSesion.id),
    clientSessionId,
    catalogoRevision,
    isLeader: leaderClientSessionId === clientSessionId,
    canConfirmOrder: leaderClientSessionId === clientSessionId && items.length > 0,
    pedidoConfirmado: confirmedOrders.length > 0,
    totalPedidosConfirmados: confirmedOrders.length,
    visualUsdExchangeRate,
    productosRemovidosDelCarrito,
    carritoPendiente: {
      items,
      totalArsCentavos,
    },
    pedidoActual: {
      items,
      totalArsCentavos,
    },
    pedidosConfirmados: confirmedOrders,
    pedidoConfirmadoDetalle: confirmedOrders[0] ?? null,
    llamadoMozoPendiente: pendingCall
      ? {
          id: Number(pendingCall.id),
          creadaEn: pendingCall.creada_en,
        }
      : null,
    consultaPendiente: pendingConsulta
      ? {
          id: Number(pendingConsulta.id),
          creadaEn: pendingConsulta.creada_en,
        }
      : null,
    consultaActiva: activeConsulta,
  };
}

async function getMesaContext(pool, recordAuditEvent, publishDomainEvent, mesaNumero, requestedClientSessionId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion, mesaSesionCreada } = await ensureMesaAndSession(client, mesaNumero);
    const { clientSessionId, clientCreated, clientReconnected } = await ensureMesaClient(
      client,
      mesaSesion.id,
      requestedClientSessionId,
    );
    const leaderClientSessionId = await assignLeaderIfMissing(client, mesaSesion.id);
    const currentIsLeader = leaderClientSessionId === clientSessionId;

    const adoptedOrphanItemsCount = currentIsLeader
      ? await adoptOrphanCartItems(client, mesaSesion.id, clientSessionId)
      : 0;

    if (mesaSesionCreada) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: 'mesa_sesion_abierta',
        actorTipo: 'cliente',
        actorReferencia: clientSessionId,
        payload: {
          mesaNumero: mesa.numero,
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
          mesaNumero: mesa.numero,
          mesaSesionId: Number(mesaSesion.id),
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
          mesaNumero: mesa.numero,
          mesaSesionId: Number(mesaSesion.id),
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
          mesaNumero: mesa.numero,
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
        mesa.numero,
      );
    }

    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(client, mesaSesion.id);

    await client.query('COMMIT');

    return {
      mesaNumero: mesa.numero,
      mesaSesionId: Number(mesaSesion.id),
      clientSessionId,
      isLeader: currentIsLeader,
      menu: mapMenuRowsToCategories(menuRows),
      state,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function finalizeClientDisconnect(
  pool,
  recordAuditEvent,
  publishDomainEvent,
  mesaNumero,
  clientSessionId,
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const mesa = await getMesaByNumero(client, mesaNumero);
    if (!mesa) {
      await client.query('COMMIT');
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const mesaSesion = await getActiveMesaSession(client, mesa.id);
    if (!mesaSesion) {
      await client.query('COMMIT');
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);
    if (!mesaCliente || mesaCliente.conectada === false || !hasPendingDisconnect(mesaCliente)) {
      await client.query('COMMIT');
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const disconnectDeadlineMs = new Date(mesaCliente.desconexion_programada_en).getTime();
    if (Number.isFinite(disconnectDeadlineMs) && disconnectDeadlineMs > Date.now()) {
      await client.query('COMMIT');
      return {
        disconnected: false,
        ignored: true,
      };
    }

    await client.query(
      `
        UPDATE mesa_clientes
        SET conectada = FALSE,
            desconectada_en = NOW(),
            ultimo_seen_en = NOW(),
            desconexion_programada_en = NULL
        WHERE mesa_sesion_id = $1
          AND cliente_sesion_id = $2
      `,
      [mesaSesion.id, clientSessionId],
    );

    const previousLeaderClientSessionId = mesaSesion.lider_cliente_sesion_id ?? null;
    const nextLeaderClientSessionId = await assignLeaderIfMissing(client, mesaSesion.id);
    const connectedClients = await countConnectedMesaClients(client, mesaSesion.id);
    const cartOwnershipResult = await applyCartOwnershipOnConfirmedDeparture(
      client,
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
        mesaNumero: mesa.numero,
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
          mesaNumero: mesa.numero,
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
          mesaNumero: mesa.numero,
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
          mesaNumero: mesa.numero,
          cantidadItemsReasignados: cartOwnershipResult.itemCount,
          propietarioActualClienteSesionId: cartOwnershipResult.ownerClientSessionId,
        },
      });
    }

    await publishMesaPublicRefresh(client, publishDomainEvent, 'cliente_mesa_desconectado', mesa.numero);

    await client.query('COMMIT');

    return {
      disconnected: true,
      ignored: false,
      mesaSesionId: Number(mesaSesion.id),
      leaderClientSessionId: nextLeaderClientSessionId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function scheduleClientDisconnectFinalization(
  pool,
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
      pool,
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

async function listPendingDisconnects(client) {
  const result = await client.query(
    `
      SELECT
        mc.mesa_sesion_id,
        mc.cliente_sesion_id,
        mc.desconexion_programada_en,
        m.numero AS mesa_numero
      FROM mesa_clientes mc
      JOIN mesa_sesiones ms
        ON ms.id = mc.mesa_sesion_id
      JOIN mesas m
        ON m.id = ms.mesa_id
      WHERE ms.estado = 'abierta'
        AND mc.conectada = TRUE
        AND mc.desconexion_programada_en IS NOT NULL
    `,
  );

  return result.rows.map((row) => ({
    mesaSesionId: Number(row.mesa_sesion_id),
    mesaNumero: Number(row.mesa_numero),
    clientSessionId: row.cliente_sesion_id,
    disconnectScheduledAt: row.desconexion_programada_en,
  }));
}

function scheduleRecoveredClientDisconnectFinalization(
  pool,
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
      pool,
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

async function connectClient(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);

    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }

    const leaderBefore = mesaSesion.lider_cliente_sesion_id ?? null;

    await touchMesaClient(client, mesaSesion.id, clientSessionId);

    const leaderAfter = await assignLeaderIfMissing(client, mesaSesion.id);
    const adoptedOrphanItemsCount = leaderAfter === clientSessionId
      ? await adoptOrphanCartItems(client, mesaSesion.id, clientSessionId)
      : 0;

    if (adoptedOrphanItemsCount > 0) {
      await recordAuditEvent(client, {
        agregado: 'mesa_sesiones',
        agregadoId: mesaSesion.id,
        evento: 'carrito_huerfano_heredado',
        actorTipo: 'cliente',
        actorReferencia: clientSessionId,
        payload: {
          mesaNumero: mesa.numero,
          cantidadItemsHeredados: adoptedOrphanItemsCount,
        },
      });
    }

    if (leaderBefore !== leaderAfter || adoptedOrphanItemsCount > 0) {
      await publishMesaPublicRefresh(
        client,
        publishDomainEvent,
        adoptedOrphanItemsCount > 0 ? 'carrito_huerfano_heredado' : 'cliente_mesa_conectado',
        mesa.numero,
      );
    }

    await client.query('COMMIT');

    return {
      connected: true,
      mesaSesionId: Number(mesaSesion.id),
      leaderClientSessionId: leaderAfter,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getMenu(pool, mesaNumero, clientSessionId) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);

    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }

    await touchMesaClient(client, mesaSesion.id, clientSessionId);
    await assignLeaderIfMissing(client, mesaSesion.id);
    await syncCartWithCatalog(client, mesaSesion.id);
    const rows = await getMenuRows(client, mesaSesion.id);
    await client.query('COMMIT');

    return {
      mesaNumero: mesa.numero,
      mesaSesionId: Number(mesaSesion.id),
      categorias: mapMenuRowsToCategories(rows),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function disconnectClient(
  pool,
  recordAuditEvent,
  publishDomainEvent,
  disconnectGraceSeconds,
  mesaNumero,
  clientSessionId,
) {
  if (!clientSessionId) {
    return {
      disconnected: false,
      ignored: true,
    };
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const mesa = await getMesaByNumero(client, mesaNumero);
    if (!mesa) {
      await client.query('COMMIT');
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const mesaSesion = await getActiveMesaSession(client, mesa.id);
    if (!mesaSesion) {
      await client.query('COMMIT');
      return {
        disconnected: false,
        ignored: true,
      };
    }

    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);
    if (!mesaCliente) {
      await client.query('COMMIT');
      return {
        disconnected: false,
        ignored: true,
      };
    }

    if (mesaCliente.conectada === false) {
      await client.query('COMMIT');
      return {
        disconnected: true,
        ignored: true,
      };
    }

    if (hasPendingDisconnect(mesaCliente)) {
      await scheduleMesaClientDisconnect(
        client,
        mesaSesion.id,
        clientSessionId,
        disconnectGraceSeconds,
      );

      await client.query('COMMIT');
      scheduleClientDisconnectFinalization(
        pool,
        recordAuditEvent,
        publishDomainEvent,
        mesa.numero,
        mesaSesion.id,
        clientSessionId,
        disconnectGraceSeconds,
      );
      return {
        disconnected: false,
        pending: true,
        mesaSesionId: Number(mesaSesion.id),
      };
    }

    await scheduleMesaClientDisconnect(
      client,
      mesaSesion.id,
      clientSessionId,
      disconnectGraceSeconds,
    );

    await client.query('COMMIT');

    scheduleClientDisconnectFinalization(
      pool,
      recordAuditEvent,
      publishDomainEvent,
      mesa.numero,
      mesaSesion.id,
      clientSessionId,
      disconnectGraceSeconds,
    );

    return {
      disconnected: false,
      pending: true,
      mesaSesionId: Number(mesaSesion.id),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recoverPendingDisconnects(pool, recordAuditEvent, publishDomainEvent) {
  const client = await pool.connect();

  try {
    const pendingDisconnects = await listPendingDisconnects(client);

    for (const pendingDisconnect of pendingDisconnects) {
      scheduleRecoveredClientDisconnectFinalization(
        pool,
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
  } finally {
    client.release();
  }
}

async function getState(pool, mesaNumero, clientSessionId) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);

    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }

    await touchMesaClient(client, mesaSesion.id, clientSessionId);
    await assignLeaderIfMissing(client, mesaSesion.id);
    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateCartItem(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, productoId, action) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }
  if (!productoId) {
    throw new DomainError(400, 'Falta productoId');
  }
  if (!['add', 'remove'].includes(action)) {
    throw new DomainError(400, 'La accion del carrito es invalida');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);
    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }
    await touchMesaClient(client, mesaSesion.id, clientSessionId);
    await assignLeaderIfMissing(client, mesaSesion.id);

    await syncCartWithCatalog(client, mesaSesion.id);

    const productResult = await client.query(
      `
        SELECT id, titulo, activo
        FROM productos
        WHERE id = $1
        LIMIT 1
      `,
      [productoId],
    );

    const product = productResult.rows[0] ?? null;
    if (!product || !product.activo) {
      throw new DomainError(404, 'El producto no existe o ya no esta disponible');
    }

    const existingResult = await client.query(
      `
        SELECT id, cantidad
        FROM mesa_carrito_items
        WHERE mesa_sesion_id = $1
          AND producto_id = $2
          AND cliente_sesion_id = $3
        LIMIT 1
      `,
      [mesaSesion.id, productoId, clientSessionId],
    );

    const existing = existingResult.rows[0] ?? null;
    let affectedClientSessionId = clientSessionId;

    if (action === 'add') {
      if (!existing) {
        await client.query(
          `
            INSERT INTO mesa_carrito_items (
              mesa_sesion_id,
              producto_id,
              cliente_sesion_id,
              cantidad
            )
            VALUES ($1, $2, $3, 1)
          `,
          [mesaSesion.id, productoId, clientSessionId],
        );
      } else {
        await client.query(
          `
            UPDATE mesa_carrito_items
            SET cantidad = cantidad + 1,
                updated_at = NOW()
            WHERE id = $1
          `,
          [existing.id],
        );
      }
    }

    if (action === 'remove') {
      if (!existing) {
        throw new DomainError(409, 'Solo puedes descartar productos de tu propiedad en la mesa');
      }

      affectedClientSessionId = clientSessionId;

      if (Number(existing.cantidad) <= 1) {
        await client.query(
          `
            DELETE FROM mesa_carrito_items
            WHERE id = $1
          `,
          [existing.id],
        );
      } else {
        await client.query(
          `
            UPDATE mesa_carrito_items
            SET cantidad = cantidad - 1,
                updated_at = NOW()
            WHERE id = $1
          `,
          [existing.id],
        );
      }
    }

    await recordAuditEvent(client, {
      agregado: 'mesa_sesiones',
      agregadoId: mesaSesion.id,
      evento: action === 'add' ? 'carrito_item_agregado' : 'carrito_item_descartado',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.numero,
        productoId: Number(product.id),
        productoTitulo: product.titulo,
        accion: action,
        clienteSesionIdAfectada: affectedClientSessionId,
      },
    });

    await publishMesaPublicRefresh(client, publishDomainEvent, `carrito_${action}`, mesa.numero);

    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(client, mesaSesion.id);

    await client.query('COMMIT');

    return {
      menu: mapMenuRowsToCategories(menuRows),
      state,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getNextOrderNumber(client, mesaSesionId) {
  const result = await client.query(
    `
      SELECT COALESCE(MAX(numero_orden), 0) + 1 AS siguiente_numero
      FROM pedido_sesiones
      WHERE mesa_sesion_id = $1
    `,
    [mesaSesionId],
  );

  return Number(result.rows[0]?.siguiente_numero ?? 1);
}

async function confirmOrder(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);

    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }
    if (mesaSesion.lider_cliente_sesion_id !== clientSessionId) {
      throw new DomainError(403, 'Solo el lider de la mesa puede confirmar el pedido');
    }

    await syncCartWithCatalog(client, mesaSesion.id);

    const cartRowsResult = await client.query(
      `
        SELECT
          mci.producto_id,
          mci.cliente_sesion_id,
          mci.cantidad,
          p.titulo,
          p.descripcion,
          p.precio_ars_centavos
        FROM mesa_carrito_items mci
        JOIN productos p
          ON p.id = mci.producto_id
        WHERE mci.mesa_sesion_id = $1
          AND p.activo = TRUE
        ORDER BY p.titulo ASC, mci.cliente_sesion_id ASC
      `,
      [mesaSesion.id],
    );

    if (cartRowsResult.rows.length === 0) {
      throw new DomainError(409, 'No se puede confirmar un pedido vacio');
    }

    const totalArsCentavos = cartRowsResult.rows.reduce(
      (accumulator, row) => accumulator + (Number(row.precio_ars_centavos) * Number(row.cantidad)),
      0,
    );
    const nextOrderNumber = await getNextOrderNumber(client, mesaSesion.id);

    const pedidoSesionResult = await client.query(
      `
        INSERT INTO pedido_sesiones (
          mesa_sesion_id,
          numero_orden,
          total_ars_centavos,
          confirmado_en
        )
        VALUES ($1, $2, $3, NOW())
        RETURNING id, numero_orden, total_ars_centavos, confirmado_en, cobrado_en
      `,
      [mesaSesion.id, nextOrderNumber, totalArsCentavos],
    );

    const pedidoSesion = pedidoSesionResult.rows[0];

    for (const row of cartRowsResult.rows) {
      await client.query(
        `
          INSERT INTO pedido_items (
            pedido_sesion_id,
            producto_id,
            cliente_sesion_id,
            titulo_snapshot,
            descripcion_snapshot,
            precio_ars_centavos_snapshot,
            cantidad
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          pedidoSesion.id,
          row.producto_id,
          row.cliente_sesion_id,
          row.titulo,
          row.descripcion,
          row.precio_ars_centavos,
          row.cantidad,
        ],
      );
    }

    await client.query(
      `
        INSERT INTO pedidos_cocina (
          pedido_sesion_id,
          estado
        )
        VALUES ($1, 'pendiente')
      `,
      [pedidoSesion.id],
    );

    await client.query(
      `
        DELETE FROM mesa_carrito_items
        WHERE mesa_sesion_id = $1
      `,
      [mesaSesion.id],
    );

    await recordAuditEvent(client, {
      agregado: 'pedido_sesiones',
      agregadoId: pedidoSesion.id,
      evento: 'pedido_confirmado',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.numero,
        mesaSesionId: Number(mesaSesion.id),
        numeroOrden: Number(pedidoSesion.numero_orden),
        totalArsCentavos: Number(pedidoSesion.total_ars_centavos),
        items: cartRowsResult.rows.map((row) => ({
          productoId: Number(row.producto_id),
          titulo: row.titulo,
          cantidad: Number(row.cantidad),
          clienteSesionId: row.cliente_sesion_id,
        })),
      },
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'pedido_confirmado',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendientePedidosCocina,
      ],
    );

    await publishMesaPublicRefresh(client, publishDomainEvent, 'pedido_confirmado', mesa.numero);

    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    const menuRows = await getMenuRows(client, mesaSesion.id);

    await client.query('COMMIT');

    return {
      menu: mapMenuRowsToCategories(menuRows),
      state,
      pedidoConfirmado: {
        id: Number(pedidoSesion.id),
        numeroOrden: Number(pedidoSesion.numero_orden),
        totalArsCentavos: Number(pedidoSesion.total_ars_centavos),
        confirmadoEn: pedidoSesion.confirmado_en,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function callWaiter(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);
    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }

    const pendingCall = await getPendingCall(client, mesaSesion.id);
    if (pendingCall) {
      throw new DomainError(409, 'La mesa ya tiene un llamado a mozo pendiente');
    }

    const callResult = await client.query(
      `
        INSERT INTO llamados_mozo (
          mesa_sesion_id,
          estado
        )
        VALUES ($1, 'pendiente')
        RETURNING id
      `,
      [mesaSesion.id],
    );

    await recordAuditEvent(client, {
      agregado: 'llamados_mozo',
      agregadoId: callResult.rows[0].id,
      evento: 'llamado_creado',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.numero,
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

    await publishMesaPublicRefresh(client, publishDomainEvent, 'llamado_creado', mesa.numero);

    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function openConsulta(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, contenido) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }
  if (!contenido?.trim()) {
    throw new DomainError(400, 'El contenido de la consulta es obligatorio');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);
    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }

    const pendingConsulta = await getPendingConsulta(client, mesaSesion.id);
    if (pendingConsulta) {
      throw new DomainError(409, 'La mesa ya tiene una consulta abierta');
    }

    const consultaResult = await client.query(
      `
        INSERT INTO consultas_master (
          mesa_sesion_id,
          estado
        )
        VALUES ($1, 'pendiente')
        RETURNING id
      `,
      [mesaSesion.id],
    );

    const consultaId = consultaResult.rows[0].id;

    await client.query(
      `
        INSERT INTO consultas_detail (
          consulta_id,
          autor_tipo,
          autor_referencia,
          contenido
        )
        VALUES ($1, 'cliente', $2, $3)
      `,
      [consultaId, clientSessionId, contenido.trim()],
    );

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: consultaId,
      evento: 'consulta_abierta',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.numero,
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

    await publishMesaPublicRefresh(client, publishDomainEvent, 'consulta_abierta', mesa.numero);

    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function sendConsultaMessageFromClient(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, contenido) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }
  if (!contenido?.trim()) {
    throw new DomainError(400, 'El mensaje es obligatorio');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);
    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }

    const pendingConsulta = await getPendingConsulta(client, mesaSesion.id);
    if (!pendingConsulta) {
      throw new DomainError(409, 'La mesa no tiene una consulta abierta');
    }

    await client.query(
      `
        INSERT INTO consultas_detail (
          consulta_id,
          autor_tipo,
          autor_referencia,
          contenido
        )
        VALUES ($1, 'cliente', $2, $3)
      `,
      [pendingConsulta.id, clientSessionId, contenido.trim()],
    );

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: pendingConsulta.id,
      evento: 'consulta_mensaje_cliente',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.numero,
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

    await publishMesaPublicRefresh(client, publishDomainEvent, 'consulta_mensaje_cliente', mesa.numero);

    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closeConsultaFromClient(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId) {
  if (!clientSessionId) {
    throw new DomainError(400, 'Falta clientSessionId');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { mesa, mesaSesion } = await ensureMesaAndExistingSession(client, mesaNumero);
    const mesaCliente = await getMesaClient(client, mesaSesion.id, clientSessionId);
    if (!mesaCliente || mesaCliente.conectada === false) {
      throw new DomainError(404, 'La sesion del cliente no pertenece a la mesa activa');
    }

    const pendingConsulta = await getPendingConsulta(client, mesaSesion.id);
    if (!pendingConsulta) {
      throw new DomainError(409, 'La mesa no tiene una consulta abierta');
    }

    await client.query(
      `
        UPDATE consultas_master
        SET estado = 'atendido',
            cerrada_en = NOW(),
            cerrada_por = $2
        WHERE id = $1
      `,
      [pendingConsulta.id, `cliente:${clientSessionId}`],
    );

    await recordAuditEvent(client, {
      agregado: 'consultas',
      agregadoId: pendingConsulta.id,
      evento: 'consulta_cerrada_por_cliente',
      actorTipo: 'cliente',
      actorReferencia: clientSessionId,
      payload: {
        mesaNumero: mesa.numero,
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

    await publishMesaPublicRefresh(client, publishDomainEvent, 'consulta_cerrada_por_cliente', mesa.numero);

    const state = await buildMesaState(client, mesa, mesaSesion, clientSessionId);
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getWaiterQueues(pool, status) {
  const client = await pool.connect();

  try {
    const consultaRows = await client.query(
      `
        SELECT
          c.id,
          c.estado,
          c.creada_en,
          c.cerrada_en,
          ms.id AS mesa_sesion_id,
          m.numero AS mesa_numero,
          (
            SELECT contenido
            FROM consultas_detail cm
            WHERE cm.consulta_id = c.id
            ORDER BY cm.creada_en ASC, cm.id ASC
            LIMIT 1
          ) AS resumen
        FROM consultas_master c
        JOIN mesa_sesiones ms
          ON ms.id = c.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE c.estado = $1
        ORDER BY c.creada_en ASC
      `,
      [status],
    );

    const kitchenRows = await client.query(
      `
        SELECT
          pk.id,
          pk.estado,
          pk.creada_en,
          pk.atendida_en,
          ms.id AS mesa_sesion_id,
          m.numero AS mesa_numero,
          ps.total_ars_centavos
        FROM pedidos_cocina pk
        JOIN pedido_sesiones ps
          ON ps.id = pk.pedido_sesion_id
        JOIN mesa_sesiones ms
          ON ms.id = ps.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE pk.estado = $1
        ORDER BY pk.creada_en ASC
      `,
      [status],
    );

    const waiterCallRows = await client.query(
      `
        SELECT
          lm.id,
          lm.estado,
          lm.creada_en,
          lm.atendida_en,
          ms.id AS mesa_sesion_id,
          m.numero AS mesa_numero
        FROM llamados_mozo lm
        JOIN mesa_sesiones ms
          ON ms.id = lm.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE lm.estado = $1
        ORDER BY lm.creada_en ASC
      `,
      [status],
    );

    return {
      status,
      consultas: consultaRows.rows.map((row) => ({
        id: Number(row.id),
        mesaNumero: Number(row.mesa_numero),
        mesaSesionId: Number(row.mesa_sesion_id),
        estado: row.estado,
        creadaEn: row.creada_en,
        cerradaEn: row.cerrada_en,
        resumen: row.resumen,
      })),
      pedidosCocina: kitchenRows.rows.map((row) => ({
        id: Number(row.id),
        mesaNumero: Number(row.mesa_numero),
        mesaSesionId: Number(row.mesa_sesion_id),
        estado: row.estado,
        creadaEn: row.creada_en,
        atendidaEn: row.atendida_en,
        totalArsCentavos: Number(row.total_ars_centavos),
      })),
      llamadosMozo: waiterCallRows.rows.map((row) => ({
        id: Number(row.id),
        mesaNumero: Number(row.mesa_numero),
        mesaSesionId: Number(row.mesa_sesion_id),
        estado: row.estado,
        creadaEn: row.creada_en,
        atendidaEn: row.atendida_en,
      })),
    };
  } finally {
    client.release();
  }
}

async function getConsultaDetail(pool, consultaId) {
  const client = await pool.connect();

  try {
    const consultaResult = await client.query(
      `
        SELECT
          c.id,
          c.estado,
          c.creada_en,
          c.cerrada_en,
          ms.id AS mesa_sesion_id,
          m.numero AS mesa_numero
        FROM consultas_master c
        JOIN mesa_sesiones ms
          ON ms.id = c.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [consultaId],
    );

    const consulta = consultaResult.rows[0] ?? null;
    if (!consulta) {
      throw new DomainError(404, 'La consulta no existe');
    }

    const mensajesResult = await client.query(
      `
        SELECT id, autor_tipo, autor_referencia, contenido, creada_en
        FROM consultas_detail
        WHERE consulta_id = $1
        ORDER BY creada_en ASC, id ASC
      `,
      [consultaId],
    );

    return {
      id: Number(consulta.id),
      mesaNumero: Number(consulta.mesa_numero),
      mesaSesionId: Number(consulta.mesa_sesion_id),
      estado: consulta.estado,
      creadaEn: consulta.creada_en,
      cerradaEn: consulta.cerrada_en,
      mensajes: mensajesResult.rows.map((row) => ({
        id: Number(row.id),
        autorTipo: row.autor_tipo,
        autorReferencia: row.autor_referencia,
        contenido: row.contenido,
        creadaEn: row.creada_en,
      })),
    };
  } finally {
    client.release();
  }
}

async function getKitchenOrderDetail(pool, kitchenOrderId) {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
        SELECT
          pk.id,
          pk.estado,
          pk.creada_en,
          pk.atendida_en,
          ps.id AS pedido_sesion_id,
          ps.total_ars_centavos,
          ms.id AS mesa_sesion_id,
          m.numero AS mesa_numero
        FROM pedidos_cocina pk
        JOIN pedido_sesiones ps
          ON ps.id = pk.pedido_sesion_id
        JOIN mesa_sesiones ms
          ON ms.id = ps.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE pk.id = $1
        LIMIT 1
      `,
      [kitchenOrderId],
    );

    const order = result.rows[0] ?? null;
    if (!order) {
      throw new DomainError(404, 'El pedido de cocina no existe');
    }

    const itemsResult = await client.query(
      `
        SELECT
          titulo_snapshot,
          descripcion_snapshot,
          precio_ars_centavos_snapshot,
          cantidad,
          cliente_sesion_id
        FROM pedido_items
        WHERE pedido_sesion_id = $1
        ORDER BY titulo_snapshot ASC, cliente_sesion_id ASC
      `,
      [order.pedido_sesion_id],
    );

    return {
      id: Number(order.id),
      mesaNumero: Number(order.mesa_numero),
      mesaSesionId: Number(order.mesa_sesion_id),
      estado: order.estado,
      creadaEn: order.creada_en,
      atendidaEn: order.atendida_en,
      totalArsCentavos: Number(order.total_ars_centavos),
      items: itemsResult.rows.map((row) => ({
        titulo: row.titulo_snapshot,
        descripcion: row.descripcion_snapshot,
        precioArsCentavos: Number(row.precio_ars_centavos_snapshot),
        cantidad: Number(row.cantidad),
        clienteSesionId: row.cliente_sesion_id,
      })),
    };
  } finally {
    client.release();
  }
}

async function getWaiterCallDetail(pool, waiterCallId) {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
        SELECT
          lm.id,
          lm.estado,
          lm.creada_en,
          lm.atendida_en,
          lm.atendida_por,
          ms.id AS mesa_sesion_id,
          m.numero AS mesa_numero
        FROM llamados_mozo lm
        JOIN mesa_sesiones ms
          ON ms.id = lm.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE lm.id = $1
        LIMIT 1
      `,
      [waiterCallId],
    );

    const waiterCall = result.rows[0] ?? null;
    if (!waiterCall) {
      throw new DomainError(404, 'El llamado a mozo no existe');
    }

    return {
      id: Number(waiterCall.id),
      mesaNumero: Number(waiterCall.mesa_numero),
      mesaSesionId: Number(waiterCall.mesa_sesion_id),
      estado: waiterCall.estado,
      creadaEn: waiterCall.creada_en,
      atendidaEn: waiterCall.atendida_en,
      atendidaPor: waiterCall.atendida_por,
    };
  } finally {
    client.release();
  }
}

async function sendConsultaMessageFromWaiter(pool, recordAuditEvent, publishDomainEvent, consultaId, actorNombre, contenido) {
  if (!contenido?.trim()) {
    throw new DomainError(400, 'El mensaje es obligatorio');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const consultaResult = await client.query(
      `
        SELECT c.id, c.estado, ms.id AS mesa_sesion_id, m.numero AS mesa_numero
        FROM consultas_master c
        JOIN mesa_sesiones ms
          ON ms.id = c.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [consultaId],
    );

    const consulta = consultaResult.rows[0] ?? null;
    if (!consulta) {
      throw new DomainError(404, 'La consulta no existe');
    }
    if (consulta.estado !== 'pendiente') {
      throw new DomainError(409, 'La consulta ya fue cerrada');
    }

    await client.query(
      `
        INSERT INTO consultas_detail (
          consulta_id,
          autor_tipo,
          autor_referencia,
          contenido
        )
        VALUES ($1, 'mozo', $2, $3)
      `,
      [consultaId, actorNombre ?? 'mozo', contenido.trim()],
    );

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

    await client.query('COMMIT');
    return getConsultaDetail(pool, consultaId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closeConsultaFromWaiter(pool, recordAuditEvent, publishDomainEvent, consultaId, actorNombre) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const consultaResult = await client.query(
      `
        SELECT c.id, c.estado, ms.id AS mesa_sesion_id, m.numero AS mesa_numero
        FROM consultas_master c
        JOIN mesa_sesiones ms
          ON ms.id = c.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [consultaId],
    );

    const consulta = consultaResult.rows[0] ?? null;
    if (!consulta) {
      throw new DomainError(404, 'La consulta no existe');
    }
    if (consulta.estado !== 'pendiente') {
      throw new DomainError(409, 'La consulta ya fue cerrada');
    }

    await client.query(
      `
        UPDATE consultas_master
        SET estado = 'atendido',
            cerrada_en = NOW(),
            cerrada_por = $2
        WHERE id = $1
      `,
      [consultaId, `mozo:${actorNombre ?? 'mozo'}`],
    );

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

    await client.query('COMMIT');
    return getConsultaDetail(pool, consultaId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function receiveWaiterCall(pool, recordAuditEvent, publishDomainEvent, waiterCallId, actorNombre) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE llamados_mozo
        SET estado = 'atendido',
            atendida_en = NOW(),
            atendida_por = $2
        WHERE id = $1
          AND estado = 'pendiente'
        RETURNING id, mesa_sesion_id
      `,
      [waiterCallId, actorNombre ?? 'mozo'],
    );

    if (result.rowCount === 0) {
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

    const mesaResult = await client.query(
      `
        SELECT m.numero
        FROM mesa_sesiones ms
        JOIN mesas m
          ON m.id = ms.mesa_id
        WHERE ms.id = $1
        LIMIT 1
      `,
      [result.rows[0].mesa_sesion_id],
    );

    await publishMesaPublicRefresh(
      client,
      publishDomainEvent,
      'llamado_atendido',
      mesaResult.rows[0]?.numero,
    );

    await client.query('COMMIT');

    return {
      id: Number(result.rows[0].id),
      status: 'atendido',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function receiveKitchenOrder(pool, recordAuditEvent, publishDomainEvent, kitchenOrderId, actorNombre) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE pedidos_cocina
        SET estado = 'atendido',
            atendida_en = NOW(),
            atendida_por = $2
        WHERE id = $1
          AND estado = 'pendiente'
        RETURNING id
      `,
      [kitchenOrderId, actorNombre ?? 'mozo'],
    );

    if (result.rowCount === 0) {
      throw new DomainError(404, 'El pedido de cocina pendiente no existe');
    }

    await recordAuditEvent(client, {
      agregado: 'pedidos_cocina',
      agregadoId: kitchenOrderId,
      evento: 'pedido_cocina_atendido',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {},
    });

    await publishMobileCurrentRefresh(
      client,
      publishDomainEvent,
      'pedido_cocina_atendido',
      [
        MOBILE_CURRENT_FRAGMENT_KEYS.dashboardMetrics,
        MOBILE_CURRENT_FRAGMENT_KEYS.queuePendientePedidosCocina,
        MOBILE_CURRENT_FRAGMENT_KEYS.queueAtendidoPedidosCocina,
      ],
    );

    await client.query('COMMIT');

    return {
      id: Number(result.rows[0].id),
      status: 'atendido',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createMesaService(pool, config, recordAuditEvent, publishDomainEvent) {
  return {
    recoverPendingDisconnects: () =>
      recoverPendingDisconnects(pool, recordAuditEvent, publishDomainEvent),
    getMesaContext: (mesaNumero, requestedClientSessionId) =>
      getMesaContext(pool, recordAuditEvent, publishDomainEvent, mesaNumero, requestedClientSessionId),
    connectClient: (mesaNumero, clientSessionId) =>
      connectClient(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
    getMenu: (mesaNumero, clientSessionId) => getMenu(pool, mesaNumero, clientSessionId),
    disconnectClient: (mesaNumero, clientSessionId) =>
      disconnectClient(
        pool,
        recordAuditEvent,
        publishDomainEvent,
        config.mesaClientDisconnectGraceSeconds,
        mesaNumero,
        clientSessionId,
      ),
    getState: (mesaNumero, clientSessionId) => getState(pool, mesaNumero, clientSessionId),
    updateCartItem: (mesaNumero, clientSessionId, productoId, action) =>
      updateCartItem(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, productoId, action),
    confirmOrder: (mesaNumero, clientSessionId) =>
      confirmOrder(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
    callWaiter: (mesaNumero, clientSessionId) =>
      callWaiter(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
    openConsulta: (mesaNumero, clientSessionId, contenido) =>
      openConsulta(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, contenido),
    sendConsultaMessageFromClient: (mesaNumero, clientSessionId, contenido) =>
      sendConsultaMessageFromClient(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId, contenido),
    closeConsultaFromClient: (mesaNumero, clientSessionId) =>
      closeConsultaFromClient(pool, recordAuditEvent, publishDomainEvent, mesaNumero, clientSessionId),
    getWaiterQueues: (status) => getWaiterQueues(pool, status),
    getConsultaDetail: (consultaId) => getConsultaDetail(pool, consultaId),
    getKitchenOrderDetail: (kitchenOrderId) => getKitchenOrderDetail(pool, kitchenOrderId),
    getWaiterCallDetail: (waiterCallId) => getWaiterCallDetail(pool, waiterCallId),
    sendConsultaMessageFromWaiter: (consultaId, actorNombre, contenido) =>
      sendConsultaMessageFromWaiter(pool, recordAuditEvent, publishDomainEvent, consultaId, actorNombre, contenido),
    closeConsultaFromWaiter: (consultaId, actorNombre) =>
      closeConsultaFromWaiter(pool, recordAuditEvent, publishDomainEvent, consultaId, actorNombre),
    receiveWaiterCall: (waiterCallId, actorNombre) =>
      receiveWaiterCall(pool, recordAuditEvent, publishDomainEvent, waiterCallId, actorNombre),
    receiveKitchenOrder: (kitchenOrderId, actorNombre) =>
      receiveKitchenOrder(pool, recordAuditEvent, publishDomainEvent, kitchenOrderId, actorNombre),
  };
}
