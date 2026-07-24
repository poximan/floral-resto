FROM node:22.17.0-alpine3.22

WORKDIR /app

COPY --chown=node:node package.json ./
RUN npm install

COPY --chown=node:node src ./src

ENV NODE_ENV=production \
    MQTT_CLIENT_HOST=0.0.0.0 \
    MQTT_CLIENT_PORT=8082

EXPOSE 8082

USER 1000:1000

CMD ["npm", "run", "start"]
