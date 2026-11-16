#!/usr/bin/env bash
# Valida que os dados do PostgreSQL sobrevivem à recriação dos containers.
# Fluxo: grava marcador → docker compose down (SEM -v) → up -d → lê marcador → limpa.
# Uso: ./scripts/validar-persistencia.sh   (rodar na raiz do projeto)

set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER_BANCO="nest-docker-postgres"
VOLUME_BANCO="nest-docker-postgres-data"
REDE_DOCKER="nest-net"
TABELA_TESTE="teste_persistencia"

VERDE=$'\e[32m'; VERMELHO=$'\e[31m'; NEGRITO=$'\e[1m'; RESET=$'\e[0m'
etapa() { printf '\n%s[%s] %s%s\n' "$NEGRITO" "$1" "$2" "$RESET"; }
ok()    { printf '  %s✔ %s%s\n' "$VERDE" "$1" "$RESET"; }
falhar(){ printf '  %s✘ %s%s\n' "$VERMELHO" "$1" "$RESET"; exit 1; }

# Executa SQL como o usuário administrador, via socket local dentro do container
executar_sql() {
  docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<<"$1"
}

aguardar_saudavel() {
  local nomeContainer="$1"
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$nomeContainer" 2>/dev/null)" = "healthy" ] && return 0
    sleep 2
  done
  falhar "$nomeContainer não ficou healthy em 60s"
}

identificar_container() {
  docker inspect --format "{{.Id}} {{(index .NetworkSettings.Networks \"$REDE_DOCKER\").IPAddress}}" "$CONTAINER_BANCO" | cut -c1-12,65-
}

# ---------------------------------------------------------------------------
etapa 1 "Gravar marcador"
aguardar_saudavel "$CONTAINER_BANCO"
marcadorGravado="persistencia-$(date +%Y%m%d%H%M%S)-$RANDOM"
executar_sql "CREATE TABLE IF NOT EXISTS $TABELA_TESTE (id serial PRIMARY KEY, marcador text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now());
INSERT INTO $TABELA_TESTE (marcador) VALUES ('$marcadorGravado');" >/dev/null
read -r idContainerAntes ipContainerAntes <<<"$(identificar_container)"
ok "marcador: $marcadorGravado"
ok "container antes: id=$idContainerAntes ip=$ipContainerAntes"

# ---------------------------------------------------------------------------
etapa 2 "Destruir containers mantendo o volume (docker compose down, SEM -v)"
docker compose down >/dev/null 2>&1
docker inspect "$CONTAINER_BANCO" >/dev/null 2>&1 && falhar "container ainda existe após down"
ok "containers removidos"
docker volume inspect "$VOLUME_BANCO" >/dev/null 2>&1 || falhar "volume $VOLUME_BANCO sumiu"
ok "volume $VOLUME_BANCO preservado"

# ---------------------------------------------------------------------------
etapa 3 "Recriar tudo (docker compose up -d)"
docker compose up -d >/dev/null 2>&1
aguardar_saudavel "$CONTAINER_BANCO"
aguardar_saudavel "nest-docker-app"
read -r idContainerDepois ipContainerDepois <<<"$(identificar_container)"
ok "container depois: id=$idContainerDepois ip=$ipContainerDepois"
[ "$idContainerAntes" != "$idContainerDepois" ] || falhar "ID do container não mudou — não houve recriação"
ok "container é NOVO (ID diferente)"

# ---------------------------------------------------------------------------
etapa 4 "Ler marcador no container novo"
marcadorLido=$(executar_sql "SELECT marcador FROM $TABELA_TESTE WHERE marcador = '$marcadorGravado';")
[ "$marcadorLido" = "$marcadorGravado" ] || falhar "marcador NÃO encontrado após recriação — dados perdidos"
ok "marcador encontrado: $marcadorLido"
respostaHealth=$(curl -s "http://localhost:${HOST_PORT:-3000}/health/db")
[[ "$respostaHealth" == *'"status":"ok"'* ]] || falhar "/health/db falhou: $respostaHealth"
ok "API reconectou: /health/db ok"

# ---------------------------------------------------------------------------
etapa 5 "Limpar tabela de teste"
executar_sql "DROP TABLE $TABELA_TESTE;" >/dev/null
ok "tabela $TABELA_TESTE removida"

printf '\n%s%s✔ Persistência validada: dados sobreviveram à recriação dos containers.%s\n' "$VERDE" "$NEGRITO" "$RESET"
