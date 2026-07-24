FROM nginx:1.28.0-alpine

ARG APP_UID=1000
ARG APP_GID=1000

RUN addgroup --gid "${APP_GID}" appgroup \
    && adduser --uid "${APP_UID}" --ingroup appgroup --disabled-password --home /home/appuser --shell /bin/sh appuser \
    && install -d -o "${APP_UID}" -g "${APP_GID}" \
        /tmp/nginx/client_temp \
        /tmp/nginx/proxy_temp \
        /tmp/nginx/fastcgi_temp \
        /tmp/nginx/uwsgi_temp \
        /tmp/nginx/scgi_temp

COPY --chown=${APP_UID}:${APP_GID} nginx.conf /etc/nginx/nginx.conf
COPY --chown=${APP_UID}:${APP_GID} edge-unavailable.html /usr/share/nginx/html/edge-unavailable.html

EXPOSE 8080

USER 1000:1000

CMD ["nginx", "-g", "daemon off;"]
