# Floral Resto

Plataforma del restaurante organizada en tres unidades desplegables:

| Carpeta | Responsabilidad |
| --- | --- |
| `resto-server` | Dominio, persistencia, API HTTP/WebSocket, MQTT y frontends. |
| `resto-edge` | Adaptacion del canal Cloudflare, cliente de tunel y observabilidad del producto. |
| `resto-app` | Aplicacion Android conectada por MQTT. |

El ruteo no vive en este repositorio. La unica frontera es `edge-gateway`, en el
proyecto central `servicoop/platform/edge-platform`.

## Arquitectura

```text
Cloudflare
  -> tunnel-client
  -> channel-adapter [Host: floral.internal]
  -> edge-gateway
  -> floral-web-server | floral-admin-dashboard
```

- `tunnel-client` es dueno del proceso Cloudflare y publica `/entrypoint` con la
  URL efimera vigente.
- `channel-adapter` estabiliza el canal, identifica el producto y devuelve una
  respuesta visible si el gateway no esta disponible.
- `edge-gateway` decide rutas a partir de su archivo central `routes.txt`.
- `admin-dashboard` conserva telemetria en memoria y no monta el socket Docker.

## Redes Docker

Los dos stacks del producto comparten `restobar_edge`. Los servicios que deben
alcanzar o ser alcanzados por la frontera central tambien se conectan a
`servicoop-edge-net`.

Crear una sola vez la red interna compartida por los dos stacks de Floral:

```powershell
docker network create restobar_edge
```

`servicoop-edge-net` pertenece a `edge-platform` y se crea al desplegar primero
la plataforma central.

## Puesta en marcha

1. Copiar `resto-server/.env.example` como `resto-server/.env`.
2. Copiar `resto-edge/.env.example` como `resto-edge/.env`.
3. Reemplazar todos los valores marcados para completar.
4. Levantar primero el gateway central, despues `resto-server` y finalmente
   `resto-edge`.

La configuracion no define credenciales funcionales por defecto.

## Rutas publicas

Las reglas con scope `floral.internal` se mantienen en el gateway central:

| Ruta | Destino |
| --- | --- |
| `/` | Redireccion a `/carta`. |
| `/carta` y `/carta/` | `floral-web-server`. |
| `/gestion` y `/gestion/` | `floral-web-server`. |
| `/api/` y `/assets/` | `floral-web-server`. |
| `/admin` y `/admin/` | `floral-admin-dashboard`. |

`/admin` usa autenticacion Basic configurada mediante
`ADMIN_DASHBOARD_USERNAME` y `ADMIN_DASHBOARD_PASSWORD`.

## Persistencia

`resto-server/postgres/config/001_schema.sql` define estructura, funciones de
normalizacion y restricciones. Los CSV opcionales viven en
`resto-server/postgres/datos` y son procesados por `002_seed_csv.sh`.

El esquema y los datos persistentes son responsabilidades distintas: cambiar el
SQL no migra automaticamente un volumen PostgreSQL existente.

## Aplicacion Android

`resto-app` se conecta exclusivamente por MQTT. Para abrir la gestion web,
solicita la URL publica; `mqtt-client` la consulta en
`tunnel-client:/entrypoint`.
