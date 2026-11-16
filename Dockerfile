# syntax=docker/dockerfile:1

# Imagem base pinada por versão + digest (evita puxar imagem alterada upstream)
ARG IMAGEM_NODE=node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

# ---------- Etapa 1: build ----------
FROM ${IMAGEM_NODE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- Etapa 2: runtime ----------
FROM ${IMAGEM_NODE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Apenas dependências de produção
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Usuário sem privilégio de root (já existe na imagem oficial do Node)
USER node

EXPOSE 3000

# Executa o node diretamente (sem npm) para o SIGTERM chegar à aplicação
CMD ["node", "dist/main.js"]
