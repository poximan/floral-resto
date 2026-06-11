#!/bin/sh
set -eu

POSTGRES_PORT_VALUE="${POSTGRES_PORT:-5432}"
SEED_DIR="${CSV_DATA_DIR:-/postgres-datos}"
SIMILARITY_THRESHOLD="0.85"

if [ -n "${POSTGRES_HOST:-}" ]; then
  echo "seed-csv: esperando postgres en $POSTGRES_HOST:$POSTGRES_PORT_VALUE"
  until pg_isready --host "$POSTGRES_HOST" --port "$POSTGRES_PORT_VALUE" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 1
  done
  PSQL="psql -v ON_ERROR_STOP=1 --host \"$POSTGRES_HOST\" --port \"$POSTGRES_PORT_VALUE\" --username \"$POSTGRES_USER\" --dbname \"$POSTGRES_DB\""
else
  PSQL="psql -v ON_ERROR_STOP=1 --username \"$POSTGRES_USER\" --dbname \"$POSTGRES_DB\""
fi

run_seed() {
  eval "$PSQL" <<SQL
$1
SQL
}

echo "seed-csv: usando directorio $SEED_DIR"

if [ -f "$SEED_DIR/configuracion_visual.csv" ]; then
  echo "seed-csv: cargando configuracion_visual.csv"
  run_seed "
    CREATE TEMP TABLE seed_configuracion_visual (
      id SMALLINT,
      usd_exchange_rate NUMERIC(12, 2)
    );

    \\copy seed_configuracion_visual (id, usd_exchange_rate) FROM '$SEED_DIR/configuracion_visual.csv' WITH (FORMAT csv, HEADER true)

    INSERT INTO configuracion_visual (id, usd_exchange_rate)
    SELECT id, usd_exchange_rate
    FROM seed_configuracion_visual
    ON CONFLICT (id) DO NOTHING;
  "
else
  echo "seed-csv: configuracion_visual.csv ausente, configuracion_visual queda vacia"
fi

if [ -f "$SEED_DIR/mesas.csv" ]; then
  echo "seed-csv: cargando mesas.csv"
  run_seed "
    CREATE TEMP TABLE seed_mesas (
      nombre TEXT
    );

    \\copy seed_mesas (nombre) FROM '$SEED_DIR/mesas.csv' WITH (FORMAT csv, HEADER true)

    WITH candidates AS (
      SELECT DISTINCT ON (restobar_catalog_key(nombre))
        restobar_text_under(nombre) AS nombre
      FROM seed_mesas
      WHERE LENGTH(BTRIM(COALESCE(nombre, ''))) > 0
      ORDER BY restobar_catalog_key(nombre), nombre
    )
    INSERT INTO mesas (nombre)
    SELECT c.nombre
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM mesas m
      WHERE restobar_catalog_similarity(m.nombre, c.nombre) >= $SIMILARITY_THRESHOLD
    );
  "
else
  echo "seed-csv: mesas.csv ausente, mesas queda vacia"
fi

if [ -f "$SEED_DIR/categorias.csv" ]; then
  echo "seed-csv: cargando categorias.csv"
  run_seed "
    CREATE TEMP TABLE seed_categorias (
      titulo TEXT,
      orden INTEGER,
      activa BOOLEAN
    );

    \\copy seed_categorias (titulo, orden, activa) FROM '$SEED_DIR/categorias.csv' WITH (FORMAT csv, HEADER true)

    WITH candidates AS (
      SELECT DISTINCT ON (restobar_catalog_key(titulo))
        restobar_text_under(titulo) AS titulo,
        orden,
        COALESCE(activa, TRUE) AS activa
      FROM seed_categorias
      WHERE LENGTH(BTRIM(COALESCE(titulo, ''))) > 0
      ORDER BY restobar_catalog_key(titulo), orden
    )
    INSERT INTO categorias (titulo, orden, activa)
    SELECT c.titulo, c.orden, c.activa
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM categorias existente
      WHERE restobar_catalog_similarity(existente.titulo, c.titulo) >= $SIMILARITY_THRESHOLD
    );
  "
else
  echo "seed-csv: categorias.csv ausente, categorias queda vacia"
fi

if [ -f "$SEED_DIR/subcategorias.csv" ]; then
  echo "seed-csv: cargando subcategorias.csv"
  run_seed "
    CREATE TEMP TABLE seed_subcategorias (
      categoria_titulo TEXT,
      titulo TEXT,
      orden INTEGER,
      activa BOOLEAN
    );

    \\copy seed_subcategorias (categoria_titulo, titulo, orden, activa) FROM '$SEED_DIR/subcategorias.csv' WITH (FORMAT csv, HEADER true)

    DO \$\$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM seed_subcategorias s
        WHERE NOT EXISTS (
          SELECT 1
          FROM categorias c
          WHERE restobar_catalog_similarity(c.titulo, s.categoria_titulo) >= $SIMILARITY_THRESHOLD
        )
      ) THEN
        RAISE EXCEPTION 'subcategorias.csv referencia categorias inexistentes';
      END IF;
    END
    \$\$;

    WITH candidates AS (
      SELECT DISTINCT ON (restobar_catalog_key(s.titulo))
        c.id AS categoria_id,
        restobar_text_under(s.titulo) AS titulo,
        s.orden,
        COALESCE(s.activa, TRUE) AS activa
      FROM seed_subcategorias s
      JOIN categorias c
        ON restobar_catalog_similarity(c.titulo, s.categoria_titulo) >= $SIMILARITY_THRESHOLD
      WHERE LENGTH(BTRIM(COALESCE(s.titulo, ''))) > 0
      ORDER BY restobar_catalog_key(s.titulo), s.orden
    )
    INSERT INTO subcategorias (categoria_id, titulo, orden, activa)
    SELECT c.categoria_id, c.titulo, c.orden, c.activa
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM subcategorias existente
      WHERE restobar_catalog_similarity(existente.titulo, c.titulo) >= $SIMILARITY_THRESHOLD
    );
  "
else
  echo "seed-csv: subcategorias.csv ausente, subcategorias queda vacia"
fi

if [ -f "$SEED_DIR/productos.csv" ]; then
  echo "seed-csv: cargando productos.csv"
  run_seed "
    CREATE TEMP TABLE seed_productos (
      subcategoria_titulo TEXT,
      titulo TEXT,
      descripcion TEXT,
      precio_ars_centavos BIGINT,
      imagen_nombre_archivo TEXT,
      activo BOOLEAN
    );

    \\copy seed_productos (subcategoria_titulo, titulo, descripcion, precio_ars_centavos, imagen_nombre_archivo, activo) FROM '$SEED_DIR/productos.csv' WITH (FORMAT csv, HEADER true)

    DO \$\$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM seed_productos s
        WHERE NOT EXISTS (
          SELECT 1
          FROM subcategorias sc
          WHERE restobar_catalog_similarity(sc.titulo, s.subcategoria_titulo) >= $SIMILARITY_THRESHOLD
        )
      ) THEN
        RAISE EXCEPTION 'productos.csv referencia subcategorias inexistentes';
      END IF;
    END
    \$\$;

    WITH candidates AS (
      SELECT DISTINCT ON (restobar_catalog_key(s.titulo))
        sc.id AS subcategoria_id,
        BTRIM(s.titulo) AS titulo,
        restobar_text_under(s.descripcion) AS descripcion,
        s.precio_ars_centavos,
        NULLIF(restobar_text_under(s.imagen_nombre_archivo), '') AS imagen_nombre_archivo,
        COALESCE(s.activo, TRUE) AS activo
      FROM seed_productos s
      JOIN subcategorias sc
        ON restobar_catalog_similarity(sc.titulo, s.subcategoria_titulo) >= $SIMILARITY_THRESHOLD
      WHERE LENGTH(BTRIM(COALESCE(s.titulo, ''))) > 0
      ORDER BY restobar_catalog_key(s.titulo), s.titulo
    )
    INSERT INTO productos (
      subcategoria_id,
      titulo,
      descripcion,
      precio_ars_centavos,
      imagen_nombre_archivo,
      activo
    )
    SELECT
      c.subcategoria_id,
      c.titulo,
      c.descripcion,
      c.precio_ars_centavos,
      c.imagen_nombre_archivo,
      c.activo
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM productos existente
      WHERE restobar_catalog_similarity(existente.titulo, c.titulo) >= $SIMILARITY_THRESHOLD
    );
  "
else
  echo "seed-csv: productos.csv ausente, productos queda vacia"
fi

echo "seed-csv: resumen final"
run_seed "
  SELECT 'configuracion_visual' AS tabla, COUNT(*) AS filas FROM configuracion_visual
  UNION ALL SELECT 'mesas', COUNT(*) FROM mesas
  UNION ALL SELECT 'categorias', COUNT(*) FROM categorias
  UNION ALL SELECT 'subcategorias', COUNT(*) FROM subcategorias
  UNION ALL SELECT 'productos', COUNT(*) FROM productos
  ORDER BY tabla;
"
