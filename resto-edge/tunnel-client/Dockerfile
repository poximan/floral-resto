FROM node:22.17.0-bookworm-slim

ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.7.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) CLOUDFLARED_ARCH="amd64"; CLOUDFLARED_SHA256="ec905ea7b7e327ff8abdde8cb64697a2152de74dbcdbf6aec9db8364eb3886cd" ;; \
    arm64) CLOUDFLARED_ARCH="arm64"; CLOUDFLARED_SHA256="405df476437e027fc6d18729a5a77155c0a33a6082aeee60a799a688f3052e66" ;; \
    *) echo "Arquitectura no soportada para cloudflared: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  curl --fail --location --show-error \
    "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${CLOUDFLARED_ARCH}" \
    --output /usr/local/bin/cloudflared; \
  echo "${CLOUDFLARED_SHA256}  /usr/local/bin/cloudflared" | sha256sum --check --strict; \
  chmod 0555 /usr/local/bin/cloudflared

COPY --chown=node:node package.json ./
RUN npm install --omit=dev --no-package-lock \
  && chown -R node:node /app

COPY --chown=node:node src ./src

ENV HOME=/home/node \
    NODE_ENV=production \
    TUNNEL_CLIENT_HOST=0.0.0.0 \
    TUNNEL_CLIENT_PORT=8083 \
    TUNNEL_TARGET_URL=http://channel-adapter:8080

EXPOSE 8083

USER 1000:1000

CMD ["node", "src/index.js"]
