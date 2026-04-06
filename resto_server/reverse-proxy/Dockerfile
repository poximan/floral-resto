FROM node:22-alpine AS carta-build

WORKDIR /app

COPY web-carta/package.json ./package.json
RUN npm install

COPY web-carta/index.html ./index.html
COPY web-carta/vite.config.js ./vite.config.js
COPY web-carta/src ./src
COPY web-carta/public ./public

ENV VITE_APP_BASE_PATH=/carta/

RUN npm run build

FROM node:22-alpine AS gestion-build

WORKDIR /app

COPY web-gestion/package.json ./package.json
RUN npm install

COPY web-gestion/index.html ./index.html
COPY web-gestion/vite.config.js ./vite.config.js
COPY web-gestion/src ./src
COPY web-gestion/public ./public

ENV VITE_APP_BASE_PATH=/gestion/

RUN npm run build

FROM nginx:1.27-alpine

COPY reverse-proxy/nginx.conf /etc/nginx/conf.d/default.conf
COPY reverse-proxy/not-found-carta.html /usr/share/nginx/html/not-found-carta.html
COPY reverse-proxy/not-found-gestion.html /usr/share/nginx/html/not-found-gestion.html
COPY reverse-proxy/not-found-public.html /usr/share/nginx/html/not-found-public.html
COPY --from=carta-build /app/dist /usr/share/nginx/html/web-carta
COPY --from=gestion-build /app/dist /usr/share/nginx/html/web-gestion
