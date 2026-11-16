# syntax=docker/dockerfile:1

# Imagens base pinadas por versão + digest (evita puxar imagem alterada upstream)
# IMAGEM_NODE: usada para build e como fonte do binário node.
# IMAGEM_RUNTIME: mesmo Alpine (3.24.4) da imagem do Node — sem npm, yarn e corepack.
ARG IMAGEM_NODE=node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ARG IMAGEM_RUNTIME=alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

# ---------- Etapa 1: dependências de produção ----------
FROM ${IMAGEM_NODE} AS deps-producao
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: nenhum script de instalação de terceiros roda no build
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

# ---------- Etapa 2: build ----------
FROM ${IMAGEM_NODE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- Etapa 3: runtime ----------
FROM ${IMAGEM_RUNTIME} AS runtime

# Bibliotecas exigidas pelo binário node (verificado com ldd) + usuário não-root uid 1000
RUN apk add --no-cache libstdc++ libgcc \
    && addgroup -g 1000 node \
    && adduser -u 1000 -G node -s /sbin/nologin -D node

# Apenas o binário node — sem npm/yarn/corepack (não usados em runtime)
COPY --from=build /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps-producao --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

EXPOSE 3000

# Health check embutido na imagem (vale mesmo fora do docker-compose); usa node, não wget
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Executa o node diretamente (sem npm) para o SIGTERM chegar à aplicação
CMD ["node", "dist/main.js"]
