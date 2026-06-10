export function bindDashboardReadModelDao(client) {
  return {
    async getCurrentJornadaRange(businessTimezone, jornadaStartTime) {
      const result = await client.query(
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
        [businessTimezone, jornadaStartTime],
      );

      return result.rows[0] ?? null;
    },

    async getDashboardRow(range) {
      const result = await client.query(
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
              m.nombre AS mesa_numero,
              COALESCE(SUM(ps.total_ars_centavos), 0) AS total_ars_centavos
            FROM pedido_sesiones ps
            JOIN mesa_sesiones ms
              ON ms.id = ps.mesa_sesion_id
            JOIN mesas m
              ON m.id = ms.mesa_id
            CROSS JOIN rango r
            WHERE ps.cobrado_en >= r.inicio_utc
              AND ps.cobrado_en < r.fin_utc
            GROUP BY m.nombre
            ORDER BY m.nombre ASC
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

      return result.rows[0] ?? null;
    },

    async listRealtimeConsultas(range) {
      const result = await client.query(
        `
          SELECT
            c.id,
            c.estado,
            c.creada_en,
            c.cerrada_en,
            c.cerrada_por,
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
          JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = c.mesa_sesion_id
           AND mc.cliente_sesion_id = c.cliente_sesion_id
          WHERE c.estado = 'pendiente'
             OR (c.estado = 'atendido' AND c.creada_en >= $1 AND c.creada_en < $2)
          ORDER BY c.creada_en ASC
        `,
        [range.fromUtc, range.toUtc],
      );

      return result.rows;
    },

    async listRealtimePedidosCocina(range) {
      const result = await client.query(
        `
          SELECT
            pk.id,
            pk.estado,
            pk.creada_en,
            pk.atendida_en,
            pk.atendida_por,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero,
            ps.total_ars_centavos,
            COALESCE(
              (
                SELECT JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'titulo', pi.titulo_snapshot,
                    'descripcion', pi.descripcion_snapshot,
                    'precioArsCentavos', pi.precio_ars_centavos_snapshot,
                    'cantidad', pi.cantidad,
                    'clienteSesionId', pi.cliente_sesion_id,
                    'clienteNombre', mc.cliente_nombre
                  )
                  ORDER BY pi.titulo_snapshot ASC, pi.cliente_sesion_id ASC
                )
                FROM pedido_items pi
                JOIN pedido_sesiones detalle_ps
                  ON detalle_ps.id = pi.pedido_sesion_id
                LEFT JOIN mesa_clientes mc
                  ON mc.mesa_sesion_id = detalle_ps.mesa_sesion_id
                 AND mc.cliente_sesion_id = pi.cliente_sesion_id
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

      return result.rows;
    },

    async listRealtimeLlamadosMozo(range) {
      const result = await client.query(
        `
          SELECT
            lm.id,
            lm.estado,
            lm.creada_en,
            lm.atendida_en,
            lm.atendida_por,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero
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

      return result.rows;
    },

    async listHistoryConsultas(range) {
      const result = await client.query(
        `
          SELECT
            c.id,
            c.estado,
            c.creada_en,
            c.cerrada_en,
            c.cerrada_por,
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
          JOIN mesa_clientes mc
            ON mc.mesa_sesion_id = c.mesa_sesion_id
           AND mc.cliente_sesion_id = c.cliente_sesion_id
          WHERE c.creada_en >= $1
            AND c.creada_en < $2
          ORDER BY c.creada_en ASC
        `,
        [range.fromUtc, range.toUtc],
      );

      return result.rows;
    },

    async listHistoryPedidosCocina(range) {
      const result = await client.query(
        `
          SELECT
            pk.id,
            pk.estado,
            pk.creada_en,
            pk.atendida_en,
            pk.atendida_por,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero,
            ps.total_ars_centavos,
            COALESCE(
              (
                SELECT JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'titulo', pi.titulo_snapshot,
                    'descripcion', pi.descripcion_snapshot,
                    'precioArsCentavos', pi.precio_ars_centavos_snapshot,
                    'cantidad', pi.cantidad,
                    'clienteSesionId', pi.cliente_sesion_id,
                    'clienteNombre', mc.cliente_nombre
                  )
                  ORDER BY pi.titulo_snapshot ASC, pi.cliente_sesion_id ASC
                )
                FROM pedido_items pi
                JOIN pedido_sesiones detalle_ps
                  ON detalle_ps.id = pi.pedido_sesion_id
                LEFT JOIN mesa_clientes mc
                  ON mc.mesa_sesion_id = detalle_ps.mesa_sesion_id
                 AND mc.cliente_sesion_id = pi.cliente_sesion_id
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

      return result.rows;
    },

    async listHistoryLlamadosMozo(range) {
      const result = await client.query(
        `
          SELECT
            lm.id,
            lm.estado,
            lm.creada_en,
            lm.atendida_en,
            lm.atendida_por,
            ms.id AS mesa_sesion_id,
            m.nombre AS mesa_numero
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

      return result.rows;
    },
  };
}
