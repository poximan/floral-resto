# floral-resto

Sistema para operacion de restobar con carta web para clientes, gestion web interna para mozo y encargado, y app Android de lectura para encargado.

## Componentes

- `resto_server`: stack Docker del server central.
- `resto_app`: app Android conectada por MQTT.
- `docs`: documentacion funcional y tecnica.

## Arquitectura resumida

El server central trabaja con una fuente de verdad unica:

- `web-entrypoint`: entrada web del sistema. Sirve carta y gestion, resuelve rutas invalidas y proxifica `/api` y WebSocket.
- `edge-adapter-tunel`: adapter HTTP minimo y estable para Cloudflare Tunnel. No se buildea; desacopla el tunel de los rebuilds de `web-entrypoint`.
- `http-gw`: borde HTTP/WebSocket para navegadores. No sirve HTML ni toca PostgreSQL.
- `domain`: nucleo de negocio y unico servicio habilitado para leer y escribir PostgreSQL.
- `mqtt-client`: adaptador exclusivo entre el dominio, HiveMQ Cloud y la app Android.
- `postgres`: persistencia unica del sistema.
- `tunel-service`: crea el tunel efimero de Cloudflare y apunta solo a `edge-adapter-tunel`.

## Entradas locales

- Carta: `http://localhost:5175`
- Gestion: `http://localhost:5174`

## Publicacion remota

La exposicion publica usa Cloudflare Tunnel y pasa por `edge-adapter-tunel`, que reenvia a `web-entrypoint` cuando esta disponible.

Rutas publicas previstas:

- `/carta`
- `/gestion`

## Frontends

Los frontends fuente viven en:

- `resto_server/web-entrypoint/web-carta`
- `resto_server/web-entrypoint/web-gestion`

En runtime quedan servidos por `web-entrypoint`; no hay un nginx desplegado por frontend.

## App Android

La app vive en `resto_app` y se conecta exclusivamente por MQTT a HiveMQ Cloud. No usa HTTP.

## Base de datos

PostgreSQL se maneja con snapshot unico de esquema. Si cambia el modelo, la instancia debe recrearse desde cero; no se contemplan migraciones adaptativas en runtime.

`resto_server/postgres/config/001_schema.sql` define estructura, funciones de normalizacion y constraints. No contiene datos de negocio embebidos.

La carga de datos depende de CSV opcionales en `resto_server/postgres/datos`:

- `configuracion_visual.csv`
- `mesas.csv`
- `categorias.csv`
- `subcategorias.csv`
- `productos.csv`

Si un CSV existe, `resto_server/postgres/config/002_seed_csv.sh` lo procesa. Si no existe, la tabla queda sin carga automatica. Las colisiones semanticas de catalogo se comparan con tolerancia `85%`; una fila candidata que coincide con datos ya presentes se descarta.

La carga CSV corre en dos momentos:

- En bases nuevas, Postgres ejecuta `001_schema.sql` y `002_seed_csv.sh` desde `/docker-entrypoint-initdb.d`.
- En cada `docker compose up`, el servicio one-shot `postgres-data-loader` vuelve a ejecutar `002_seed_csv.sh` contra la base ya existente.

Cuando el codigo cambia el esquema, el volumen persistente anterior no se modifica solo. Para aplicar el esquema real definido en `resto_server/postgres/config/001_schema.sql`, recrear el stack desde cero:

```powershell
cd resto_server
docker compose down -v
docker compose up --build
```

El `-v` elimina el volumen `postgres_data`; usarlo solo cuando se acepta descartar la base local actual. Este proyecto no debe resolver cambios de modelo con `ALTER TABLE`.

Si solo cambia nginx o algun frontend web, reconstruir al menos `web-entrypoint`, porque `nginx.conf` y los bundles quedan copiados dentro de la imagen:

```powershell
cd resto_server
docker compose up --build web-entrypoint
```

## Documentacion util

- [Arquitectura detallada](docs/arquitectura_detallada.txt)
- [Pedido v1](docs/pedido%20v1.txt)
- [Diagrama draw.io](docs/arquit.drawio)
