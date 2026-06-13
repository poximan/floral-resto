# floral-resto

Sistema para operacion de restobar con carta web para clientes, gestion web interna para mozo y encargado, app Android de lectura para encargado y una capa edge separada para exposicion publica.

## Componentes

- `resto_server`: stack Docker del restaurante. Contiene negocio, API, persistencia, MQTT de dominio, assets y frontends carta/gestion.
- `resto_edge`: stack Docker de exposicion publica. Contiene tunel Cloudflare, adapter estable y router publico.
- `resto_app`: app Android conectada por MQTT.
- `docs`: documentacion funcional y tecnica.

## Arquitectura resumida

El server restaurante conserva la fuente de verdad del negocio:

- `web-server`: sirve las SPA `web-carta` y `web-gestion`; proxifica `/api`, `/assets` y WebSocket hacia `http-gw`.
- `http-gw`: borde HTTP/WebSocket del restaurante. No sirve HTML ni toca PostgreSQL.
- `domain`: nucleo de negocio y unico servicio habilitado para leer y escribir PostgreSQL.
- `mqtt-client`: adaptador entre el dominio, HiveMQ Cloud y la app Android. Consulta `tunel-service` solo para obtener la URL publica vigente.
- `postgres`: persistencia unica del sistema.

El edge publica y enruta sin conocer reglas de negocio:

- `tunel-service`: crea el tunel efimero de Cloudflare y expone internamente `/entrypoint` con la URL vigente.
- `edge-adapter-tunel`: adapter HTTP minimo y estable para Cloudflare Tunnel. No se buildea; apunta a `public-router`.
- `public-router`: decide rutas publicas. Hoy `/carta`, `/gestion`, `/api` y `/assets` van al `web-server`; cualquier otra ruta queda fuera del restaurante y responde 404 hasta que exista otro servicio.
- `admin-dashboard`: dashboard publico de solo lectura para operacion tecnica del edge. No monta Docker socket, no persiste datos y no ejecuta acciones sobre contenedores.

Ambos stacks se conectan por la red Docker externa `restobar_edge`.

## Entradas locales

- Carta directa al server: `http://localhost:5175`
- Gestion directa al server: `http://localhost:5174`
- Entrada publica local del edge: `http://localhost:8088`

## Arranque

Crear una vez la red compartida:

```powershell
docker network create restobar_edge
```

Levantar el server restaurante:

```powershell
cd resto_server
docker compose up --build
```

Levantar el edge publico:

```powershell
cd resto_edge
docker compose up --build
```

## Publicacion remota

La exposicion publica usa Cloudflare Tunnel:

```text
Cloudflare -> tunel-service -> edge-adapter-tunel -> public-router -> web-server
```

Rutas publicas del restaurante:

- `/carta`
- `/gestion`
- `/api`
- `/assets`

Ruta publica de administracion tecnica:

- `/admin`

`/admin` usa autenticacion Basic. Las credenciales por defecto del entorno local son `admin` / `supersecreta`; pueden cambiarse en `resto_edge/.env` con `ADMIN_DASHBOARD_USERNAME` y `ADMIN_DASHBOARD_PASSWORD`.

El dashboard recibe logs JSON de `public-router` por syslog UDP y mantiene solo memoria de la sesion vigente del contenedor. Si `admin-dashboard` se reinicia, se pierde el historico observado. Para minimizar riesgo operativo, no se monta `/var/run/docker.sock`; por eso muestra salud HTTP de servicios accesibles, metricas de la VM Linux visible desde Docker y metricas del propio contenedor `admin-dashboard`, pero no consumo CPU/RAM individual de cada contenedor.

Rutas futuras ajenas al restaurante, por ejemplo un proveedor de APKs, deben agregarse en `resto_edge/public-router` y apuntar a su propio servicio.

## Frontends

Los frontends fuente viven en:

- `resto_server/web-server/web-carta`
- `resto_server/web-server/web-gestion`

En runtime quedan servidos por `web-server`; no hay un contenedor independiente por frontend.

## App Android

La app vive en `resto_app` y se conecta exclusivamente por MQTT a HiveMQ Cloud. No usa HTTP directo contra el server. Para abrir gestion web, solicita por MQTT la URL publica vigente; `mqtt-client` la obtiene desde `tunel-service`.

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

PostgreSQL solo ejecuta `001_schema.sql` durante la creacion inicial del volumen. La carga CSV corre despues mediante el servicio one-shot `postgres-data-loader`, una vez que PostgreSQL esta listo. Ese loader se ejecuta en cada `docker compose up` y descarta filas ya cargadas por comparacion semantica.

Cuando el codigo cambia el esquema, el volumen persistente anterior no se modifica solo. Para aplicar el esquema real definido en `resto_server/postgres/config/001_schema.sql`, recrear el stack desde cero:

```powershell
cd resto_server
docker compose down -v
docker compose up --build
```

El `-v` elimina el volumen `postgres_data`; usarlo solo cuando se acepta descartar la base local actual. Este proyecto no debe resolver cambios de modelo con `ALTER TABLE`.

Si solo cambia nginx o algun frontend web, reconstruir al menos `web-server`, porque `nginx.conf` y los bundles quedan copiados dentro de la imagen:

```powershell
cd resto_server
docker compose up --build web-server
```

## Documentacion util

- [Pedido v1](docs/pedido%20v1.txt)
- [Diagrama draw.io](docs/arquit.drawio)
