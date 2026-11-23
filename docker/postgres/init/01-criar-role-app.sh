#!/usr/bin/env bash
# Cria/atualiza a role da aplicação com privilégios mínimos (sem superuser).
#
# Execução automática: montado em /docker-entrypoint-initdb.d/ — roda só na PRIMEIRA
# criação do volume, como POSTGRES_USER (admin).
# Execução manual (volume já existente, idempotente):
#   docker compose exec postgres /docker-entrypoint-initdb.d/01-criar-role-app.sh
#
# Variáveis esperadas no container:
#   POSTGRES_USER / POSTGRES_DB  → admin e banco (já definidos pela imagem)
#   APP_DB_USER                  → nome da role da aplicação
#   APP_DB_PASSWORD_FILE         → arquivo com a senha da role (Docker secret)

set -euo pipefail

: "${APP_DB_USER:?APP_DB_USER não definido}"
: "${APP_DB_PASSWORD_FILE:?APP_DB_PASSWORD_FILE não definido}"

# Senha lida do secret e passada ao psql por variável de ambiente (\getenv),
# nunca por argumento de linha de comando
APP_DB_PASSWORD="$(tr -d '\n' < "$APP_DB_PASSWORD_FILE")"
[ -n "$APP_DB_PASSWORD" ] || { echo "Secret vazio: $APP_DB_PASSWORD_FILE" >&2; exit 1; }
export APP_DB_PASSWORD

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v usuario_app="$APP_DB_USER" -v banco="$POSTGRES_DB" <<'SQL'
\getenv senha_app APP_DB_PASSWORD

-- Cria a role se não existir
SELECT format('CREATE ROLE %I LOGIN', :'usuario_app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usuario_app')
\gexec

-- Garante atributos mínimos e sincroniza a senha com o secret
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'usuario_app', :'senha_app')
\gexec

-- Só quem recebe CONNECT explícito acessa o banco
REVOKE CONNECT ON DATABASE :"banco" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"banco" TO :"usuario_app";

-- Schema public: usar e criar objetos (necessário para migrations)
GRANT USAGE, CREATE ON SCHEMA public TO :"usuario_app";

-- Criar schemas no banco: a migration do @nestjs/outbox executa
-- CREATE SCHEMA IF NOT EXISTS nest_outbox (exige CREATE no banco mesmo se o schema já existir)
GRANT CREATE ON DATABASE :"banco" TO :"usuario_app";
SQL

echo "Role '$APP_DB_USER' pronta (sem superuser) no banco '$POSTGRES_DB'."
