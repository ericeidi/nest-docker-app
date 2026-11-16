#!/usr/bin/env bash
# Diagnóstico em camadas da conexão API (NestJS) -> PostgreSQL na rede Docker.
# Para na primeira camada que falhar e indica a causa provável.
# Uso: ./scripts/diagnosticar-conexao.sh   (rodar na raiz do projeto)

set -uo pipefail
cd "$(dirname "$0")/.."

SERVICO_API="api"
SERVICO_BANCO="postgres"
CONTAINER_API="nest-docker-app"
CONTAINER_BANCO="nest-docker-postgres"
REDE_DOCKER="nest-net"

VERDE=$'\e[32m'; VERMELHO=$'\e[31m'; AMARELO=$'\e[33m'; NEGRITO=$'\e[1m'; RESET=$'\e[0m'

etapa()  { printf '\n%s[%s] %s%s\n' "$NEGRITO" "$1" "$2" "$RESET"; }
ok()     { printf '  %s✔ %s%s\n' "$VERDE" "$1" "$RESET"; }
aviso()  { printf '  %s! %s%s\n' "$AMARELO" "$1" "$RESET"; }
falhar() {
  printf '  %s✘ %s%s\n' "$VERMELHO" "$1" "$RESET"
  printf '  %s→ Causa provável:%s %s\n' "$NEGRITO" "$RESET" "$2"
  printf '  %s→ Como corrigir:%s %s\n' "$NEGRITO" "$RESET" "$3"
  exit 1
}

# Lê variável do ambiente REAL do container da API (o que a aplicação enxerga)
variavel_api() { docker exec "$CONTAINER_API" printenv "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------
etapa 1 "Containers rodando e saudáveis"
for nomeContainer in "$CONTAINER_BANCO" "$CONTAINER_API"; do
  estadoContainer=$(docker inspect --format '{{.State.Status}}' "$nomeContainer" 2>/dev/null)
  saudeContainer=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}' "$nomeContainer" 2>/dev/null)
  if [ "$estadoContainer" != "running" ]; then
    falhar "$nomeContainer está '${estadoContainer:-inexistente}'" \
      "container parado, com erro na inicialização ou nunca criado" \
      "docker compose up -d   e veja: docker compose logs $([ "$nomeContainer" = "$CONTAINER_API" ] && echo $SERVICO_API || echo $SERVICO_BANCO)"
  fi
  if [ "$saudeContainer" = "healthy" ]; then ok "$nomeContainer: running ($saudeContainer)"; else aviso "$nomeContainer: running ($saudeContainer)"; fi
done

# ---------------------------------------------------------------------------
etapa 2 "Ambos na mesma rede Docker ($REDE_DOCKER)"
for nomeContainer in "$CONTAINER_API" "$CONTAINER_BANCO"; do
  redesContainer=$(docker inspect --format '{{range $nome, $_ := .NetworkSettings.Networks}}{{$nome}} {{end}}' "$nomeContainer")
  if [[ " $redesContainer " != *" $REDE_DOCKER "* ]]; then
    falhar "$nomeContainer não está na rede $REDE_DOCKER (redes: ${redesContainer:-nenhuma})" \
      "containers em redes diferentes não se enxergam — o DNS interno só resolve nomes da mesma rede" \
      "adicione 'networks: [$REDE_DOCKER]' ao serviço no docker-compose.yml e rode docker compose up -d"
  fi
  ok "$nomeContainer → $redesContainer"
done

# ---------------------------------------------------------------------------
etapa 3 "Variáveis de conexão dentro da API"
hostBanco=$(variavel_api DB_HOST); portaBanco=$(variavel_api DB_PORT)
usuarioBanco=$(variavel_api DB_USER); nomeBanco=$(variavel_api DB_NAME)
for nomeVariavel in DB_HOST DB_PORT DB_USER DB_NAME; do
  [ -z "$(variavel_api "$nomeVariavel")" ] && falhar "$nomeVariavel vazia no container da API" \
    "variável ausente no .env.api ou container não foi recriado após alterar o .env.api" \
    "confira o .env.api e rode docker compose up -d (restart NÃO relê o env_file)"
done
# Senha: Docker secret (DB_PASSWORD_FILE) com fallback para DB_PASSWORD — nunca exibida
arquivoSenha=$(variavel_api DB_PASSWORD_FILE)
if [ -n "$arquivoSenha" ]; then
  senhaBanco=$(docker exec "$CONTAINER_API" cat "$arquivoSenha" 2>/dev/null)
  [ -z "$senhaBanco" ] && falhar "secret $arquivoSenha ausente, vazio ou ilegível na API" \
    "arquivo secrets/db_password.txt não existe/está vazio, ou o serviço api não declara 'secrets: [db_password]'" \
    "crie secrets/db_password.txt (sem quebra de linha extra) e rode docker compose up -d"
  origemSenha="secret $arquivoSenha"
else
  senhaBanco=$(variavel_api DB_PASSWORD)
  [ -z "$senhaBanco" ] && falhar "nem DB_PASSWORD_FILE nem DB_PASSWORD definidos na API" \
    "senha do banco não configurada" "configure o secret db_password no docker-compose.yml"
  origemSenha="variável DB_PASSWORD"
fi
ok "DB_HOST=$hostBanco DB_PORT=$portaBanco DB_USER=$usuarioBanco DB_NAME=$nomeBanco senha=(oculta, via $origemSenha)"
if [ "$hostBanco" = "localhost" ] || [ "$hostBanco" = "127.0.0.1" ]; then
  falhar "DB_HOST=$hostBanco" \
    "dentro do container, localhost é o PRÓPRIO container da API — o Postgres está em outro container" \
    "use DB_HOST=$SERVICO_BANCO (nome do serviço no compose) e rode docker compose up -d"
fi

# ---------------------------------------------------------------------------
etapa 4 "DNS: '$hostBanco' resolve a partir da API"
ipResolvido=$(docker exec "$CONTAINER_API" getent hosts "$hostBanco" | awk '{print $1}')
if [ -z "$ipResolvido" ]; then
  falhar "nome '$hostBanco' não resolve (equivale a ENOTFOUND / getaddrinfo EAI_AGAIN no Node)" \
    "DB_HOST com nome errado, serviço do banco removido ou em outra rede" \
    "DB_HOST deve ser o nome do serviço ('$SERVICO_BANCO'); confira: docker network inspect $REDE_DOCKER"
fi
ipBanco=$(docker inspect --format "{{(index .NetworkSettings.Networks \"$REDE_DOCKER\").IPAddress}}" "$CONTAINER_BANCO" 2>/dev/null)
ok "$hostBanco → $ipResolvido (IP do $CONTAINER_BANCO na rede: ${ipBanco:-?})"

# ---------------------------------------------------------------------------
etapa 5 "TCP: porta $portaBanco aberta em $hostBanco"
if ! docker exec "$CONTAINER_API" nc -z -w 3 "$hostBanco" "$portaBanco" 2>/dev/null; then
  falhar "porta $portaBanco fechada/inalcançável (equivale a ECONNREFUSED ou ETIMEDOUT no Node)" \
    "Postgres ainda subindo, travado, ou DB_PORT errada (porta INTERNA do container é 5432, não a publicada no Mac)" \
    "docker compose logs $SERVICO_BANCO --tail 50"
fi
ok "conexão TCP aceita"

# ---------------------------------------------------------------------------
etapa 6 "Postgres aceitando conexões (pg_isready)"
if ! saidaPgIsready=$(docker exec "$CONTAINER_BANCO" pg_isready -h "$hostBanco" -p "$portaBanco" 2>&1); then
  falhar "$saidaPgIsready" "servidor em startup/recovery ou sobrecarregado" "docker compose logs $SERVICO_BANCO --tail 50"
fi
ok "$saidaPgIsready"

# ---------------------------------------------------------------------------
etapa 7 "Autenticação e banco com as credenciais da API (SELECT 1 via TCP)"
if ! saidaPsql=$(docker exec -e PGPASSWORD="$senhaBanco" "$CONTAINER_BANCO" \
    psql -h "$hostBanco" -p "$portaBanco" -U "$usuarioBanco" -d "$nomeBanco" -tAc 'SELECT 1' 2>&1); then
  if [[ "$saidaPsql" == *"password authentication failed"* ]]; then
    falhar "senha recusada para o usuário '$usuarioBanco'" \
      "secrets/db_password.txt diferente da senha da role no banco" \
      "sincronize a senha rodando: docker compose exec postgres /docker-entrypoint-initdb.d/01-criar-role-app.sh"
  elif [[ "$saidaPsql" == *"does not exist"* ]]; then
    falhar "$saidaPsql" "DB_NAME ou DB_USER não existem no servidor" \
      "alinhe DB_USER/DB_NAME (.env.api) com APP_DB_USER/POSTGRES_DB (.env.postgres) e rode: docker compose exec postgres /docker-entrypoint-initdb.d/01-criar-role-app.sh"
  else
    falhar "$saidaPsql" "erro de conexão no nível do Postgres" "docker compose logs $SERVICO_BANCO --tail 50"
  fi
fi
ok "SELECT 1 → $saidaPsql"
roleEhSuperuser=$(docker exec -e PGPASSWORD="$senhaBanco" "$CONTAINER_BANCO" \
  psql -h "$hostBanco" -p "$portaBanco" -U "$usuarioBanco" -d "$nomeBanco" -tAc 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' 2>/dev/null)
if [ "$roleEhSuperuser" = "t" ]; then
  aviso "role '$usuarioBanco' é SUPERUSER — a API deve usar role com privilégios mínimos (ver DOCKER.md → Roles do banco)"
else
  ok "role '$usuarioBanco' sem superuser (privilégios mínimos)"
fi

# ---------------------------------------------------------------------------
etapa 8 "Aplicação: /health/db e logs do TypeORM"
portaApi=$(variavel_api PORT); portaApi=${portaApi:-3000}
respostaHealth=$(docker exec "$CONTAINER_API" wget -qO- "http://127.0.0.1:$portaApi/health/db" 2>&1)
if [[ "$respostaHealth" != *'"status":"ok"'* ]]; then
  falhar "/health/db falhou: ${respostaHealth:-sem resposta}" \
    "infra OK, mas o pool da aplicação não conectou (credenciais antigas em memória ou retries esgotados)" \
    "docker compose restart $SERVICO_API  e veja: docker compose logs $SERVICO_API | grep -i typeorm"
fi
ok "/health/db → $respostaHealth"
errosTypeorm=$(docker logs --since 10m "$CONTAINER_API" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -iE 'Unable to connect|TypeOrmModule.*error' | tail -3)
if [ -n "$errosTypeorm" ]; then aviso "erros de conexão nos últimos 10 min:"; printf '      %s\n' "$errosTypeorm"; else ok "nenhum erro de conexão TypeORM nos últimos 10 min"; fi

printf '\n%s%s✔ Conexão API → PostgreSQL saudável em todas as camadas.%s\n' "$VERDE" "$NEGRITO" "$RESET"
