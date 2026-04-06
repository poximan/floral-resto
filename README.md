# floral-resto

Sistema para operacion de restobar con carta web para clientes, gestion web interna para mozo y encargado, y app Android de lectura para encargado.

## Componentes

- `resto_server`: stack Docker del server central.
- `resto_app`: app Android conectada por MQTT.
- `docs`: documentacion funcional y tecnica.

## Arquitectura resumida

El server central trabaja con una fuente de verdad unica:

- `reverse-proxy`: unico nginx frontal. Sirve carta y gestion, resuelve rutas invalidas y proxifica `/api` y WebSocket.
- `gateway`: borde HTTP/WebSocket para navegadores. No sirve HTML ni toca PostgreSQL.
- `domain`: nucleo de negocio y unico servicio habilitado para leer y escribir PostgreSQL.
- `mqtt-publisher`: adaptador exclusivo entre el dominio y HiveMQ Cloud para la app Android.
- `postgres`: persistencia unica del sistema.
- `tunel-service`: crea el tunel efimero de Cloudflare y apunta solo a `reverse-proxy`.

## Entradas locales

- Carta: `http://localhost:5173`
- Gestion: `http://localhost:5174`

## Publicacion remota

La exposicion publica usa Cloudflare Tunnel y pasa unicamente por `reverse-proxy`.

Rutas publicas previstas:

- `/carta`
- `/gestion`

## Frontends

Los frontends fuente viven en:

- `resto_server/web-carta`
- `resto_server/web-gestion`

En runtime quedan servidos por `reverse-proxy`; no hay un nginx desplegado por frontend.

## App Android

La app vive en `resto_app` y se conecta exclusivamente por MQTT a HiveMQ Cloud. No usa HTTP.

## Base de datos

PostgreSQL se maneja con snapshot unico de esquema. Si cambia el modelo, la instancia debe recrearse desde cero; no se contemplan migraciones adaptativas en runtime.

## Documentacion util

- [Arquitectura detallada](docs/arquitectura_detallada.txt)
- [Pedido v1](docs/pedido%20v1.txt)
- [Diagrama draw.io](docs/arquit.drawio)
