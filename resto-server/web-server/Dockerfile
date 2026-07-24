FROM node:22.17.0-alpine3.22 AS carta-build

WORKDIR /app

COPY web-carta/package.json ./package.json
RUN npm install

COPY web-carta/index.html ./index.html
COPY web-carta/vite.config.js ./vite.config.js
COPY web-carta/src ./src
COPY web-carta/public ./public

ENV VITE_APP_BASE_PATH=/carta/

RUN npm run build

FROM node:22.17.0-alpine3.22 AS gestion-build

WORKDIR /app

COPY web-gestion/package.json ./package.json
RUN npm install

COPY web-gestion/index.html ./index.html
COPY web-gestion/vite.config.js ./vite.config.js
COPY web-gestion/src ./src
COPY web-gestion/public ./public
COPY plugin ./plugin

ENV VITE_APP_BASE_PATH=/gestion/
ENV VITE_MESA_LAYOUT_PLUGIN_DIR=./plugin/mesa-layout

RUN npm run build

FROM nginx:1.28.0-alpine

RUN install -d -o 1000 -g 1000 /tmp/nginx/client_temp /tmp/nginx/proxy_temp \
    /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp

COPY --chown=1000:1000 nginx-main.conf /etc/nginx/nginx.conf
COPY --chown=1000:1000 nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=1000:1000 not-found-carta.html /usr/share/nginx/html/not-found-carta.html
COPY --chown=1000:1000 not-found-gestion.html /usr/share/nginx/html/not-found-gestion.html
COPY --chown=1000:1000 not-found-public.html /usr/share/nginx/html/not-found-public.html
COPY --chown=1000:1000 --from=carta-build /app/dist /usr/share/nginx/html/web-carta
COPY --chown=1000:1000 --from=gestion-build /app/dist /usr/share/nginx/html/web-gestion

EXPOSE 8080 8081

USER 1000:1000

CMD ["nginx", "-g", "daemon off;"]
