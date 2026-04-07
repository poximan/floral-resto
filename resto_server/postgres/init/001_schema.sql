CREATE TABLE IF NOT EXISTS mesas (
    id BIGSERIAL PRIMARY KEY,
    numero INTEGER NOT NULL UNIQUE,
    habilitada BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categorias (
    id BIGSERIAL PRIMARY KEY,
    titulo TEXT NOT NULL UNIQUE,
    orden INTEGER NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS productos (
    id BIGSERIAL PRIMARY KEY,
    categoria_id BIGINT NOT NULL REFERENCES categorias(id),
    titulo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    precio_ars_centavos BIGINT NOT NULL,
    imagen_nombre_archivo TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuraciones_operativas (
    id BIGSERIAL PRIMARY KEY,
    clave TEXT NOT NULL UNIQUE,
    valor_texto TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mesa_sesiones (
    id BIGSERIAL PRIMARY KEY,
    mesa_id BIGINT NOT NULL REFERENCES mesas(id),
    estado TEXT NOT NULL,
    lider_cliente_sesion_id CHAR(3),
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cerrada_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mesa_sesiones_mesa_id ON mesa_sesiones (mesa_id);
CREATE INDEX IF NOT EXISTS idx_mesa_sesiones_estado ON mesa_sesiones (estado);

CREATE TABLE IF NOT EXISTS mesa_clientes (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    cliente_sesion_id CHAR(3) NOT NULL,
    conectada BOOLEAN NOT NULL DEFAULT TRUE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_seen_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    desconexion_programada_en TIMESTAMPTZ,
    desconectada_en TIMESTAMPTZ,
    UNIQUE (mesa_sesion_id, cliente_sesion_id)
);

CREATE TABLE IF NOT EXISTS mesa_carrito_items (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    producto_id BIGINT NOT NULL REFERENCES productos(id),
    cliente_sesion_id CHAR(3),
    cantidad INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mesa_carrito_items_mesa_sesion_id ON mesa_carrito_items (mesa_sesion_id);
CREATE INDEX IF NOT EXISTS idx_mesa_carrito_items_producto_id ON mesa_carrito_items (producto_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_carrito_items_owner
    ON mesa_carrito_items (mesa_sesion_id, producto_id, cliente_sesion_id)
    WHERE cliente_sesion_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_carrito_items_orphan
    ON mesa_carrito_items (mesa_sesion_id, producto_id)
    WHERE cliente_sesion_id IS NULL;

CREATE TABLE IF NOT EXISTS pedido_sesiones (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    numero_orden INTEGER NOT NULL,
    total_ars_centavos BIGINT NOT NULL DEFAULT 0,
    confirmado_en TIMESTAMPTZ,
    cobrado_en TIMESTAMPTZ,
    UNIQUE (mesa_sesion_id, numero_orden)
);

CREATE TABLE IF NOT EXISTS pedido_items (
    id BIGSERIAL PRIMARY KEY,
    pedido_sesion_id BIGINT NOT NULL REFERENCES pedido_sesiones(id),
    producto_id BIGINT NOT NULL REFERENCES productos(id),
    cliente_sesion_id CHAR(3) NOT NULL,
    titulo_snapshot TEXT NOT NULL,
    descripcion_snapshot TEXT NOT NULL,
    precio_ars_centavos_snapshot BIGINT NOT NULL,
    cantidad INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedido_items_pedido_sesion_id ON pedido_items (pedido_sesion_id);

CREATE TABLE IF NOT EXISTS consultas_master (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    estado TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cerrada_en TIMESTAMPTZ,
    cerrada_por TEXT
);

CREATE TABLE IF NOT EXISTS consultas_detail (
    id BIGSERIAL PRIMARY KEY,
    consulta_id BIGINT NOT NULL REFERENCES consultas_master(id),
    autor_tipo TEXT NOT NULL,
    autor_referencia TEXT NOT NULL,
    contenido TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llamados_mozo (
    id BIGSERIAL PRIMARY KEY,
    mesa_sesion_id BIGINT NOT NULL REFERENCES mesa_sesiones(id),
    estado TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atendida_en TIMESTAMPTZ,
    atendida_por TEXT
);

CREATE INDEX IF NOT EXISTS idx_llamados_mozo_mesa_sesion_id ON llamados_mozo (mesa_sesion_id);
CREATE INDEX IF NOT EXISTS idx_llamados_mozo_estado ON llamados_mozo (estado);

CREATE TABLE IF NOT EXISTS pedidos_cocina (
    id BIGSERIAL PRIMARY KEY,
    pedido_sesion_id BIGINT NOT NULL UNIQUE REFERENCES pedido_sesiones(id),
    estado TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atendida_en TIMESTAMPTZ,
    atendida_por TEXT
);

CREATE TABLE IF NOT EXISTS roles_web_sessions (
    id BIGSERIAL PRIMARY KEY,
    rol TEXT NOT NULL UNIQUE,
    actor_nombre TEXT NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    ultimo_evento_relevante_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eventos_auditoria (
    id BIGSERIAL PRIMARY KEY,
    agregado TEXT NOT NULL,
    agregado_id TEXT NOT NULL,
    evento TEXT NOT NULL,
    actor_tipo TEXT NOT NULL,
    actor_referencia TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuraciones_operativas (clave, valor_texto)
VALUES ('visual_usd_exchange_rate', '1500.00')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO mesas (numero)
SELECT numero
FROM generate_series(1, 10) AS numero
ON CONFLICT (numero) DO NOTHING;

INSERT INTO categorias (titulo, orden)
VALUES
    ('Bebidas', 1),
    ('Cocina', 2),
    ('Postres', 3)
ON CONFLICT (titulo) DO NOTHING;

INSERT INTO productos (categoria_id, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo)
SELECT c.id, datos.titulo, datos.descripcion, datos.precio_ars_centavos, datos.imagen_nombre_archivo, TRUE
FROM (
    VALUES
        ('Bebidas', 'Agua sin gas', 'Botella individual fria.', 250000, NULL),
        ('Bebidas', 'Copa de vino', 'Malbec de la casa.', 480000, NULL),
        ('Cocina', 'Hamburguesa clasica', 'Con papas y alioli.', 1290000, NULL),
        ('Cocina', 'Papas rusticas', 'Porcion para compartir.', 650000, NULL),
        ('Postres', 'Flan casero', 'Con crema o dulce de leche.', 510000, NULL)
) AS datos(categoria_titulo, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo)
JOIN categorias c
    ON c.titulo = datos.categoria_titulo
WHERE NOT EXISTS (
    SELECT 1
    FROM productos p
    WHERE p.titulo = datos.titulo
);
