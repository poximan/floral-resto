CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION restobar_text_under(input_value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT LOWER(BTRIM(COALESCE(input_value, '')));
$$;

CREATE FUNCTION restobar_catalog_key(input_value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    (
      SELECT STRING_AGG(REGEXP_REPLACE(token, 's$', ''), ' ' ORDER BY token_order)
      FROM REGEXP_SPLIT_TO_TABLE(
        REGEXP_REPLACE(
          TRANSLATE(
            LOWER(BTRIM(COALESCE(input_value, ''))),
            'áàäâéèëêíìïîóòöôúùüûñ',
            'aaaaeeeeiiiioooouuuun'
          ),
          '[^a-z0-9]+',
          ' ',
          'g'
        ),
        '\s+'
      ) WITH ORDINALITY AS tokens(token, token_order)
      WHERE token <> ''
    ),
    ''
  );
$$;

CREATE FUNCTION restobar_catalog_similarity(left_value TEXT, right_value TEXT)
RETURNS REAL
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN restobar_catalog_key(left_value) = restobar_catalog_key(right_value) THEN 1
    ELSE SIMILARITY(restobar_catalog_key(left_value), restobar_catalog_key(right_value))
  END;
$$;

CREATE TABLE mesas (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mesas_nombre UNIQUE (nombre),
    CONSTRAINT ck_mesas_nombre_no_vacio CHECK (LENGTH(BTRIM(nombre)) > 0)
);

CREATE TABLE categorias (
    id BIGSERIAL PRIMARY KEY,
    titulo TEXT NOT NULL,
    orden INTEGER NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_categorias_titulo UNIQUE (titulo),
    CONSTRAINT ck_categorias_titulo_under CHECK (titulo = restobar_text_under(titulo)),
    CONSTRAINT ck_categorias_orden_positivo CHECK (orden > 0)
);

CREATE TABLE subcategorias (
    id BIGSERIAL PRIMARY KEY,
    categoria_id BIGINT NOT NULL REFERENCES categorias(id),
    titulo TEXT NOT NULL,
    orden INTEGER NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subcategorias_titulo UNIQUE (titulo),
    CONSTRAINT ck_subcategorias_titulo_under CHECK (titulo = restobar_text_under(titulo)),
    CONSTRAINT ck_subcategorias_orden_positivo CHECK (orden > 0)
);

CREATE TABLE productos (
    id BIGSERIAL PRIMARY KEY,
    subcategoria_id BIGINT NOT NULL REFERENCES subcategorias(id),
    titulo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    precio_ars_centavos BIGINT NOT NULL,
    imagen_nombre_archivo TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_productos_titulo_no_vacio CHECK (LENGTH(BTRIM(titulo)) > 0),
    CONSTRAINT ck_productos_descripcion_under CHECK (descripcion = restobar_text_under(descripcion)),
    CONSTRAINT ck_productos_imagen_under CHECK (
        imagen_nombre_archivo IS NULL
        OR imagen_nombre_archivo = restobar_text_under(imagen_nombre_archivo)
    ),
    CONSTRAINT ck_productos_precio_positivo CHECK (precio_ars_centavos > 0)
);

CREATE TABLE configuracion_visual (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    usd_exchange_rate NUMERIC(12, 2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_configuracion_visual_singleton CHECK (id = 1),
    CONSTRAINT ck_configuracion_visual_rate_positiva CHECK (usd_exchange_rate > 0)
);

CREATE TABLE mesa_sesiones (
    id BIGSERIAL PRIMARY KEY,
    mesa_id BIGINT NOT NULL REFERENCES mesas(id),
    estado TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cerrada_en TIMESTAMPTZ,
    CONSTRAINT ck_mesa_sesiones_estado CHECK (estado IN ('abierta', 'cerrada')),
    CONSTRAINT ck_mesa_sesiones_cierre_consistente CHECK (
        (estado = 'abierta' AND cerrada_en IS NULL)
        OR (estado = 'cerrada' AND cerrada_en IS NOT NULL)
    )
);

CREATE TABLE mesa_clientes (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    cliente_sesion_id CHAR(3),
    cliente_nombre TEXT,
    conectada BOOLEAN NOT NULL DEFAULT TRUE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_seen_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    desconexion_programada_en TIMESTAMPTZ,
    desconectada_en TIMESTAMPTZ,
    CONSTRAINT uq_mesa_clientes_sesion_cliente UNIQUE (mesa_sesion_id, cliente_sesion_id),
    CONSTRAINT ck_mesa_clientes_cliente_sesion_formato CHECK (
        cliente_sesion_id ~ '^[A-HJ-NP-Z2-9]{3}$'
    ),
    CONSTRAINT ck_mesa_clientes_nombre_no_vacio CHECK (
        cliente_nombre IS NULL
        OR LENGTH(BTRIM(cliente_nombre)) > 0
    ),
    CONSTRAINT ck_mesa_clientes_estado_consistente CHECK (
        (conectada = TRUE AND desconectada_en IS NULL)
        OR (
            conectada = FALSE
            AND desconectada_en IS NOT NULL
            AND desconexion_programada_en IS NULL
        )
    )
);

CREATE TABLE mesa_sesion_lideres (
    mesa_sesion_id BIGINT PRIMARY KEY REFERENCES mesa_sesiones(id),
    cliente_sesion_id CHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_mesa_sesion_lideres_cliente
        FOREIGN KEY (mesa_sesion_id, cliente_sesion_id)
        REFERENCES mesa_clientes (mesa_sesion_id, cliente_sesion_id),
    CONSTRAINT ck_mesa_sesion_lideres_cliente_sesion_formato CHECK (
        cliente_sesion_id ~ '^[A-HJ-NP-Z2-9]{3}$'
    )
);

CREATE TABLE comanda_sesiones (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    numero_orden INTEGER,
    estado TEXT NOT NULL,
    total_ars_centavos BIGINT NOT NULL DEFAULT 0,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmada_en TIMESTAMPTZ,
    cobrado_en TIMESTAMPTZ,
    CONSTRAINT uq_comanda_sesiones_numero UNIQUE (mesa_sesion_id, numero_orden),
    CONSTRAINT ck_comanda_sesiones_estado CHECK (estado IN ('abierta', 'confirmada')),
    CONSTRAINT ck_comanda_sesiones_numero_positivo CHECK (numero_orden IS NULL OR numero_orden > 0),
    CONSTRAINT ck_comanda_sesiones_total_no_negativo CHECK (total_ars_centavos >= 0),
    CONSTRAINT ck_comanda_sesiones_estado_consistente CHECK (
        (estado = 'abierta' AND numero_orden IS NULL AND confirmada_en IS NULL AND cobrado_en IS NULL)
        OR (estado = 'confirmada' AND numero_orden IS NOT NULL AND confirmada_en IS NOT NULL)
    )
);

CREATE TABLE comanda_items (
    id BIGSERIAL PRIMARY KEY,
    comanda_sesion_id BIGINT NOT NULL REFERENCES comanda_sesiones(id),
    producto_id BIGINT NOT NULL REFERENCES productos(id),
    cliente_sesion_id CHAR(3),
    titulo_snapshot TEXT NOT NULL,
    descripcion_snapshot TEXT NOT NULL,
    precio_ars_centavos_snapshot BIGINT NOT NULL,
    cantidad INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_comanda_items_cliente_sesion_formato CHECK (
        cliente_sesion_id IS NULL
        OR cliente_sesion_id ~ '^[A-HJ-NP-Z2-9]{3}$'
    ),
    CONSTRAINT ck_comanda_items_precio_no_negativo CHECK (precio_ars_centavos_snapshot >= 0),
    CONSTRAINT ck_comanda_items_cantidad_natural_operativa CHECK (cantidad BETWEEN 1 AND 15)
);

CREATE TABLE consultas_master (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    cliente_sesion_id CHAR(3) NOT NULL,
    estado TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cerrada_en TIMESTAMPTZ,
    cerrada_por TEXT,
    CONSTRAINT fk_consultas_master_cliente
        FOREIGN KEY (mesa_sesion_id, cliente_sesion_id)
        REFERENCES mesa_clientes (mesa_sesion_id, cliente_sesion_id),
    CONSTRAINT ck_consultas_master_cliente_sesion_formato CHECK (
        cliente_sesion_id ~ '^[A-HJ-NP-Z2-9]{3}$'
    ),
    CONSTRAINT ck_consultas_master_estado CHECK (estado IN ('pendiente', 'atendido')),
    CONSTRAINT ck_consultas_master_cierre_consistente CHECK (
        (estado = 'pendiente' AND cerrada_en IS NULL AND cerrada_por IS NULL)
        OR (estado = 'atendido' AND cerrada_en IS NOT NULL AND cerrada_por IS NOT NULL)
    )
);

CREATE TABLE consultas_detail (
    id BIGSERIAL PRIMARY KEY,
    consulta_id BIGINT NOT NULL REFERENCES consultas_master(id),
    autor_tipo TEXT NOT NULL,
    autor_referencia TEXT NOT NULL,
    contenido TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_consultas_detail_autor_tipo CHECK (autor_tipo IN ('cliente', 'mozo'))
);

CREATE TABLE llamados_mozo (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    cliente_sesion_id CHAR(3) NOT NULL,
    estado TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atendida_en TIMESTAMPTZ,
    atendida_por TEXT,
    CONSTRAINT fk_llamados_mozo_cliente
        FOREIGN KEY (mesa_sesion_id, cliente_sesion_id)
        REFERENCES mesa_clientes (mesa_sesion_id, cliente_sesion_id),
    CONSTRAINT ck_llamados_mozo_cliente_sesion_formato CHECK (
        cliente_sesion_id ~ '^[A-HJ-NP-Z2-9]{3}$'
    ),
    CONSTRAINT ck_llamados_mozo_estado CHECK (estado IN ('pendiente', 'atendido')),
    CONSTRAINT ck_llamados_mozo_atencion_consistente CHECK (
        (estado = 'pendiente' AND atendida_en IS NULL AND atendida_por IS NULL)
        OR (estado = 'atendido' AND atendida_en IS NOT NULL AND atendida_por IS NOT NULL)
    )
);

CREATE TABLE pedidos_cocina (
    id BIGSERIAL PRIMARY KEY,
    comanda_sesion_id BIGINT NOT NULL REFERENCES comanda_sesiones(id),
    estado TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atendida_en TIMESTAMPTZ,
    atendida_por TEXT,
    CONSTRAINT uq_pedidos_cocina_comanda_sesion UNIQUE (comanda_sesion_id),
    CONSTRAINT ck_pedidos_cocina_estado CHECK (estado IN ('pendiente', 'atendido')),
    CONSTRAINT ck_pedidos_cocina_atencion_consistente CHECK (
        (estado = 'pendiente' AND atendida_en IS NULL AND atendida_por IS NULL)
        OR (estado = 'atendido' AND atendida_en IS NOT NULL AND atendida_por IS NOT NULL)
    )
);

CREATE TABLE roles_web_sessions (
    id BIGSERIAL PRIMARY KEY,
    rol TEXT NOT NULL,
    actor_nombre TEXT NOT NULL,
    session_token_hash CHAR(64) NOT NULL,
    ultimo_evento_relevante_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_roles_web_sessions_rol UNIQUE (rol),
    CONSTRAINT uq_roles_web_sessions_session_token_hash UNIQUE (session_token_hash),
    CONSTRAINT ck_roles_web_sessions_rol CHECK (rol IN ('mozo', 'encargado')),
    CONSTRAINT ck_roles_web_sessions_hash_hex CHECK (
        session_token_hash ~ '^[0-9a-f]{64}$'
    )
);

CREATE TABLE eventos_auditoria (
    id BIGSERIAL PRIMARY KEY,
    agregado TEXT NOT NULL,
    agregado_id TEXT NOT NULL,
    evento TEXT NOT NULL,
    actor_tipo TEXT NOT NULL,
    actor_referencia TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
