FROM node:22-bookworm-slim

ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) CLOUDFLARED_ARCH="amd64" ;; \
    arm64) CLOUDFLARED_ARCH="arm64" ;; \
    *) echo "Arquitectura no soportada para cloudflared: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CLOUDFLARED_ARCH}" -o /usr/local/bin/cloudflared; \
  chmod +x /usr/local/bin/cloudflared

COPY package.json ./
RUN npm install --omit=dev --no-package-lock

COPY src ./src

CMD ["node", "src/index.js"]
