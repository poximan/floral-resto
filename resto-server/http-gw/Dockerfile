FROM node:22.17.0-alpine3.22

WORKDIR /app

COPY --chown=node:node package.json ./
RUN npm install

COPY --chown=node:node src ./src

ENV NODE_ENV=production \
    HTTP_GW_HOST=0.0.0.0 \
    HTTP_GW_PORT=8080

EXPOSE 8080

USER 1000:1000

CMD ["npm", "run", "start"]
