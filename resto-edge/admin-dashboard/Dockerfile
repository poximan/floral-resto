FROM node:22.17.0-alpine3.22

WORKDIR /app

COPY --chown=node:node package.json ./
RUN npm install --omit=dev --no-package-lock \
  && chown -R node:node /app

COPY --chown=node:node src ./src

ENV HOME=/home/node \
    NODE_ENV=production \
    ADMIN_DASHBOARD_HOST=0.0.0.0 \
    ADMIN_DASHBOARD_PORT=8084 \
    ADMIN_SYSLOG_HOST=0.0.0.0 \
    ADMIN_SYSLOG_PORT=5514 \
    ADMIN_SESSION_IDLE_CLOSE_MS=120000

EXPOSE 8084 5514/udp

USER 1000:1000

CMD ["node", "src/index.js"]
