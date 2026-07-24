FROM node:22.17.0-alpine3.22

WORKDIR /app

COPY --chown=node:node package.json ./
RUN npm install

COPY --chown=node:node src ./src

ENV NODE_ENV=production \
    DOMAIN_HOST=0.0.0.0 \
    DOMAIN_PORT=8081

EXPOSE 8081

USER 1000:1000

CMD ["npm", "run", "start"]
