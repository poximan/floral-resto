import { DomainError } from './domain-error.js';
import { MOBILE_CURRENT_FRAGMENT_KEYS, uniqueFragmentKeys } from './domain-event-service.js';

function toNumber(value) {
  return Number.parseInt(value, 10);
}

function normalizeText(value) {
  return value?.trim() ?? '';
}

function normalizeOptionalText(value) {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function assertPositiveInteger(value, message) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError(400, message);
  }
}

function mapCategory(row) {
  return {
    id: Number(row.id),
    titulo: row.titulo,
    orden: Number(row.orden),
    activa: row.activa,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(row) {
  return {
    id: Number(row.id),
    categoriaId: Number(row.categoria_id),
    categoriaTitulo: row.categoria_titulo,
    titulo: row.titulo,
    descripcion: row.descripcion,
    precioArsCentavos: Number(row.precio_ars_centavos),
    imagenNombreArchivo: row.imagen_nombre_archivo,
    activo: row.activo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMesa(row) {
  return {
    id: Number(row.id),
    numero: Number(row.numero),
    habilitada: row.habilitada,
    sesionActiva: row.sesion_activa,
    mesaSesionId: row.mesa_sesion_id ? Number(row.mesa_sesion_id) : null,
    pedidoConfirmado: Number(row.pedidos_confirmados_count ?? 0) > 0,
    pedidosConfirmadosCount: Number(row.pedidos_confirmados_count ?? 0),
  };
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

async function publishMesaPublicRefreshAll(client, publishDomainEvent, reason) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'mesa_public_refresh_all',
    reason,
  });
}

async function listCategories(pool) {
  const result = await pool.query(
    `
      SELECT id, titulo, orden, activa, created_at, updated_at
      FROM categorias
      ORDER BY orden ASC, titulo ASC
    `,
  );

  return result.rows.map(mapCategory);
}

async function createCategory(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre) {
  const titulo = normalizeText(payload.titulo);
  const orden = toNumber(payload.orden);

  if (!titulo) {
    throw new DomainError(400, 'El titulo de la categoria es obligatorio');
  }
  assertPositiveInteger(orden, 'El orden de la categoria debe ser un entero positivo');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        INSERT INTO categorias (
          titulo,
          orden,
          activa,
          updated_at
        )
        VALUES ($1, $2, TRUE, NOW())
        RETURNING id, titulo, orden, activa, created_at, updated_at
      `,
      [titulo, orden],
    );

    await recordAuditEvent(client, {
      agregado: 'categorias',
      agregadoId: result.rows[0].id,
      evento: 'categoria_creada',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        titulo,
        orden,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'categoria_creada');

    await client.query('COMMIT');
    return mapCategory(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateCategory(pool, recordAuditEvent, publishDomainEvent, categoryId, payload, actorNombre) {
  assertPositiveInteger(categoryId, 'La categoria es invalida');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingResult = await client.query(
    `
      SELECT id, titulo, orden, activa, created_at, updated_at
      FROM categorias
      WHERE id = $1
      LIMIT 1
    `,
    [categoryId],
    );

    const existing = existingResult.rows[0] ?? null;
    if (!existing) {
      throw new DomainError(404, 'La categoria no existe');
    }

    const titulo = normalizeText(payload.titulo ?? existing.titulo);
    const orden = payload.orden !== undefined ? toNumber(payload.orden) : Number(existing.orden);
    const activa = payload.activa !== undefined ? Boolean(payload.activa) : existing.activa;

    if (!titulo) {
      throw new DomainError(400, 'El titulo de la categoria es obligatorio');
    }
    assertPositiveInteger(orden, 'El orden de la categoria debe ser un entero positivo');

    const result = await client.query(
      `
        UPDATE categorias
        SET titulo = $2,
            orden = $3,
            activa = $4,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, titulo, orden, activa, created_at, updated_at
      `,
      [categoryId, titulo, orden, activa],
    );

    await recordAuditEvent(client, {
      agregado: 'categorias',
      agregadoId: categoryId,
      evento: 'categoria_actualizada',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        titulo,
        orden,
        activa,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'categoria_actualizada');

    await client.query('COMMIT');
    return mapCategory(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteCategory(pool, recordAuditEvent, publishDomainEvent, categoryId, actorNombre) {
  assertPositiveInteger(categoryId, 'La categoria es invalida');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const blockingProductsResult = await client.query(
    `
      SELECT id, titulo
      FROM productos
      WHERE categoria_id = $1
        AND activo = TRUE
      ORDER BY titulo ASC
    `,
    [categoryId],
    );

    if (blockingProductsResult.rows.length > 0) {
      throw new DomainError(
        409,
        `No se puede eliminar la categoria porque tiene productos activos: ${blockingProductsResult.rows.map((row) => row.titulo).join(', ')}`,
      );
    }

    const result = await client.query(
      `
        DELETE FROM categorias
        WHERE id = $1
        RETURNING id
      `,
      [categoryId],
    );

    if (result.rowCount === 0) {
      throw new DomainError(404, 'La categoria no existe');
    }

    await recordAuditEvent(client, {
      agregado: 'categorias',
      agregadoId: categoryId,
      evento: 'categoria_eliminada',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {},
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'categoria_eliminada');

    await client.query('COMMIT');
    return {
      id: categoryId,
      deleted: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listProducts(pool) {
  const result = await pool.query(
    `
      SELECT
        p.id,
        p.categoria_id,
        c.titulo AS categoria_titulo,
        p.titulo,
        p.descripcion,
        p.precio_ars_centavos,
        p.imagen_nombre_archivo,
        p.activo,
        p.created_at,
        p.updated_at
      FROM productos p
      JOIN categorias c
        ON c.id = p.categoria_id
      ORDER BY c.orden ASC, p.titulo ASC
    `,
  );

  return result.rows.map(mapProduct);
}

async function createProduct(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre) {
  const categoriaId = toNumber(payload.categoriaId);
  const titulo = normalizeText(payload.titulo);
  const descripcion = normalizeText(payload.descripcion);
  const precioArsCentavos = toNumber(payload.precioArsCentavos);
  const imagenNombreArchivo = normalizeOptionalText(payload.imagenNombreArchivo);

  assertPositiveInteger(categoriaId, 'La categoria del producto es obligatoria');
  if (!titulo) {
    throw new DomainError(400, 'El titulo del producto es obligatorio');
  }
  if (!descripcion) {
    throw new DomainError(400, 'La descripcion del producto es obligatoria');
  }
  assertPositiveInteger(precioArsCentavos, 'El precio del producto debe ser un entero positivo');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const categoryExistsResult = await client.query(
      `
        SELECT id, titulo
        FROM categorias
        WHERE id = $1
        LIMIT 1
      `,
      [categoriaId],
    );

    if (categoryExistsResult.rowCount === 0) {
      throw new DomainError(404, 'La categoria elegida no existe');
    }

    const result = await client.query(
      `
        INSERT INTO productos (
          categoria_id,
          titulo,
          descripcion,
          precio_ars_centavos,
          imagen_nombre_archivo,
          activo,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
        RETURNING id, categoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo, created_at, updated_at
      `,
      [categoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo],
    );

    const created = result.rows[0];

    await recordAuditEvent(client, {
      agregado: 'productos',
      agregadoId: created.id,
      evento: 'producto_creado',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        categoriaId,
        categoriaTitulo: categoryExistsResult.rows[0].titulo,
        titulo,
        precioArsCentavos,
        imagenNombreArchivo,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'producto_creado');

    await client.query('COMMIT');

    return mapProduct({
      ...created,
      categoria_titulo: categoryExistsResult.rows[0].titulo,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateProduct(pool, recordAuditEvent, publishDomainEvent, productId, payload, actorNombre) {
  assertPositiveInteger(productId, 'El producto es invalido');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingResult = await client.query(
    `
      SELECT id, categoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo
      FROM productos
      WHERE id = $1
      LIMIT 1
    `,
    [productId],
    );

    const existing = existingResult.rows[0] ?? null;
    if (!existing) {
      throw new DomainError(404, 'El producto no existe');
    }

  const categoriaId = payload.categoriaId !== undefined ? toNumber(payload.categoriaId) : Number(existing.categoria_id);
  const titulo = normalizeText(payload.titulo ?? existing.titulo);
  const descripcion = normalizeText(payload.descripcion ?? existing.descripcion);
  const precioArsCentavos = payload.precioArsCentavos !== undefined
    ? toNumber(payload.precioArsCentavos)
    : Number(existing.precio_ars_centavos);
  const imagenNombreArchivo = payload.imagenNombreArchivo !== undefined
    ? normalizeOptionalText(payload.imagenNombreArchivo)
    : existing.imagen_nombre_archivo;
  const activo = payload.activo !== undefined ? Boolean(payload.activo) : existing.activo;

  assertPositiveInteger(categoriaId, 'La categoria del producto es obligatoria');
  if (!titulo) {
    throw new DomainError(400, 'El titulo del producto es obligatorio');
  }
  if (!descripcion) {
    throw new DomainError(400, 'La descripcion del producto es obligatoria');
  }
  assertPositiveInteger(precioArsCentavos, 'El precio del producto debe ser un entero positivo');

    const categoryExistsResult = await client.query(
    `
      SELECT titulo
      FROM categorias
      WHERE id = $1
      LIMIT 1
    `,
    [categoriaId],
    );

    if (categoryExistsResult.rowCount === 0) {
      throw new DomainError(404, 'La categoria elegida no existe');
    }

    const result = await client.query(
      `
        UPDATE productos
        SET categoria_id = $2,
            titulo = $3,
            descripcion = $4,
            precio_ars_centavos = $5,
            imagen_nombre_archivo = $6,
            activo = $7,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, categoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo, created_at, updated_at
      `,
      [productId, categoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo, activo],
    );

    await recordAuditEvent(client, {
      agregado: 'productos',
      agregadoId: productId,
      evento: activo ? 'producto_actualizado' : 'producto_desactivado',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        categoriaId,
        categoriaTitulo: categoryExistsResult.rows[0].titulo,
        titulo,
        precioArsCentavos,
        imagenNombreArchivo,
        activo,
      },
    });

    await publishMesaPublicRefreshAll(
      client,
      publishDomainEvent,
      activo ? 'producto_actualizado' : 'producto_desactivado',
    );

    await client.query('COMMIT');

    return mapProduct({
      ...result.rows[0],
      categoria_titulo: categoryExistsResult.rows[0].titulo,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function disableProduct(pool, recordAuditEvent, publishDomainEvent, productId, actorNombre) {
  assertPositiveInteger(productId, 'El producto es invalido');
  return updateProduct(pool, recordAuditEvent, publishDomainEvent, productId, { activo: false }, actorNombre);
}

async function listMesas(pool) {
  const result = await pool.query(
    `
      SELECT
        m.id,
        m.numero,
        m.habilitada,
        ms.id AS mesa_sesion_id,
        COALESCE(ps.pedidos_confirmados_count, 0) AS pedidos_confirmados_count,
        (ms.id IS NOT NULL) AS sesion_activa
      FROM mesas m
      LEFT JOIN mesa_sesiones ms
        ON ms.mesa_id = m.id
       AND ms.estado = 'abierta'
      LEFT JOIN (
        SELECT mesa_sesion_id, COUNT(*) AS pedidos_confirmados_count
        FROM pedido_sesiones
        GROUP BY mesa_sesion_id
      ) ps
        ON ps.mesa_sesion_id = ms.id
      ORDER BY m.numero ASC
    `,
  );

  return result.rows.map(mapMesa);
}

async function createMesa(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre) {
  const numero = toNumber(payload.numero);
  assertPositiveInteger(numero, 'El numero de mesa debe ser un entero positivo');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        INSERT INTO mesas (
          numero,
          habilitada,
          updated_at
        )
        VALUES ($1, TRUE, NOW())
        RETURNING id, numero, habilitada
      `,
      [numero],
    );

    await recordAuditEvent(client, {
      agregado: 'mesas',
      agregadoId: result.rows[0].id,
      evento: 'mesa_creada',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        numero,
        habilitada: true,
      },
    });

    await client.query('COMMIT');

    return {
      id: Number(result.rows[0].id),
      numero: Number(result.rows[0].numero),
      habilitada: result.rows[0].habilitada,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateMesa(pool, recordAuditEvent, publishDomainEvent, mesaId, payload, actorNombre) {
  assertPositiveInteger(mesaId, 'La mesa es invalida');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingResult = await client.query(
    `
      SELECT id, numero, habilitada
      FROM mesas
      WHERE id = $1
      LIMIT 1
    `,
    [mesaId],
    );

    const existing = existingResult.rows[0] ?? null;
    if (!existing) {
      throw new DomainError(404, 'La mesa no existe');
    }

  const numero = payload.numero !== undefined ? toNumber(payload.numero) : Number(existing.numero);
  const habilitada = payload.habilitada !== undefined ? Boolean(payload.habilitada) : existing.habilitada;
  assertPositiveInteger(numero, 'El numero de mesa debe ser un entero positivo');

  if (habilitada === false) {
      const activeSessionResult = await client.query(
      `
        SELECT id
        FROM mesa_sesiones
        WHERE mesa_id = $1
          AND estado = 'abierta'
        LIMIT 1
      `,
      [mesaId],
      );

      if (activeSessionResult.rowCount > 0) {
        throw new DomainError(409, 'No se puede deshabilitar una mesa con sesion activa');
      }
    }

    const result = await client.query(
      `
        UPDATE mesas
        SET numero = $2,
            habilitada = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, numero, habilitada
      `,
      [mesaId, numero, habilitada],
    );

    await recordAuditEvent(client, {
      agregado: 'mesas',
      agregadoId: mesaId,
      evento: 'mesa_actualizada',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        numero,
        habilitada,
      },
    });

    await client.query('COMMIT');

    return {
      id: Number(result.rows[0].id),
      numero: Number(result.rows[0].numero),
      habilitada: result.rows[0].habilitada,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closeMesa(pool, recordAuditEvent, publishDomainEvent, mesaNumero, actorNombre) {
  assertPositiveInteger(mesaNumero, 'La mesa es invalida');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const mesaResult = await client.query(
      `
        SELECT id, numero
        FROM mesas
        WHERE numero = $1
        LIMIT 1
      `,
      [mesaNumero],
    );

    const mesa = mesaResult.rows[0] ?? null;
    if (!mesa) {
      throw new DomainError(404, 'La mesa no existe');
    }

    const sessionResult = await client.query(
      `
        SELECT
          ms.id,
          COALESCE(ps.pedidos_confirmados_count, 0) AS pedidos_confirmados_count
        FROM mesa_sesiones ms
        LEFT JOIN (
          SELECT mesa_sesion_id, COUNT(*) AS pedidos_confirmados_count
          FROM pedido_sesiones
          GROUP BY mesa_sesion_id
        ) ps
          ON ps.mesa_sesion_id = ms.id
        WHERE mesa_id = $1
          AND estado = 'abierta'
        LIMIT 1
      `,
      [mesa.id],
    );

    const mesaSesion = sessionResult.rows[0] ?? null;
    if (!mesaSesion) {
      throw new DomainError(409, 'La mesa no tiene una sesion activa para cerrar');
    }

    await client.query(
      `
        UPDATE mesa_sesiones
        SET estado = 'cerrada',
            cerrada_en = NOW()
        WHERE id = $1
      `,
      [mesaSesion.id],
    );

    await client.query(
      `
        UPDATE mesa_clientes
        SET conectada = FALSE,
            desconectada_en = NOW(),
            ultimo_seen_en = NOW()
        WHERE mesa_sesion_id = $1
      `,
      [mesaSesion.id],
    );

    await client.query(
      `
        UPDATE consultas_master
        SET estado = 'atendido',
            cerrada_en = NOW(),
            cerrada_por = $2
        WHERE mesa_sesion_id = $1
          AND estado = 'pendiente'
      `,
      [mesaSesion.id, `mozo:${actorNombre ?? 'mozo'}`],
    );

    await client.query(
      `
        UPDATE llamados_mozo
        SET estado = 'atendido',
            atendida_en = NOW(),
            atendida_por = $2
        WHERE mesa_sesion_id = $1
          AND estado = 'pendiente'
      `,
      [mesaSesion.id, actorNombre ?? 'mozo'],
    );

    await client.query(
      `
        UPDATE pedidos_cocina pk
        SET estado = 'atendido',
            atendida_en = NOW(),
            atendida_por = $2
        FROM pedido_sesiones ps
        WHERE ps.id = pk.pedido_sesion_id
          AND ps.mesa_sesion_id = $1
          AND pk.estado = 'pendiente'
      `,
      [mesaSesion.id, actorNombre ?? 'mozo'],
    );

    await client.query(
      `
        UPDATE pedido_sesiones
        SET cobrado_en = NOW()
        WHERE mesa_sesion_id = $1
          AND confirmado_en IS NOT NULL
          AND cobrado_en IS NULL
      `,
      [mesaSesion.id],
    );

    await client.query(
      `
        DELETE FROM mesa_carrito_items
        WHERE mesa_sesion_id = $1
      `,
      [mesaSesion.id],
    );

    await recordAuditEvent(client, {
      agregado: 'mesa_sesiones',
      agregadoId: mesaSesion.id,
      evento: 'mesa_cerrada',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        mesaNumero,
        pedidoConfirmado: Number(mesaSesion.pedidos_confirmados_count) > 0,
        pedidosConfirmadosCount: Number(mesaSesion.pedidos_confirmados_count),
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

    await publishMesaPublicRefresh(client, publishDomainEvent, 'mesa_cerrada', mesaNumero);

    await client.query('COMMIT');

    return {
      mesaNumero,
      mesaSesionId: Number(mesaSesion.id),
      pedidoConfirmado: Number(mesaSesion.pedidos_confirmados_count) > 0,
      pedidosConfirmadosCount: Number(mesaSesion.pedidos_confirmados_count),
      cerrada: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function mapDashboardPayload(row, config, range) {
  return {
    jornadaInicioUtc: range.fromUtc,
    jornadaFinUtc: range.toUtc,
    businessTimezone: config.businessTimezone,
    jornadaStartTime: config.jornadaStartTime,
    dineroTotalJornadaArsCentavos: Number(row.dinero_total_jornada),
    colas: row.colas.map((metric) => ({
      cola: metric.cola,
      pendientes: Number(metric.pendientes),
      atendidos: Number(metric.atendidos),
      tiempoMedioSegundos: Number(metric.tiempo_medio_segundos),
      tiempoMinimoSegundos: Number(metric.tiempo_minimo_segundos),
      tiempoMaximoSegundos: Number(metric.tiempo_maximo_segundos),
    })),
    dineroPorMesa: row.dinero_por_mesa.map((item) => ({
      mesaNumero: Number(item.mesa_numero),
      totalArsCentavos: Number(item.total_ars_centavos),
    })),
  };
}

async function getCurrentJornadaRange(pool, config) {
  const result = await pool.query(
    `
      WITH ahora_local AS (
        SELECT NOW() AT TIME ZONE $1 AS ahora
      ),
      jornada AS (
        SELECT
          CASE
            WHEN ahora::time >= $2::time THEN DATE_TRUNC('day', ahora) + $2::time
            ELSE DATE_TRUNC('day', ahora) - INTERVAL '1 day' + $2::time
          END AS inicio_local
        FROM ahora_local
      )
      SELECT
        inicio_local AT TIME ZONE $1 AS inicio_utc,
        (inicio_local + INTERVAL '24 hour') AT TIME ZONE $1 AS fin_utc
      FROM jornada
    `,
    [config.businessTimezone, config.jornadaStartTime],
  );

  return {
    fromUtc: result.rows[0].inicio_utc,
    toUtc: result.rows[0].fin_utc,
  };
}

function normalizeRangePayload(payload) {
  const fromDate = new Date(payload.fromUtc ?? '');
  const toDate = new Date(payload.toUtc ?? '');

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new DomainError(400, 'El rango historico es invalido');
  }

  if (fromDate >= toDate) {
    throw new DomainError(400, 'El rango historico debe tener un inicio menor al fin');
  }

  return {
    fromUtc: fromDate.toISOString(),
    toUtc: toDate.toISOString(),
  };
}

async function getDashboardForRange(pool, config, range) {
  const result = await pool.query(
    `
      WITH
      rango AS (
        SELECT
          $1::timestamptz AS inicio_utc,
          $2::timestamptz AS fin_utc
      ),
      metricas_eventos AS (
        SELECT
          'consultas' AS cola,
          COUNT(*) FILTER (WHERE c.estado = 'pendiente') AS pendientes,
          COUNT(*) FILTER (WHERE c.estado = 'atendido') AS atendidos,
          COALESCE(
            AVG(EXTRACT(EPOCH FROM (COALESCE(c.cerrada_en, NOW()) - c.creada_en))),
            0
          ) AS tiempo_medio_segundos,
          COALESCE(
            MIN(EXTRACT(EPOCH FROM (COALESCE(c.cerrada_en, NOW()) - c.creada_en))),
            0
          ) AS tiempo_minimo_segundos,
          COALESCE(
            MAX(EXTRACT(EPOCH FROM (COALESCE(c.cerrada_en, NOW()) - c.creada_en))),
            0
          ) AS tiempo_maximo_segundos
        FROM consultas_master c
        CROSS JOIN rango r
        WHERE c.creada_en >= r.inicio_utc
          AND c.creada_en < r.fin_utc
        UNION ALL
        SELECT
          'pedidos_cocina' AS cola,
          COUNT(*) FILTER (WHERE pk.estado = 'pendiente') AS pendientes,
          COUNT(*) FILTER (WHERE pk.estado = 'atendido') AS atendidos,
          COALESCE(
            AVG(EXTRACT(EPOCH FROM (COALESCE(pk.atendida_en, NOW()) - pk.creada_en))),
            0
          ) AS tiempo_medio_segundos,
          COALESCE(
            MIN(EXTRACT(EPOCH FROM (COALESCE(pk.atendida_en, NOW()) - pk.creada_en))),
            0
          ) AS tiempo_minimo_segundos,
          COALESCE(
            MAX(EXTRACT(EPOCH FROM (COALESCE(pk.atendida_en, NOW()) - pk.creada_en))),
            0
          ) AS tiempo_maximo_segundos
        FROM pedidos_cocina pk
        CROSS JOIN rango r
        WHERE pk.creada_en >= r.inicio_utc
          AND pk.creada_en < r.fin_utc
        UNION ALL
        SELECT
          'llamados_mozo' AS cola,
          COUNT(*) FILTER (WHERE lm.estado = 'pendiente') AS pendientes,
          COUNT(*) FILTER (WHERE lm.estado = 'atendido') AS atendidos,
          COALESCE(
            AVG(EXTRACT(EPOCH FROM (COALESCE(lm.atendida_en, NOW()) - lm.creada_en))),
            0
          ) AS tiempo_medio_segundos,
          COALESCE(
            MIN(EXTRACT(EPOCH FROM (COALESCE(lm.atendida_en, NOW()) - lm.creada_en))),
            0
          ) AS tiempo_minimo_segundos,
          COALESCE(
            MAX(EXTRACT(EPOCH FROM (COALESCE(lm.atendida_en, NOW()) - lm.creada_en))),
            0
          ) AS tiempo_maximo_segundos
        FROM llamados_mozo lm
        CROSS JOIN rango r
        WHERE lm.creada_en >= r.inicio_utc
          AND lm.creada_en < r.fin_utc
      ),
      dinero_jornada AS (
        SELECT COALESCE(SUM(ps.total_ars_centavos), 0) AS total
        FROM pedido_sesiones ps
        CROSS JOIN rango r
        WHERE ps.cobrado_en >= r.inicio_utc
          AND ps.cobrado_en < r.fin_utc
      ),
      dinero_por_mesa AS (
        SELECT
          m.numero AS mesa_numero,
          COALESCE(SUM(ps.total_ars_centavos), 0) AS total_ars_centavos
        FROM pedido_sesiones ps
        JOIN mesa_sesiones ms
          ON ms.id = ps.mesa_sesion_id
        JOIN mesas m
          ON m.id = ms.mesa_id
        CROSS JOIN rango r
        WHERE ps.cobrado_en >= r.inicio_utc
          AND ps.cobrado_en < r.fin_utc
        GROUP BY m.numero
        ORDER BY m.numero ASC
      )
      SELECT
        (SELECT inicio_utc FROM rango) AS jornada_inicio_utc,
        (SELECT fin_utc FROM rango) AS jornada_fin_utc,
        (SELECT total FROM dinero_jornada) AS dinero_total_jornada,
        COALESCE(
          (SELECT JSON_AGG(metricas_eventos ORDER BY cola ASC) FROM metricas_eventos),
          '[]'::json
        ) AS colas,
        COALESCE(
          (SELECT JSON_AGG(dinero_por_mesa ORDER BY mesa_numero ASC) FROM dinero_por_mesa),
          '[]'::json
        ) AS dinero_por_mesa
    `,
    [range.fromUtc, range.toUtc],
  );

  return mapDashboardPayload(result.rows[0], config, range);
}

async function getDashboard(pool, config) {
  const range = await getCurrentJornadaRange(pool, config);
  return getDashboardForRange(pool, config, range);
}

function groupQueuesByStatus(queues) {
  return {
    pendientes: {
      consultas: queues.consultas.filter((item) => item.estado === 'pendiente'),
      pedidosCocina: queues.pedidosCocina.filter((item) => item.estado === 'pendiente'),
      llamadosMozo: queues.llamadosMozo.filter((item) => item.estado === 'pendiente'),
    },
    atendidos: {
      consultas: queues.consultas.filter((item) => item.estado === 'atendido'),
      pedidosCocina: queues.pedidosCocina.filter((item) => item.estado === 'atendido'),
      llamadosMozo: queues.llamadosMozo.filter((item) => item.estado === 'atendido'),
    },
  };
}

function normalizeMobileQueueStatus(status) {
  if (status === 'pendiente' || status === 'pendientes') {
    return 'pendiente';
  }

  if (status === 'atendido' || status === 'atendidos') {
    return 'atendido';
  }

  throw new DomainError(400, 'El estado solicitado es invalido');
}

function normalizeMobileQueueType(queueType) {
  if (queueType === 'consultas') {
    return 'consultas';
  }

  if (queueType === 'pedidosCocina' || queueType === 'pedidos-cocina') {
    return 'pedidosCocina';
  }

  if (queueType === 'llamadosMozo' || queueType === 'llamados-mozo') {
    return 'llamadosMozo';
  }

  throw new DomainError(400, 'La cola solicitada es invalida');
}

function buildDashboardMetricsFragment(dashboard, generatedAt, scope = 'current', requestId = null) {
  return {
    type: `${scope}_dashboard_metrics`,
    generatedAt,
    scope,
    requestId,
    fromUtc: dashboard.jornadaInicioUtc,
    toUtc: dashboard.jornadaFinUtc,
    metrics: dashboard.colas,
  };
}

function buildDashboardRevenueFragment(dashboard, generatedAt, scope = 'current', requestId = null) {
  return {
    type: `${scope}_dashboard_revenue`,
    generatedAt,
    scope,
    requestId,
    fromUtc: dashboard.jornadaInicioUtc,
    toUtc: dashboard.jornadaFinUtc,
    totalArsCentavos: dashboard.dineroTotalJornadaArsCentavos,
    items: dashboard.dineroPorMesa,
  };
}

function buildCurrentQueueFragment(range, realtimeQueues, status, queueType) {
  return {
    type: 'current_queue_fragment',
    generatedAt: new Date().toISOString(),
    scope: 'current',
    fromUtc: range.fromUtc,
    toUtc: range.toUtc,
    queueType,
    status,
    items: realtimeQueues[queueType].filter((item) => item.estado === status),
  };
}

async function getRealtimeMobileQueues(pool, range) {
  const consultasResult = await pool.query(
    `
      SELECT
        c.id,
        c.estado,
        c.creada_en,
        c.cerrada_en,
        c.cerrada_por,
        ms.id AS mesa_sesion_id,
        m.numero AS mesa_numero,
        (
          SELECT contenido
          FROM consultas_detail cm
          WHERE cm.consulta_id = c.id
          ORDER BY cm.creada_en ASC, cm.id ASC
          LIMIT 1
        ) AS resumen,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', cm.id,
                'autorTipo', cm.autor_tipo,
                'autorReferencia', cm.autor_referencia,
                'contenido', cm.contenido,
                'creadaEn', cm.creada_en
              )
              ORDER BY cm.creada_en ASC, cm.id ASC
            )
            FROM consultas_detail cm
            WHERE cm.consulta_id = c.id
          ),
          '[]'::json
        ) AS detalle_mensajes
      FROM consultas_master c
      JOIN mesa_sesiones ms
        ON ms.id = c.mesa_sesion_id
      JOIN mesas m
        ON m.id = ms.mesa_id
      WHERE c.estado = 'pendiente'
         OR (c.estado = 'atendido' AND c.creada_en >= $1 AND c.creada_en < $2)
      ORDER BY c.creada_en ASC
    `,
    [range.fromUtc, range.toUtc],
  );

  const pedidosCocinaResult = await pool.query(
    `
      SELECT
        pk.id,
        pk.estado,
        pk.creada_en,
        pk.atendida_en,
        pk.atendida_por,
        ms.id AS mesa_sesion_id,
        m.numero AS mesa_numero,
        ps.total_ars_centavos
        ,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'titulo', pi.titulo_snapshot,
                'descripcion', pi.descripcion_snapshot,
                'precioArsCentavos', pi.precio_ars_centavos_snapshot,
                'cantidad', pi.cantidad,
                'clienteSesionId', pi.cliente_sesion_id
              )
              ORDER BY pi.titulo_snapshot ASC, pi.cliente_sesion_id ASC
            )
            FROM pedido_items pi
            WHERE pi.pedido_sesion_id = ps.id
          ),
          '[]'::json
        ) AS detalle_items
      FROM pedidos_cocina pk
      JOIN pedido_sesiones ps
        ON ps.id = pk.pedido_sesion_id
      JOIN mesa_sesiones ms
        ON ms.id = ps.mesa_sesion_id
      JOIN mesas m
        ON m.id = ms.mesa_id
      WHERE pk.estado = 'pendiente'
         OR (pk.estado = 'atendido' AND pk.creada_en >= $1 AND pk.creada_en < $2)
      ORDER BY pk.creada_en ASC
    `,
    [range.fromUtc, range.toUtc],
  );

  const llamadosMozoResult = await pool.query(
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
      WHERE lm.estado = 'pendiente'
         OR (lm.estado = 'atendido' AND lm.creada_en >= $1 AND lm.creada_en < $2)
      ORDER BY lm.creada_en ASC
    `,
    [range.fromUtc, range.toUtc],
  );

  return {
    consultas: consultasResult.rows.map((row) => ({
      id: Number(row.id),
      estado: row.estado,
      mesaNumero: Number(row.mesa_numero),
      mesaSesionId: Number(row.mesa_sesion_id),
      creadaEn: row.creada_en,
      cerradaEn: row.cerrada_en,
      cerradaPor: row.cerrada_por,
      resumen: row.resumen,
      detalle: {
        mensajes: row.detalle_mensajes ?? [],
      },
    })),
    pedidosCocina: pedidosCocinaResult.rows.map((row) => ({
      id: Number(row.id),
      estado: row.estado,
      mesaNumero: Number(row.mesa_numero),
      mesaSesionId: Number(row.mesa_sesion_id),
      creadaEn: row.creada_en,
      atendidaEn: row.atendida_en,
      atendidaPor: row.atendida_por,
      totalArsCentavos: Number(row.total_ars_centavos),
      detalle: {
        items: row.detalle_items ?? [],
      },
    })),
    llamadosMozo: llamadosMozoResult.rows.map((row) => ({
      id: Number(row.id),
      estado: row.estado,
      mesaNumero: Number(row.mesa_numero),
      mesaSesionId: Number(row.mesa_sesion_id),
      creadaEn: row.creada_en,
      atendidaEn: row.atendida_en,
      atendidaPor: row.atendida_por,
      detalle: {},
    })),
  };
}

async function getHistoryQueues(pool, range) {
  const consultasResult = await pool.query(
    `
      SELECT
        c.id,
        c.estado,
        c.creada_en,
        c.cerrada_en,
        c.cerrada_por,
        ms.id AS mesa_sesion_id,
        m.numero AS mesa_numero,
        (
          SELECT contenido
          FROM consultas_detail cm
          WHERE cm.consulta_id = c.id
          ORDER BY cm.creada_en ASC, cm.id ASC
          LIMIT 1
        ) AS resumen,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', cm.id,
                'autorTipo', cm.autor_tipo,
                'autorReferencia', cm.autor_referencia,
                'contenido', cm.contenido,
                'creadaEn', cm.creada_en
              )
              ORDER BY cm.creada_en ASC, cm.id ASC
            )
            FROM consultas_detail cm
            WHERE cm.consulta_id = c.id
          ),
          '[]'::json
        ) AS detalle_mensajes
      FROM consultas_master c
      JOIN mesa_sesiones ms
        ON ms.id = c.mesa_sesion_id
      JOIN mesas m
        ON m.id = ms.mesa_id
      WHERE c.creada_en >= $1
        AND c.creada_en < $2
      ORDER BY c.creada_en ASC
    `,
    [range.fromUtc, range.toUtc],
  );

  const pedidosCocinaResult = await pool.query(
    `
      SELECT
        pk.id,
        pk.estado,
        pk.creada_en,
        pk.atendida_en,
        pk.atendida_por,
        ms.id AS mesa_sesion_id,
        m.numero AS mesa_numero,
        ps.total_ars_centavos
        ,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'titulo', pi.titulo_snapshot,
                'descripcion', pi.descripcion_snapshot,
                'precioArsCentavos', pi.precio_ars_centavos_snapshot,
                'cantidad', pi.cantidad,
                'clienteSesionId', pi.cliente_sesion_id
              )
              ORDER BY pi.titulo_snapshot ASC, pi.cliente_sesion_id ASC
            )
            FROM pedido_items pi
            WHERE pi.pedido_sesion_id = ps.id
          ),
          '[]'::json
        ) AS detalle_items
      FROM pedidos_cocina pk
      JOIN pedido_sesiones ps
        ON ps.id = pk.pedido_sesion_id
      JOIN mesa_sesiones ms
        ON ms.id = ps.mesa_sesion_id
      JOIN mesas m
        ON m.id = ms.mesa_id
      WHERE pk.creada_en >= $1
        AND pk.creada_en < $2
      ORDER BY pk.creada_en ASC
    `,
    [range.fromUtc, range.toUtc],
  );

  const llamadosMozoResult = await pool.query(
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
      WHERE lm.creada_en >= $1
        AND lm.creada_en < $2
      ORDER BY lm.creada_en ASC
    `,
    [range.fromUtc, range.toUtc],
  );

  return {
    consultas: consultasResult.rows.map((row) => ({
      id: Number(row.id),
      estado: row.estado,
      mesaNumero: Number(row.mesa_numero),
      mesaSesionId: Number(row.mesa_sesion_id),
      creadaEn: row.creada_en,
      cerradaEn: row.cerrada_en,
      cerradaPor: row.cerrada_por,
      resumen: row.resumen,
      detalle: {
        mensajes: row.detalle_mensajes ?? [],
      },
    })),
    pedidosCocina: pedidosCocinaResult.rows.map((row) => ({
      id: Number(row.id),
      estado: row.estado,
      mesaNumero: Number(row.mesa_numero),
      mesaSesionId: Number(row.mesa_sesion_id),
      creadaEn: row.creada_en,
      atendidaEn: row.atendida_en,
      atendidaPor: row.atendida_por,
      totalArsCentavos: Number(row.total_ars_centavos),
      detalle: {
        items: row.detalle_items ?? [],
      },
    })),
    llamadosMozo: llamadosMozoResult.rows.map((row) => ({
      id: Number(row.id),
      estado: row.estado,
      mesaNumero: Number(row.mesa_numero),
      mesaSesionId: Number(row.mesa_sesion_id),
      creadaEn: row.creada_en,
      atendidaEn: row.atendida_en,
      atendidaPor: row.atendida_por,
      detalle: {},
    })),
  };
}

async function getMobileSnapshot(pool, config) {
  const range = await getCurrentJornadaRange(pool, config);
  const [dashboard, realtimeQueues] = await Promise.all([
    getDashboardForRange(pool, config, range),
    getRealtimeMobileQueues(pool, range),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    scope: 'current',
    dashboard,
    colas: groupQueuesByStatus(realtimeQueues),
  };
}

async function getMobileCurrentDashboardMetrics(pool, config) {
  const range = await getCurrentJornadaRange(pool, config);
  const dashboard = await getDashboardForRange(pool, config, range);
  return buildDashboardMetricsFragment(dashboard, new Date().toISOString());
}

async function getMobileCurrentDashboardRevenue(pool, config) {
  const range = await getCurrentJornadaRange(pool, config);
  const dashboard = await getDashboardForRange(pool, config, range);
  return buildDashboardRevenueFragment(dashboard, new Date().toISOString());
}

async function getMobileCurrentQueueFragment(pool, config, status, queueType) {
  const normalizedStatus = normalizeMobileQueueStatus(status);
  const normalizedQueueType = normalizeMobileQueueType(queueType);
  const range = await getCurrentJornadaRange(pool, config);
  const realtimeQueues = await getRealtimeMobileQueues(pool, range);
  return buildCurrentQueueFragment(range, realtimeQueues, normalizedStatus, normalizedQueueType);
}

async function getHistoryDataset(pool, config, payload) {
  const range = normalizeRangePayload(payload);
  const [dashboard, historyQueues] = await Promise.all([
    getDashboardForRange(pool, config, range),
    getHistoryQueues(pool, range),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    scope: 'history',
    requestedRange: range,
    dashboard,
    colas: historyQueues,
  };
}

async function getVisualConfig(pool) {
  const result = await pool.query(
    `
      SELECT valor_texto
      FROM configuraciones_operativas
      WHERE clave = 'visual_usd_exchange_rate'
      LIMIT 1
    `,
  );

  return {
    visualUsdExchangeRate: Number.parseFloat(result.rows[0]?.valor_texto ?? '0'),
  };
}

async function updateVisualConfig(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre) {
  const visualUsdExchangeRate = Number.parseFloat(payload.visualUsdExchangeRate);

  if (!Number.isFinite(visualUsdExchangeRate) || visualUsdExchangeRate <= 0) {
    throw new DomainError(400, 'La cotizacion visual USD debe ser un numero positivo');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        INSERT INTO configuraciones_operativas (clave, valor_texto, updated_at)
        VALUES ('visual_usd_exchange_rate', $1, NOW())
        ON CONFLICT (clave)
        DO UPDATE SET
          valor_texto = EXCLUDED.valor_texto,
          updated_at = NOW()
      `,
      [String(visualUsdExchangeRate)],
    );

    await recordAuditEvent(client, {
      agregado: 'configuraciones_operativas',
      agregadoId: 'visual_usd_exchange_rate',
      evento: 'cotizacion_visual_actualizada',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        visualUsdExchangeRate,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'cotizacion_visual_actualizada');

    await client.query('COMMIT');

    return {
      visualUsdExchangeRate,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createAdminService(pool, config, recordAuditEvent, publishDomainEvent) {
  return {
    listCategories: () => listCategories(pool),
    createCategory: (payload, actorNombre) => createCategory(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre),
    updateCategory: (categoryId, payload, actorNombre) => updateCategory(pool, recordAuditEvent, publishDomainEvent, categoryId, payload, actorNombre),
    deleteCategory: (categoryId, actorNombre) => deleteCategory(pool, recordAuditEvent, publishDomainEvent, categoryId, actorNombre),
    listProducts: () => listProducts(pool),
    createProduct: (payload, actorNombre) => createProduct(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre),
    updateProduct: (productId, payload, actorNombre) => updateProduct(pool, recordAuditEvent, publishDomainEvent, productId, payload, actorNombre),
    disableProduct: (productId, actorNombre) => disableProduct(pool, recordAuditEvent, publishDomainEvent, productId, actorNombre),
    listMesas: () => listMesas(pool),
    createMesa: (payload, actorNombre) => createMesa(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre),
    updateMesa: (mesaId, payload, actorNombre) => updateMesa(pool, recordAuditEvent, publishDomainEvent, mesaId, payload, actorNombre),
    closeMesa: (mesaNumero, actorNombre) => closeMesa(pool, recordAuditEvent, publishDomainEvent, mesaNumero, actorNombre),
    getDashboard: () => getDashboard(pool, config),
    getMobileSnapshot: () => getMobileSnapshot(pool, config),
    getMobileCurrentDashboardMetrics: () => getMobileCurrentDashboardMetrics(pool, config),
    getMobileCurrentDashboardRevenue: () => getMobileCurrentDashboardRevenue(pool, config),
    getMobileCurrentQueueFragment: (status, queueType) => getMobileCurrentQueueFragment(pool, config, status, queueType),
    getHistoryDataset: (payload) => getHistoryDataset(pool, config, payload),
    getVisualConfig: () => getVisualConfig(pool),
    updateVisualConfig: (payload, actorNombre) => updateVisualConfig(pool, recordAuditEvent, publishDomainEvent, payload, actorNombre),
  };
}
