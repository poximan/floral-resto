function createCrudDao(client, tableName, selectableColumns = '*') {
  return {
    async getById(id) {
      const result = await client.query(
        `
          SELECT ${selectableColumns}
          FROM ${tableName}
          WHERE id = $1
          LIMIT 1
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async listAll(orderBy = 'id ASC') {
      const result = await client.query(
        `
          SELECT ${selectableColumns}
          FROM ${tableName}
          ORDER BY ${orderBy}
        `,
      );

      return result.rows;
    },

    async deleteById(id) {
      const result = await client.query(
        `
          DELETE FROM ${tableName}
          WHERE id = $1
          RETURNING id
        `,
        [id],
      );

      return result;
    },
  };
}

function mapMesaSessionRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    lider_cliente_sesion_id: row.lider_cliente_sesion_id ?? null,
  };
}

export function bindMesasDao(client) {
  return {
    ...createCrudDao(client, 'mesas', 'id, nombre, created_at, updated_at'),

    async listWithActiveSessionSummary() {
      const result = await client.query(
        `
          SELECT
            m.id,
            m.nombre,
            ms.id AS mesa_sesion_id,
            COALESCE(cs.comandas_confirmadas_count, 0) AS comandas_confirmadas_count,
            (ms.id IS NOT NULL) AS sesion_activa
          FROM mesas m
          LEFT JOIN mesa_sesiones ms
            ON ms.mesa_id = m.id
           AND ms.estado = 'abierta'
          LEFT JOIN (
            SELECT mesa_sesion_id, COUNT(*) AS comandas_confirmadas_count
            FROM comanda_sesiones
            WHERE estado = 'confirmada'
            GROUP BY mesa_sesion_id
          ) cs
            ON cs.mesa_sesion_id = ms.id
          ORDER BY m.nombre ASC
        `,
      );

      return result.rows;
    },

    async create(nombre) {
      const result = await client.query(
        `
          INSERT INTO mesas (
            nombre,
            updated_at
          )
          VALUES ($1, NOW())
          RETURNING id, nombre
        `,
        [nombre],
      );

      return result.rows[0] ?? null;
    },

    async getByNombre(nombre, { forUpdate = false } = {}) {
      const result = await client.query(
        `
          SELECT id, nombre
          FROM mesas
          WHERE nombre = $1
          LIMIT 1${forUpdate ? '\n          FOR UPDATE' : ''}
        `,
        [nombre],
      );

      return result.rows[0] ?? null;
    },
  };
}

export function bindCategoriasDao(client) {
  return {
    ...createCrudDao(client, 'categorias', 'id, titulo, orden, activa, created_at, updated_at'),

    async listForAdmin() {
      const result = await client.query(
        `
          SELECT id, titulo, orden, activa, created_at, updated_at
          FROM categorias
          ORDER BY orden ASC, titulo ASC
        `,
      );

      return result.rows;
    },

    async create(titulo, orden) {
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

      return result.rows[0] ?? null;
    },

    async getByIdForUpdate(id) {
      const result = await client.query(
        `
          SELECT id, titulo, orden, activa, created_at, updated_at
          FROM categorias
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async getSummaryById(id) {
      const result = await client.query(
        `
          SELECT id, titulo
          FROM categorias
          WHERE id = $1
          LIMIT 1
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async update(id, titulo, orden, activa) {
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
        [id, titulo, orden, activa],
      );

      return result.rows[0] ?? null;
    },
  };
}

export function bindSubcategoriasDao(client) {
  return {
    ...createCrudDao(client, 'subcategorias', 'id, categoria_id, titulo, orden, activa, created_at, updated_at'),

    async listForAdmin() {
      const result = await client.query(
        `
          SELECT
            sc.id,
            sc.categoria_id,
            c.titulo AS categoria_titulo,
            sc.titulo,
            sc.orden,
            sc.activa,
            sc.created_at,
            sc.updated_at
          FROM subcategorias sc
          JOIN categorias c
            ON c.id = sc.categoria_id
          ORDER BY c.orden ASC, sc.orden ASC, sc.titulo ASC
        `,
      );

      return result.rows;
    },

    async getSummaryById(id) {
      const result = await client.query(
        `
          SELECT
            sc.id,
            sc.titulo,
            sc.categoria_id,
            c.titulo AS categoria_titulo
          FROM subcategorias sc
          JOIN categorias c
            ON c.id = sc.categoria_id
          WHERE sc.id = $1
          LIMIT 1
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },
  };
}

export function bindProductosDao(client) {
  return {
    ...createCrudDao(
      client,
      'productos',
      'id, subcategoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo, created_at, updated_at',
    ),

    async listForAdmin() {
      const result = await client.query(
        `
          SELECT
            p.id,
            p.subcategoria_id,
            sc.titulo AS subcategoria_titulo,
            sc.categoria_id,
            c.titulo AS categoria_titulo,
            p.titulo,
            p.descripcion,
            p.precio_ars_centavos,
            p.imagen_nombre_archivo,
            p.activo,
            p.created_at,
            p.updated_at
          FROM productos p
          JOIN subcategorias sc
            ON sc.id = p.subcategoria_id
          JOIN categorias c
            ON c.id = sc.categoria_id
          ORDER BY c.orden ASC, p.titulo ASC
        `,
      );

      return result.rows;
    },

    async listActiveByCategory(categoriaId) {
      const result = await client.query(
        `
          SELECT p.id, p.titulo
          FROM productos p
          JOIN subcategorias sc
            ON sc.id = p.subcategoria_id
          WHERE sc.categoria_id = $1
            AND activo = TRUE
          ORDER BY titulo ASC
        `,
        [categoriaId],
      );

      return result.rows;
    },

    async listMenuRows(mesaSesionId) {
      const result = await client.query(
        `
          SELECT
            c.id AS categoria_id,
            c.titulo AS categoria_titulo,
            c.orden AS categoria_orden,
            sc.id AS subcategoria_id,
            sc.titulo AS subcategoria_titulo,
            sc.orden AS subcategoria_orden,
            p.id AS producto_id,
            p.titulo AS producto_titulo,
            p.descripcion AS producto_descripcion,
            p.precio_ars_centavos,
            p.imagen_nombre_archivo,
            COALESCE(SUM(ci.cantidad), 0) AS cantidad_total_mesa
          FROM categorias c
          JOIN subcategorias sc
            ON sc.categoria_id = c.id
          JOIN productos p
            ON p.subcategoria_id = sc.id
          LEFT JOIN comanda_sesiones cs
            ON cs.mesa_sesion_id = $1
           AND cs.estado = 'abierta'
          LEFT JOIN comanda_items ci
            ON ci.producto_id = p.id
           AND ci.comanda_sesion_id = cs.id
          WHERE c.activa = TRUE
            AND sc.activa = TRUE
            AND p.activo = TRUE
          GROUP BY
            c.id,
            c.titulo,
            c.orden,
            sc.id,
            sc.titulo,
            sc.orden,
            p.id,
            p.titulo,
            p.descripcion,
            p.precio_ars_centavos,
            p.imagen_nombre_archivo
          ORDER BY c.orden ASC, sc.orden ASC, p.titulo ASC
        `,
        [mesaSesionId],
      );

      return result.rows;
    },

    async getCatalogRevision() {
      const result = await client.query(
        `
          SELECT GREATEST(
            COALESCE((SELECT MAX(updated_at) FROM categorias), TO_TIMESTAMP(0)),
            COALESCE((SELECT MAX(updated_at) FROM subcategorias), TO_TIMESTAMP(0)),
            COALESCE((SELECT MAX(updated_at) FROM productos), TO_TIMESTAMP(0))
          ) AS catalogo_revision
        `,
      );

      return result.rows[0]?.catalogo_revision ?? null;
    },

    async create(subcategoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo) {
      const result = await client.query(
        `
          INSERT INTO productos (
            subcategoria_id,
            titulo,
            descripcion,
            precio_ars_centavos,
            imagen_nombre_archivo,
            activo,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
          RETURNING id, subcategoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo, created_at, updated_at
        `,
        [subcategoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo],
      );

      return result.rows[0] ?? null;
    },

    async getBasicById(id) {
      const result = await client.query(
        `
          SELECT id, titulo, descripcion, precio_ars_centavos, activo
          FROM productos
          WHERE id = $1
          LIMIT 1
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async getByIdForUpdate(id) {
      const result = await client.query(
        `
          SELECT id, subcategoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo
          FROM productos
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async update(id, subcategoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo, activo) {
      const result = await client.query(
        `
          UPDATE productos
          SET subcategoria_id = $2,
              titulo = $3,
              descripcion = $4,
              precio_ars_centavos = $5,
              imagen_nombre_archivo = $6,
              activo = $7,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, subcategoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo, created_at, updated_at
        `,
        [id, subcategoriaId, titulo, descripcion, precioArsCentavos, imagenNombreArchivo, activo],
      );

      return result.rows[0] ?? null;
    },
  };
}

export function bindConfiguracionVisualDao(client) {
  return {
    async getSingleton() {
      const result = await client.query(
        `
          SELECT usd_exchange_rate
          FROM configuracion_visual
          WHERE id = 1
          LIMIT 1
        `,
      );

      return result.rows[0] ?? null;
    },

    async updateUsdExchangeRate(usdExchangeRate) {
      await client.query(
        `
          UPDATE configuracion_visual
          SET usd_exchange_rate = $1,
            updated_at = NOW()
          WHERE id = 1
        `,
        [usdExchangeRate],
      );
    },
  };
}

export function bindMesaSesionesDao(client) {
  return {
    ...createCrudDao(client, 'mesa_sesiones', 'id, mesa_id, estado, creada_en, cerrada_en'),

    async createOpen(mesaId) {
      const result = await client.query(
        `
          INSERT INTO mesa_sesiones (
            mesa_id,
            estado
          )
          VALUES ($1, 'abierta')
          RETURNING id, mesa_id, estado, creada_en, cerrada_en
        `,
        [mesaId],
      );

      return mapMesaSessionRow(result.rows[0] ?? null);
    },

    async getActiveByMesaId(mesaId) {
      const result = await client.query(
        `
          SELECT
            ms.id,
            ms.mesa_id,
            ms.estado,
            msl.cliente_sesion_id AS lider_cliente_sesion_id,
            ms.creada_en,
            ms.cerrada_en
          FROM mesa_sesiones ms
          LEFT JOIN mesa_sesion_lideres msl
            ON msl.mesa_sesion_id = ms.id
          WHERE ms.mesa_id = $1
            AND ms.estado = 'abierta'
          ORDER BY ms.creada_en DESC
          LIMIT 1
        `,
        [mesaId],
      );

      return mapMesaSessionRow(result.rows[0] ?? null);
    },

    async lockById(id) {
      const result = await client.query(
        `
          SELECT
            ms.id,
            ms.mesa_id,
            ms.estado,
            msl.cliente_sesion_id AS lider_cliente_sesion_id,
            ms.creada_en,
            ms.cerrada_en
          FROM mesa_sesiones ms
          LEFT JOIN mesa_sesion_lideres msl
            ON msl.mesa_sesion_id = ms.id
          WHERE ms.id = $1
          FOR UPDATE OF ms
        `,
        [id],
      );

      return mapMesaSessionRow(result.rows[0] ?? null);
    },

    async getOpenForClose(mesaId) {
      const result = await client.query(
        `
          SELECT
            ms.id,
            (
              SELECT COUNT(*)
              FROM comanda_sesiones cs
              WHERE cs.mesa_sesion_id = ms.id
                AND cs.estado = 'confirmada'
            ) AS comandas_confirmadas_count
          FROM mesa_sesiones ms
          WHERE ms.mesa_id = $1
            AND ms.estado = 'abierta'
          LIMIT 1
          FOR UPDATE
        `,
        [mesaId],
      );

      return result.rows[0] ?? null;
    },

    async getActiveSessionId(mesaId) {
      const result = await client.query(
        `
          SELECT id
          FROM mesa_sesiones
          WHERE mesa_id = $1
            AND estado = 'abierta'
          LIMIT 1
        `,
        [mesaId],
      );

      return result.rows[0]?.id ?? null;
    },

    async close(id) {
      await client.query(
        `
          UPDATE mesa_sesiones
          SET estado = 'cerrada',
              cerrada_en = NOW()
          WHERE id = $1
        `,
        [id],
      );
    },
  };
}

export function bindMesaClientesDao(client) {
  return {
    ...createCrudDao(
      client,
      'mesa_clientes',
      'id, mesa_sesion_id, cliente_sesion_id, cliente_nombre, conectada, creada_en, ultimo_seen_en, desconexion_programada_en, desconectada_en',
    ),

    async getBySessionAndClient(mesaSesionId, clientSessionId) {
      const result = await client.query(
        `
          SELECT
            id,
            mesa_sesion_id,
            cliente_sesion_id,
            cliente_nombre,
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
    },

    async create(mesaSesionId, clientSessionId, clientName = null) {
      const result = await client.query(
        `
          INSERT INTO mesa_clientes (
            mesa_sesion_id,
            cliente_sesion_id,
            cliente_nombre,
            conectada,
            desconexion_programada_en
          )
          VALUES ($1, $2, $3, TRUE, NULL)
          RETURNING
            id,
            mesa_sesion_id,
            cliente_sesion_id,
            cliente_nombre,
            conectada,
            creada_en,
            ultimo_seen_en,
            desconectada_en,
            desconexion_programada_en
        `,
        [mesaSesionId, clientSessionId, clientName],
      );

      return result.rows[0] ?? null;
    },

    async touch(mesaSesionId, clientSessionId, clientName = null) {
      await client.query(
        `
          UPDATE mesa_clientes
          SET conectada = TRUE,
              cliente_nombre = COALESCE($3, cliente_nombre),
              ultimo_seen_en = NOW(),
              desconectada_en = NULL,
              desconexion_programada_en = NULL
          WHERE mesa_sesion_id = $1
            AND cliente_sesion_id = $2
        `,
        [mesaSesionId, clientSessionId, clientName],
      );
    },

    async scheduleDisconnect(mesaSesionId, clientSessionId, graceSeconds) {
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
    },

    async markDisconnected(mesaSesionId, clientSessionId) {
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
        [mesaSesionId, clientSessionId],
      );
    },

    async disconnectAll(mesaSesionId) {
      await client.query(
        `
          UPDATE mesa_clientes
          SET conectada = FALSE,
              desconectada_en = NOW(),
              ultimo_seen_en = NOW(),
              desconexion_programada_en = NULL
          WHERE mesa_sesion_id = $1
        `,
        [mesaSesionId],
      );
    },

    async countConnected(mesaSesionId) {
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
    },

    async getOldestConnectedClientSessionId(mesaSesionId) {
      const result = await client.query(
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

      return result.rows[0]?.cliente_sesion_id ?? null;
    },

    async listPendingDisconnects() {
      const result = await client.query(
        `
          SELECT
            mc.mesa_sesion_id,
            mc.cliente_sesion_id,
            mc.desconexion_programada_en,
            m.nombre AS mesa_numero
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

      return result.rows;
    },
  };
}

export function bindMesaSesionLideresDao(client) {
  return {
    async upsert(mesaSesionId, nextLeaderClientSessionId) {
      await client.query(
        `
          INSERT INTO mesa_sesion_lideres (
            mesa_sesion_id,
            cliente_sesion_id,
            updated_at
          )
          VALUES ($1, $2, NOW())
          ON CONFLICT (mesa_sesion_id)
          DO UPDATE SET
            cliente_sesion_id = EXCLUDED.cliente_sesion_id,
            updated_at = NOW()
        `,
        [mesaSesionId, nextLeaderClientSessionId],
      );
    },

    async deleteByMesaSesionId(mesaSesionId) {
      await client.query(
        `
          DELETE FROM mesa_sesion_lideres
          WHERE mesa_sesion_id = $1
        `,
        [mesaSesionId],
      );
    },
  };
}

export function bindComandaSesionesDao(client) {
  return {
    ...createCrudDao(
      client,
      'comanda_sesiones',
      'id, mesa_sesion_id, numero_orden, estado, total_ars_centavos, creada_en, confirmada_en, cobrado_en',
    ),

    async getOpenByMesaSesion(mesaSesionId) {
      const result = await client.query(
        `
          SELECT id, mesa_sesion_id, numero_orden, estado, total_ars_centavos, creada_en, confirmada_en, cobrado_en
          FROM comanda_sesiones
          WHERE mesa_sesion_id = $1
            AND estado = 'abierta'
          ORDER BY creada_en DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `,
        [mesaSesionId],
      );

      return result.rows[0] ?? null;
    },

    async createOpen(mesaSesionId) {
      const result = await client.query(
        `
          INSERT INTO comanda_sesiones (mesa_sesion_id, estado)
          VALUES ($1, 'abierta')
          RETURNING id, mesa_sesion_id, numero_orden, estado, total_ars_centavos, creada_en, confirmada_en, cobrado_en
        `,
        [mesaSesionId],
      );

      return result.rows[0] ?? null;
    },

    async getNextComandaNumber(mesaSesionId) {
      const result = await client.query(
        `
          SELECT COALESCE(MAX(numero_orden), 0) + 1 AS siguiente_numero
          FROM comanda_sesiones
          WHERE mesa_sesion_id = $1
            AND estado = 'confirmada'
        `,
        [mesaSesionId],
      );

      return Number(result.rows[0]?.siguiente_numero ?? 1);
    },

    async confirmOpen(id, numeroOrden, totalArsCentavos) {
      const result = await client.query(
        `
          UPDATE comanda_sesiones
          SET estado = 'confirmada',
              numero_orden = $2,
              total_ars_centavos = $3,
              confirmada_en = NOW()
          WHERE id = $1
            AND estado = 'abierta'
          RETURNING id, mesa_sesion_id, numero_orden, estado, total_ars_centavos, creada_en, confirmada_en, cobrado_en
        `,
        [id, numeroOrden, totalArsCentavos],
      );

      return result.rows[0] ?? null;
    },

    async markConfirmedComandasAsPaid(mesaSesionId) {
      await client.query(
        `
          UPDATE comanda_sesiones
          SET cobrado_en = NOW()
          WHERE mesa_sesion_id = $1
            AND estado = 'confirmada'
            AND cobrado_en IS NULL
        `,
        [mesaSesionId],
      );
    },

    async listConfirmedByMesaSesion(mesaSesionId) {
      const result = await client.query(
        `
          SELECT id, numero_orden, total_ars_centavos, confirmada_en, cobrado_en
          FROM comanda_sesiones
          WHERE mesa_sesion_id = $1
            AND estado = 'confirmada'
          ORDER BY numero_orden DESC
        `,
        [mesaSesionId],
      );

      return result.rows;
    },

    async clearOpenByMesaSesion(mesaSesionId) {
      await client.query(
        `
          DELETE FROM comanda_sesiones
          WHERE mesa_sesion_id = $1
            AND estado = 'abierta'
        `,
        [mesaSesionId],
      );
    },
  };
}

export function bindComandaItemsDao(client) {
  return {
    ...createCrudDao(
      client,
      'comanda_items',
      'id, comanda_sesion_id, producto_id, cliente_sesion_id, titulo_snapshot, descripcion_snapshot, precio_ars_centavos_snapshot, cantidad, created_at, updated_at',
    ),

    async deleteInactiveCatalogItems(comandaSesionId) {
      const result = await client.query(
        `
          DELETE FROM comanda_items ci
          USING productos p
          WHERE ci.producto_id = p.id
            AND ci.comanda_sesion_id = $1
            AND p.activo = FALSE
          RETURNING ci.producto_id, ci.titulo_snapshot AS titulo
        `,
        [comandaSesionId],
      );

      return result.rows;
    },

    async listRows(comandaSesionId) {
      const result = await client.query(
        `
          SELECT
            ci.producto_id,
            ci.titulo_snapshot AS titulo,
            ci.descripcion_snapshot AS descripcion,
            ci.precio_ars_centavos_snapshot AS precio_ars_centavos,
            SUM(ci.cantidad) AS cantidad_total,
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'clienteSesionId', ci.cliente_sesion_id,
                'clienteNombre', mc.cliente_nombre,
                'cantidad', ci.cantidad
              )
              ORDER BY ci.cliente_sesion_id ASC
            ) AS cantidades_por_cliente
          FROM comanda_items ci
          JOIN comanda_sesiones cs
            ON cs.id = ci.comanda_sesion_id
          LEFT JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = cs.mesa_sesion_id
           AND mc.cliente_sesion_id = ci.cliente_sesion_id
          WHERE ci.comanda_sesion_id = $1
          GROUP BY ci.producto_id, ci.titulo_snapshot, ci.descripcion_snapshot, ci.precio_ars_centavos_snapshot
          ORDER BY ci.titulo_snapshot ASC
        `,
        [comandaSesionId],
      );

      return result.rows;
    },

    async listOwnedAggregatedRows(comandaSesionId, clientSessionId) {
      const result = await client.query(
        `
          SELECT
            producto_id,
            titulo_snapshot AS titulo,
            descripcion_snapshot AS descripcion,
            precio_ars_centavos_snapshot AS precio_ars_centavos,
            SUM(cantidad) AS cantidad_total
          FROM comanda_items
          WHERE comanda_sesion_id = $1
            AND cliente_sesion_id = $2
          GROUP BY producto_id, titulo_snapshot, descripcion_snapshot, precio_ars_centavos_snapshot
          ORDER BY titulo_snapshot ASC
        `,
        [comandaSesionId, clientSessionId],
      );

      return result.rows;
    },

    async getOwnedItem(comandaSesionId, productoId, clientSessionId) {
      const result = await client.query(
        `
          SELECT id, producto_id, cantidad
          FROM comanda_items
          WHERE comanda_sesion_id = $1
            AND producto_id = $2
            AND cliente_sesion_id = $3
          LIMIT 1
        `,
        [comandaSesionId, productoId, clientSessionId],
      );

      return result.rows[0] ?? null;
    },

    async getProductQuantity(comandaSesionId, productoId) {
      const result = await client.query(
        `
          SELECT COALESCE(SUM(cantidad), 0) AS cantidad_total
          FROM comanda_items
          WHERE comanda_sesion_id = $1
            AND producto_id = $2
        `,
        [comandaSesionId, productoId],
      );

      return Number(result.rows[0]?.cantidad_total ?? 0);
    },

    async insertItem(comandaSesionId, productoId, clientSessionId, titulo, descripcion, precioArsCentavos, cantidad = 1) {
      await client.query(
        `
          INSERT INTO comanda_items (
            comanda_sesion_id,
            producto_id,
            cliente_sesion_id,
            titulo_snapshot,
            descripcion_snapshot,
            precio_ars_centavos_snapshot,
            cantidad
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [comandaSesionId, productoId, clientSessionId, titulo, descripcion, precioArsCentavos, cantidad],
      );
    },

    async incrementItem(id, amount = 1) {
      await client.query(
        `
          UPDATE comanda_items
          SET cantidad = cantidad + $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [id, amount],
      );
    },

    async decrementItem(id, amount = 1) {
      await client.query(
        `
          UPDATE comanda_items
          SET cantidad = cantidad - $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [id, amount],
      );
    },

    async listRowsForConfirmation(comandaSesionId) {
      const result = await client.query(
        `
          SELECT
            producto_id,
            cliente_sesion_id,
            cantidad,
            titulo_snapshot AS titulo,
            descripcion_snapshot AS descripcion,
            precio_ars_centavos_snapshot AS precio_ars_centavos
          FROM comanda_items
          WHERE comanda_sesion_id = $1
          ORDER BY titulo_snapshot ASC, cliente_sesion_id ASC
        `,
        [comandaSesionId],
      );

      return result.rows;
    },

    async listAggregatedByComandaSesion(comandaSesionId) {
      const result = await client.query(
        `
          SELECT
            ci.producto_id,
            ci.titulo_snapshot,
            ci.descripcion_snapshot,
            ci.precio_ars_centavos_snapshot,
            SUM(ci.cantidad) AS cantidad_total,
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'clienteSesionId', ci.cliente_sesion_id,
                'clienteNombre', mc.cliente_nombre,
                'cantidad', ci.cantidad
              )
              ORDER BY ci.cliente_sesion_id ASC
            ) AS cantidades_por_cliente
          FROM comanda_items ci
          JOIN comanda_sesiones cs
            ON cs.id = ci.comanda_sesion_id
          LEFT JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = cs.mesa_sesion_id
           AND mc.cliente_sesion_id = ci.cliente_sesion_id
          WHERE ci.comanda_sesion_id = $1
          GROUP BY ci.producto_id, ci.titulo_snapshot, ci.descripcion_snapshot, ci.precio_ars_centavos_snapshot
          ORDER BY ci.titulo_snapshot ASC
        `,
        [comandaSesionId],
      );

      return result.rows;
    },

    async listKitchenItems(comandaSesionId) {
      const result = await client.query(
        `
          SELECT
            titulo_snapshot,
            descripcion_snapshot,
            precio_ars_centavos_snapshot,
            cantidad,
            ci.cliente_sesion_id,
            mc.cliente_nombre
          FROM comanda_items ci
          JOIN comanda_sesiones cs
            ON cs.id = ci.comanda_sesion_id
          LEFT JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = cs.mesa_sesion_id
           AND mc.cliente_sesion_id = ci.cliente_sesion_id
          WHERE ci.comanda_sesion_id = $1
          ORDER BY ci.titulo_snapshot ASC, ci.cliente_sesion_id ASC
        `,
        [comandaSesionId],
      );

      return result.rows;
    },

    async listOwnedRows(comandaSesionId, clientSessionId) {
      const result = await client.query(
        `
          SELECT id, producto_id, cantidad
          FROM comanda_items
          WHERE comanda_sesion_id = $1
            AND cliente_sesion_id = $2
          ORDER BY created_at ASC, id ASC
        `,
        [comandaSesionId, clientSessionId],
      );

      return result.rows;
    },

    async listOrphanRows(comandaSesionId) {
      const result = await client.query(
        `
          SELECT id, producto_id, cantidad
          FROM comanda_items
          WHERE comanda_sesion_id = $1
            AND cliente_sesion_id IS NULL
          ORDER BY created_at ASC, id ASC
        `,
        [comandaSesionId],
      );

      return result.rows;
    },

    async reassignOwner(id, targetClientSessionId) {
      await client.query(
        `
          UPDATE comanda_items
          SET cliente_sesion_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [id, targetClientSessionId],
      );
    },

    async orphanByComandaSesion(comandaSesionId) {
      const result = await client.query(
        `
          UPDATE comanda_items
          SET cliente_sesion_id = NULL,
              updated_at = NOW()
          WHERE comanda_sesion_id = $1
          RETURNING cantidad
        `,
        [comandaSesionId],
      );

      return result.rows;
    },
  };
}

export function bindConsultasMasterDao(client) {
  return {
    ...createCrudDao(
      client,
      'consultas_master',
      'id, mesa_sesion_id, cliente_sesion_id, estado, creada_en, cerrada_en, cerrada_por',
    ),

    async getPendingByMesaSesion(mesaSesionId) {
      const result = await client.query(
        `
          SELECT id, cliente_sesion_id, creada_en
          FROM consultas_master c
          WHERE c.mesa_sesion_id = $1
            AND c.estado = 'pendiente'
          ORDER BY c.creada_en DESC
          LIMIT 1
        `,
        [mesaSesionId],
      );

      return result.rows[0] ?? null;
    },

    async createPending(mesaSesionId, clientSessionId) {
      const result = await client.query(
        `
          INSERT INTO consultas_master (
            mesa_sesion_id,
            cliente_sesion_id,
            estado
          )
          VALUES ($1, $2, 'pendiente')
          RETURNING id
        `,
        [mesaSesionId, clientSessionId],
      );

      return result.rows[0] ?? null;
    },

    async close(id, cerradoPor) {
      await client.query(
        `
          UPDATE consultas_master
          SET estado = 'atendido',
              cerrada_en = NOW(),
              cerrada_por = $2
          WHERE id = $1
        `,
        [id, cerradoPor],
      );
    },

    async closePendingByMesaSesion(mesaSesionId, cerradoPor) {
      await client.query(
        `
          UPDATE consultas_master
          SET estado = 'atendido',
              cerrada_en = NOW(),
              cerrada_por = $2
          WHERE mesa_sesion_id = $1
            AND estado = 'pendiente'
        `,
        [mesaSesionId, cerradoPor],
      );
    },

    async listQueue(status) {
      const result = await client.query(
        `
          SELECT
            c.id,
            c.estado,
            c.creada_en,
            c.cerrada_en,
            c.cliente_sesion_id,
            mc.cliente_nombre,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero,
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
          JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = c.mesa_sesion_id
           AND mc.cliente_sesion_id = c.cliente_sesion_id
          WHERE c.estado = $1
          ORDER BY c.creada_en ASC
        `,
        [status],
      );

      return result.rows;
    },

    async getWithContext(id, { forUpdate = false } = {}) {
      const result = await client.query(
        `
          SELECT
            c.id,
            c.estado,
            c.creada_en,
            c.cerrada_en,
            c.cliente_sesion_id,
            mc.cliente_nombre,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero
          FROM consultas_master c
          JOIN mesa_sesiones ms
            ON ms.id = c.mesa_sesion_id
          JOIN mesas m
            ON m.id = ms.mesa_id
          JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = c.mesa_sesion_id
           AND mc.cliente_sesion_id = c.cliente_sesion_id
          WHERE c.id = $1
          LIMIT 1${forUpdate ? '\n          FOR UPDATE' : ''}
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },
  };
}

export function bindConsultasDetailDao(client) {
  return {
    ...createCrudDao(client, 'consultas_detail', 'id, consulta_id, autor_tipo, autor_referencia, contenido, creada_en'),

    async listByConsultaId(consultaId) {
      const result = await client.query(
        `
          SELECT
            cd.id,
            cd.autor_tipo,
            cd.autor_referencia,
            mc.cliente_nombre AS autor_nombre,
            cd.contenido,
            cd.creada_en
          FROM consultas_detail cd
          JOIN consultas_master cm
            ON cm.id = cd.consulta_id
          LEFT JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = cm.mesa_sesion_id
           AND mc.cliente_sesion_id = cd.autor_referencia
           AND cd.autor_tipo = 'cliente'
          WHERE cd.consulta_id = $1
          ORDER BY cd.creada_en ASC, cd.id ASC
        `,
        [consultaId],
      );

      return result.rows;
    },

    async insertMessage(consultaId, autorTipo, autorReferencia, contenido) {
      await client.query(
        `
          INSERT INTO consultas_detail (
            consulta_id,
            autor_tipo,
            autor_referencia,
            contenido
          )
          VALUES ($1, $2, $3, $4)
        `,
        [consultaId, autorTipo, autorReferencia, contenido],
      );
    },
  };
}

export function bindLlamadosMozoDao(client) {
  return {
    ...createCrudDao(
      client,
      'llamados_mozo',
      'id, mesa_sesion_id, cliente_sesion_id, estado, creada_en, atendida_en, atendida_por',
    ),

    async getPendingByMesaSesion(mesaSesionId) {
      const result = await client.query(
        `
          SELECT
            lm.id,
            lm.cliente_sesion_id,
            mc.cliente_nombre,
            lm.creada_en
          FROM llamados_mozo lm
          JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = lm.mesa_sesion_id
           AND mc.cliente_sesion_id = lm.cliente_sesion_id
          WHERE lm.mesa_sesion_id = $1
            AND lm.estado = 'pendiente'
          ORDER BY lm.creada_en DESC
          LIMIT 1
        `,
        [mesaSesionId],
      );

      return result.rows[0] ?? null;
    },

    async createPending(mesaSesionId, clientSessionId) {
      const result = await client.query(
        `
          INSERT INTO llamados_mozo (
            mesa_sesion_id,
            cliente_sesion_id,
            estado
          )
          VALUES ($1, $2, 'pendiente')
          RETURNING id
        `,
        [mesaSesionId, clientSessionId],
      );

      return result.rows[0] ?? null;
    },

    async receivePendingByMesaSesion(mesaSesionId, actorNombre) {
      await client.query(
        `
          UPDATE llamados_mozo
          SET estado = 'atendido',
              atendida_en = NOW(),
              atendida_por = $2
          WHERE mesa_sesion_id = $1
            AND estado = 'pendiente'
        `,
        [mesaSesionId, actorNombre],
      );
    },

    async listQueue(status) {
      const result = await client.query(
        `
          SELECT
            lm.id,
            lm.estado,
            lm.creada_en,
            lm.atendida_en,
            lm.cliente_sesion_id,
            mc.cliente_nombre,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero
          FROM llamados_mozo lm
          JOIN mesa_sesiones ms
            ON ms.id = lm.mesa_sesion_id
          JOIN mesas m
            ON m.id = ms.mesa_id
          JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = lm.mesa_sesion_id
           AND mc.cliente_sesion_id = lm.cliente_sesion_id
          WHERE lm.estado = $1
          ORDER BY lm.creada_en ASC
        `,
        [status],
      );

      return result.rows;
    },

    async getWithContext(id) {
      const result = await client.query(
        `
          SELECT
            lm.id,
            lm.estado,
            lm.creada_en,
            lm.atendida_en,
            lm.atendida_por,
            lm.cliente_sesion_id,
            mc.cliente_nombre,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero
          FROM llamados_mozo lm
          JOIN mesa_sesiones ms
            ON ms.id = lm.mesa_sesion_id
          JOIN mesas m
            ON m.id = ms.mesa_id
          JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = lm.mesa_sesion_id
           AND mc.cliente_sesion_id = lm.cliente_sesion_id
          WHERE lm.id = $1
          LIMIT 1
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async receiveById(id, actorNombre) {
      const result = await client.query(
        `
          UPDATE llamados_mozo
          SET estado = 'atendido',
              atendida_en = NOW(),
              atendida_por = $2
          WHERE id = $1
            AND estado = 'pendiente'
          RETURNING id
        `,
        [id, actorNombre],
      );

      return result;
    },
  };
}

export function bindPedidosCocinaDao(client) {
  return {
    ...createCrudDao(client, 'pedidos_cocina', 'id, comanda_sesion_id, estado, creada_en, atendida_en, atendida_por'),

    async createPending(comandaSesionId) {
      await client.query(
        `
          INSERT INTO pedidos_cocina (
            comanda_sesion_id,
            estado
          )
          VALUES ($1, 'pendiente')
        `,
        [comandaSesionId],
      );
    },

    async receivePendingByMesaSesion(mesaSesionId, actorNombre) {
      await client.query(
        `
          UPDATE pedidos_cocina pk
          SET estado = 'atendido',
              atendida_en = NOW(),
              atendida_por = $2
          FROM comanda_sesiones cs
          WHERE cs.id = pk.comanda_sesion_id
            AND cs.mesa_sesion_id = $1
            AND pk.estado = 'pendiente'
        `,
        [mesaSesionId, actorNombre],
      );
    },

    async listQueue(status) {
      const result = await client.query(
        `
          SELECT
            pk.id,
            pk.estado,
            pk.creada_en,
            pk.atendida_en,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero,
            cs.total_ars_centavos
          FROM pedidos_cocina pk
          JOIN comanda_sesiones cs
            ON cs.id = pk.comanda_sesion_id
          JOIN mesa_sesiones ms
            ON ms.id = cs.mesa_sesion_id
          JOIN mesas m
            ON m.id = ms.mesa_id
          WHERE pk.estado = $1
          ORDER BY pk.creada_en ASC
        `,
        [status],
      );

      return result.rows;
    },

    async getWithContext(id) {
      const result = await client.query(
        `
          SELECT
            pk.id,
            pk.estado,
            pk.creada_en,
            pk.atendida_en,
            cs.id AS comanda_sesion_id,
            cs.total_ars_centavos,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero
          FROM pedidos_cocina pk
          JOIN comanda_sesiones cs
            ON cs.id = pk.comanda_sesion_id
          JOIN mesa_sesiones ms
            ON ms.id = cs.mesa_sesion_id
          JOIN mesas m
            ON m.id = ms.mesa_id
          WHERE pk.id = $1
          LIMIT 1
        `,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async receiveById(id, actorNombre) {
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
        [id, actorNombre],
      );

      return result;
    },
  };
}

export function bindRolesWebSessionsDao(client) {
  return {
    ...createCrudDao(
      client,
      'roles_web_sessions',
      'id, rol, actor_nombre, session_token_hash, ultimo_evento_relevante_en, created_at',
    ),

    async getByRole(role) {
      const result = await client.query(
        `
          SELECT id, rol, actor_nombre, session_token_hash, ultimo_evento_relevante_en, created_at
          FROM roles_web_sessions
          WHERE rol = $1
          LIMIT 1
        `,
        [role],
      );

      return result.rows[0] ?? null;
    },

    async getByTokenHash(sessionTokenHash) {
      const result = await client.query(
        `
          SELECT id, rol, actor_nombre, session_token_hash, ultimo_evento_relevante_en, created_at
          FROM roles_web_sessions
          WHERE session_token_hash = $1
          LIMIT 1
        `,
        [sessionTokenHash],
      );

      return result.rows[0] ?? null;
    },

    async create(role, actorNombre, sessionTokenHash) {
      const result = await client.query(
        `
          INSERT INTO roles_web_sessions (
            rol,
            actor_nombre,
            session_token_hash,
            ultimo_evento_relevante_en
          )
          VALUES ($1, $2, $3, NOW())
          RETURNING id, rol, actor_nombre, session_token_hash, ultimo_evento_relevante_en, created_at
        `,
        [role, actorNombre, sessionTokenHash],
      );

      return result.rows[0] ?? null;
    },

    async deleteByRole(role) {
      await client.query(
        `
          DELETE FROM roles_web_sessions
          WHERE rol = $1
        `,
        [role],
      );
    },

    async deleteByTokenHash(sessionTokenHash) {
      await client.query(
        `
          DELETE FROM roles_web_sessions
          WHERE session_token_hash = $1
        `,
        [sessionTokenHash],
      );
    },

    async touchByTokenHash(sessionTokenHash) {
      const result = await client.query(
        `
          UPDATE roles_web_sessions
          SET ultimo_evento_relevante_en = NOW()
          WHERE session_token_hash = $1
          RETURNING id, rol, actor_nombre, session_token_hash, ultimo_evento_relevante_en, created_at
        `,
        [sessionTokenHash],
      );

      return result;
    },
  };
}

export function bindEventosAuditoriaDao(client) {
  return {
    ...createCrudDao(
      client,
      'eventos_auditoria',
      'id, agregado, agregado_id, evento, actor_tipo, actor_referencia, payload_json, created_at',
    ),
  };
}

export function bindEntityDaos(client) {
  return {
    mesas: bindMesasDao(client),
    categorias: bindCategoriasDao(client),
    subcategorias: bindSubcategoriasDao(client),
    productos: bindProductosDao(client),
    configuracionVisual: bindConfiguracionVisualDao(client),
    mesaSesiones: bindMesaSesionesDao(client),
    mesaClientes: bindMesaClientesDao(client),
    mesaSesionLideres: bindMesaSesionLideresDao(client),
    comandaSesiones: bindComandaSesionesDao(client),
    comandaItems: bindComandaItemsDao(client),
    consultasMaster: bindConsultasMasterDao(client),
    consultasDetail: bindConsultasDetailDao(client),
    llamadosMozo: bindLlamadosMozoDao(client),
    pedidosCocina: bindPedidosCocinaDao(client),
    rolesWebSessions: bindRolesWebSessionsDao(client),
    eventosAuditoria: bindEventosAuditoriaDao(client),
  };
}
