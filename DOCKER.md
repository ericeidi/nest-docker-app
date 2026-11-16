# nest-docker-app — Guia Docker

Aplicação NestJS 12 + PostgreSQL 18 rodando via Docker Compose (runtime: OrbStack).

- URL: http://localhost:3000 (porta definida por `HOST_PORT` no `.env`)
- Liveness: http://localhost:3000/health · Readiness (banco): http://localhost:3000/health/db
- Serviço `api` · Container `nest-docker-app` · Imagem `nest-docker-app:local`
- Serviço `postgres` · Container `nest-docker-postgres` · Volume `nest-docker-postgres-data`
- Rede: `nest-net` (bridge)

## Primeira execução

```bash
cp .env.example .env                    # variáveis do compose
cp .env.api.example .env.api            # variáveis da API
cp .env.postgres.example .env.postgres  # variáveis do Postgres
mkdir -p secrets
openssl rand -hex 16 | tr -d '\n' > secrets/db_password.txt              # senha da role da aplicação
openssl rand -hex 16 | tr -d '\n' > secrets/postgres_admin_password.txt  # senha do superuser
chmod 600 secrets/*.txt
docker compose up -d --build  # build da imagem + sobe o container em background
docker compose ps             # STATUS deve ficar "(healthy)"
curl http://localhost:3000/health
```

## Variáveis de ambiente

Cada container recebe **somente** as próprias variáveis:

```
.env           → docker-compose (interpolação do YAML)  → nenhum container
.env.api       → env_file do serviço api                 → só a API
.env.postgres  → env_file do serviço postgres            → só o Postgres
```

| Arquivo | Variável | Uso |
|---|---|---|
| `.env` | `HOST_PORT` | Porta exposta na sua máquina (`HOST_PORT:3000`) |
| `.env.api` | `NODE_ENV` | Ambiente da aplicação |
| `.env.api` | `PORT` | Porta interna do Nest — **mantenha 3000** (fixa no mapeamento) |
| `.env.api` | `APP_NAME` | Exemplo de variável lida via `ConfigService` |
| `.env.api` | `DB_HOST` | Host do banco **visto pela API** = nome do serviço (`postgres`). Nunca `localhost` |
| `.env.api` | `DB_PORT` | Porta **interna** do Postgres (`5432`) |
| `.env.api` | `DB_USER` / `DB_NAME` | Credenciais usadas pela API (TypeORM) |
| `.env.api` | `CORS_ORIGINS` | Origens liberadas para CORS (vírgula). Vazio = nenhuma |
| `.env.api` | `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | Rate limit: máx. `LIMIT` requisições por IP a cada `TTL_MS` (padrão 100/60000) |
| `.env.postgres` | `POSTGRES_USER` / `POSTGRES_DB` | Superuser admin (`postgres_admin`) e banco — **só na primeira criação do volume** |
| `.env.postgres` | `APP_DB_USER` | Role da aplicação (`nest_app`) criada pelo script de init. Deve bater com `DB_USER` |
| `secrets/db_password.txt` | — | Senha da role da aplicação (Docker secret) |
| `secrets/postgres_admin_password.txt` | — | Senha do superuser (Docker secret) — **só o container do banco recebe** |

### Senhas: Docker secrets

```
secrets/db_password.txt ─────────────► /run/secrets/db_password
        │                                ├─ api      → DB_PASSWORD_FILE     → lerSegredo()
        │                                └─ postgres → APP_DB_PASSWORD_FILE → script de init (role da app)
secrets/postgres_admin_password.txt ─► /run/secrets/postgres_admin_password
        └─ fora do git e da imagem       └─ postgres → POSTGRES_PASSWORD_FILE → entrypoint oficial (superuser)
```

- Nenhuma senha aparece em `docker inspect`, `docker compose config` nem em `printenv` dentro do container.
- Dentro da API: só `/run/secrets/db_password` (dono `node`, permissão `600`). A senha do admin **não** chega na API.
- A API aceita `DB_PASSWORD` direto como fallback (usado pelos testes e2e).

### Roles do banco (privilégios mínimos)

| Role | Atributos | Quem usa |
|---|---|---|
| `postgres_admin` | superuser | Só manutenção manual (`docker compose exec postgres psql ...`) |
| `nest_app` | `LOGIN`, **sem** superuser / `CREATEROLE` / `CREATEDB` / `REPLICATION` / `BYPASSRLS` | A API (TypeORM) |

Privilégios do `nest_app`: `CONNECT` no `nest_app_db` (revogado de `PUBLIC`) + `USAGE, CREATE` no schema `public` (para migrations).
Verificado: `CREATE ROLE` e `CREATE DATABASE` → `permission denied`.

Script: `docker/postgres/init/01-criar-role-app.sh` — roda **sozinho** na primeira criação do volume e é **idempotente**:

```bash
# volume já existente, troca de senha da app (secrets/db_password.txt) ou role divergente:
docker compose exec postgres /docker-entrypoint-initdb.d/01-criar-role-app.sh
```

- Nova variável: adicione no arquivo do serviço **e** no `.example` correspondente (sem valor real), depois `docker compose up -d` (recria o container com o novo env).
- Nenhum `.env*` entra na imagem (`.dockerignore`) nem é commitado (`.gitignore`), exceto os `.example`.
- Trocar a porta da máquina: `HOST_PORT=8080` no `.env` → `docker compose up -d` → http://localhost:8080

## Ciclo de vida

```bash
docker compose up -d            # sobe (sem rebuild)
docker compose up -d --build    # rebuild após alterar código
docker compose restart api      # reinicia o container
docker compose stop             # para sem remover
docker compose down             # para e remove o container
docker compose down --rmi local # remove também a imagem local
```

## Logs

```bash
docker compose logs -f api             # acompanha em tempo real (Ctrl+C sai)
docker compose logs --tail 100 api     # últimas 100 linhas
docker compose logs --since 10m api    # últimos 10 minutos
docker compose logs -t api             # com timestamp do Docker
docker compose logs api | grep ERROR   # filtra por texto
```

Rotação configurada no compose: até 3 arquivos de 10 MB.

## Comandos dentro do container

```bash
docker compose exec api sh                  # shell interativo (sai com `exit`)

# comandos avulsos, sem entrar no shell
docker compose exec api printenv            # todas as variáveis de ambiente
docker compose exec api printenv PORT       # uma variável
docker compose exec api whoami              # usuário (deve ser `node`, não root)
docker compose exec api node -v             # versão do Node
docker compose exec api ls -la dist         # código compilado
docker compose exec api ps aux              # processos rodando
docker compose exec api wget -qO- http://127.0.0.1:3000/health
```

> A imagem de runtime **não tem npm/yarn/corepack**. Comandos `npm ...` só funcionam na máquina local ou no estágio de build.

## Imagem

Três estágios no `Dockerfile`:

```
deps-producao (node alpine) : npm ci --omit=dev --ignore-scripts → node_modules de produção
build         (node alpine) : npm ci --ignore-scripts → nest build → dist/
runtime       (alpine puro) : libstdc++ + libgcc + binário node + node_modules + dist  (usuário node, uid 1000)
```

| | Antes | Depois |
|---|---|---|
| Tamanho | 341,1 MB | **295,6 MB** (−45,5 MB, −13%) |
| Build sem cache | 21 s | **17 s** |
| npm / yarn / corepack no runtime | presentes | **ausentes** |
| Scripts de instalação de terceiros | executados | **bloqueados** (`--ignore-scripts`) |
| Health check | só no compose (`wget`) | **no `Dockerfile`** (`node` + `fetch`) |

- Cache do npm entre builds via BuildKit (`--mount=type=cache`): mudanças só em `src/` reaproveitam as camadas de dependências.
- O `HEALTHCHECK` está na imagem: `docker run` sem compose também reporta `healthy`/`unhealthy`.
- O runtime usa o **mesmo Alpine** (3.24.4) da imagem do Node — exigência do binário (musl + `libstdc++`/`libgcc`, verificado com `ldd`). Ao atualizar o Node, confira a versão do Alpine dele.
- `apk upgrade` no runtime aplica correções de segurança do Alpine publicadas após o digest da base.

### Scan de vulnerabilidades

```bash
./scripts/scan-imagens.sh     # Trivy em container; exit 1 se houver CRITICAL/HIGH com correção
```

Último resultado: **API 0 vulnerabilidades** · Postgres 1 CRITICAL + 25 HIGH, todos no `gosu` da imagem oficial (sem versão corrigida upstream — issue #37). Detalhes em `docs/seguranca/scan-imagens.md`.

## Limites de recursos

Definidos a partir de medição (`autocannon` 9.0.0 + `docker stats`, 20 s por cenário, rate limit desligado durante a medição). Ambiente: OrbStack, 10 CPUs, 7,8 GiB.

### Medições

| Cenário | Sem limites | Com limites |
|---|---|---|
| Repouso | API 56,7 MiB / 11 PIDs · Postgres 25,7 MiB / 9 PIDs | — |
| `GET /` · 50 conexões | 4.390 req/s · p99 26 ms · API pico **126% CPU / 500 MiB** | 3.169 req/s · p99 61 ms · API pico 104% / **196 MiB** |
| `GET /health/db` · 50 conexões | 17.087 req/s · p99 5 ms · API 126% / 300 MiB · Postgres 52% / 41 MiB / 19 PIDs | 6.367 req/s · p99 48 ms · API 102% / **125 MiB** · Postgres 24% / 37 MiB / 19 PIDs |
| `GET /health/db` · 200 conexões | 15.508 req/s · p99 24 ms · API 110% / 373 MiB | 6.759 req/s · p99 72 ms · API 102% / **127 MiB** |

Zero erros, zero timeouts e zero OOM em todos os cenários.

- **Memória da API sem limite (300–500 MiB):** o V8 não tem teto e adia o GC. Com `--max-old-space-size=384` o GC age antes e o pico cai para 125–196 MiB.
- **Throughput menor com limites:** efeito do teto de 1 CPU. Troca consciente por previsibilidade; ainda ~3–6 mil req/s.

### Limites aplicados

| | API | Postgres |
|---|---|---|
| `cpus` | 1.0 | 1.0 |
| `memory` | 512M | 512M |
| `pids` | 64 (pico 14) | 64 (30 conexões + ~10 de background + folga) |
| Ajuste interno | `NODE_OPTIONS=--max-old-space-size=384` (75% da memória) | `max_connections=30` (pool da API = 10), `shared_buffers=128MB` (25% da memória) |

### Comportamento no limite (testado)

Memória da API reduzida temporariamente para 72 MB sob carga:

```
oom → die exitCode=137 (SIGKILL do kernel) → start   (2 ciclos)
```

O kernel mata o container por OOM e o `restart: unless-stopped` o traz de volta. Para investigar:

```bash
docker events --since 10m --filter container=nest-docker-app --filter event=oom
docker inspect -f 'Restarts={{.RestartCount}} OOMKilled={{.State.OOMKilled}}' nest-docker-app
docker stats nest-docker-app nest-docker-postgres
```

`OOMKilled` volta a `false` após o restart — o histórico fica em `docker events`.

## Segurança HTTP da API

Configurada em `src/seguranca/seguranca-http.ts` (usada pelo `main.ts` **e** pelos testes e2e — mesma configuração).

| Proteção | Como | Verificado |
|---|---|---|
| Headers de segurança | `app.useSecurityHeaders()` nativo do Nest 12.1+ (mesmos padrões do helmet 8, sem dependência extra) | `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` |
| Sem `X-Powered-By` | removido pelo `useSecurityHeaders()` | header ausente |
| Rate limiting | `@nestjs/throttler` como guard global (`APP_GUARD`) | 105 requisições → **99×200 + 6×429** (limite 100, contando 1 `HEAD` anterior) |
| Health checks isentos | `@SkipThrottle()` no `HealthController` | `/health` → 200 durante o bloqueio; container segue `healthy` |
| CORS | `enableCors` só com origens de `CORS_ORIGINS` | origem listada recebe `Access-Control-Allow-Origin`; outra não |

```bash
curl -sI localhost:3000/ | grep -iE 'x-powered-by|content-security|x-ratelimit'   # headers
for i in $(seq 1 105); do curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/; done | sort | uniq -c
```

Limitações conhecidas:
- Contador do rate limit **em memória**: zera a cada restart e não é compartilhado entre réplicas (com várias instâncias, usar storage Redis).
- Atrás de proxy reverso/load balancer, todos os clientes aparecem com o IP do proxy — configurar `trust proxy` antes de publicar.

## Hardening dos containers

| | API | Postgres |
|---|---|---|
| Usuário do processo | `node` (uid 1000) | `postgres` |
| `cap_drop` | `ALL` | `ALL` |
| `cap_add` | — | `CHOWN`, `DAC_OVERRIDE`, `SETUID`, `SETGID` |
| Capabilities efetivas do processo principal (`CapEff`) | **0** | **0** |
| `no-new-privileges` | ✅ | ✅ |
| Filesystem | **somente leitura** + `/tmp` em memória (16 MB) | gravável (PGDATA no volume) |

**Por que o Postgres precisa de 4 capabilities:** o entrypoint oficial começa como root, ajusta o PGDATA e troca para o usuário `postgres` — depois disso o processo roda com `CapEff: 0`. Conjunto mínimo **medido** (volume novo + reinício), removendo uma por vez:

| Sem | Resultado |
|---|---|
| `CHOWN` | ❌ `chown: /var/lib/postgresql/18/docker: Operation not permitted` |
| `DAC_OVERRIDE` | ❌ no reinício: `find: /var/lib/postgresql/18/docker: Permission denied` |
| `SETUID` / `SETGID` | ❌ `failed switching to 'postgres': operation not permitted` |
| `FOWNER` | ✅ desnecessária (só gera o aviso inofensivo `chmod: /var/run/postgresql: Operation not permitted` — o diretório já vem com a permissão certa da imagem) |

```bash
docker compose exec api sh -c 'grep CapEff /proc/1/status'   # 0000000000000000
docker compose exec api touch /app/x                          # Read-only file system
```

Se a API precisar gravar algo novo em disco, use `/tmp` ou adicione outro `tmpfs`/volume — o resto do filesystem é somente leitura.

## Monitoramento e diagnóstico

```bash
docker compose ps                                              # status + portas
docker stats nest-docker-app                                   # CPU / memória em tempo real
docker inspect --format '{{.State.Health.Status}}' nest-docker-app
docker inspect --format '{{json .State.Health}}' nest-docker-app   # histórico do health check
docker compose config                                          # compose final com variáveis resolvidas
docker image ls nest-docker-app                                # tamanho da imagem
```

## Limpeza

```bash
docker image prune     # remove imagens órfãs (dangling)
docker builder prune   # limpa cache de build
docker system df       # espaço usado pelo Docker
```

## PostgreSQL, rede e DNS interno

```
 Mac localhost:3000
        │ (porta publicada)
        ▼
┌──────────────── rede bridge "nest-net" ─────────────────┐
│  api (nest-docker-app)             postgres             │
│  DB_HOST=postgres ──DNS 127.0.0.11──► IP do container   │
│  TypeORM pool ─────────TCP 5432─────► nest-docker-postgres
└─────────────────────────────────────────────────────────┘
        Postgres SEM porta publicada no Mac (só a rede interna alcança)
```

- **DNS interno:** em redes definidas pelo usuário, o Docker resolve o **nome do serviço** (e o `container_name`) para o IP atual do container. O IP muda a cada recriação; o nome não — por isso `DB_HOST=postgres`.
- **Ordem de subida:** `depends_on: condition: service_healthy` só sobe a API depois que `pg_isready` passa. Se o banco cair depois, o pool do TypeORM reconecta sozinho quando ele volta.
- **Dados:** volume `nest-docker-postgres-data` sobrevive a `down`/`up`. `docker compose down -v` **apaga os dados**.
- **Acesso pelo Mac** (DBeaver/psql): descomente `ports: "127.0.0.1:5432:5432"` no serviço `postgres` e rode `docker compose up -d`.

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'          # console SQL (admin)
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'  # listar tabelas
docker compose exec api getent hosts postgres                          # DNS a partir da API
docker compose exec api nc -zv postgres 5432                           # TCP a partir da API
docker network inspect nest-net                                        # quem está na rede + IPs
curl localhost:3000/health/db                                          # ping do banco pela aplicação
docker compose logs postgres --tail 50                                 # logs do banco
```

## Validação de persistência

```bash
./scripts/validar-persistencia.sh
```

Grava um marcador → `docker compose down` (**sem** `-v`) → `docker compose up -d` → lê o marcador no container novo → remove a tabela de teste.

Resultado real (16/11/2026):

| | Antes | Depois |
|---|---|---|
| ID do container Postgres | `20cdea879b9b` | `27966dfcce81` (novo) |
| IP na `nest-net` | `192.168.107.2` | `192.168.97.2` (mudou) |
| Marcador | gravado | **lido** ✔ |
| `/health/db` | ok | ok (API reconectou pelo nome `postgres`) |

O container e o IP mudam; o **dado** (volume) e o **nome DNS** permanecem.

| Comando | Dados |
|---|---|
| `docker compose down` / `up -d` / `--force-recreate` / nova imagem | ✅ preservados |
| `docker compose down -v` · `docker volume rm` · `docker volume prune` | ❌ **apagados** |

## Diagnóstico de falhas de conexão

```bash
./scripts/diagnosticar-conexao.sh
```

Verifica em camadas e para na primeira que falhar, mostrando causa provável e correção:

1. Containers `running`/`healthy` → 2. Mesma rede `nest-net` → 3. Variáveis `DB_*` dentro da API (senha oculta)
→ 4. DNS do `DB_HOST` → 5. TCP na porta → 6. `pg_isready` → 7. Login com as credenciais da API (`SELECT 1`) → 8. `/health/db` + erros TypeORM nos logs

### Erros reais (simulados neste projeto)

| Simulação | Erro observado | Onde aparece | Causa / correção |
|---|---|---|---|
| `docker compose stop postgres` | `getaddrinfo ENOTFOUND postgres` | `/health/db` → **503**; `/health` segue **200** | Container parado **sai do DNS** (por isso ENOTFOUND, não ECONNREFUSED). `docker compose start postgres` — o pool reconecta sozinho |
| `DB_HOST=postgress` (typo) | `Error: getaddrinfo ENOTFOUND postgress` | Logs da API: 4× `Unable to connect... Retrying`, depois a API **encerra** (~13s) | Nome ≠ serviço do compose. Corrija o `.env.api` → `docker compose up -d` |
| `DB_PASSWORD` errada | `error: password authentication failed for user "nest_app"` | Logs da API, após os retries | `.env.api` ≠ senha do banco. Lembre: `POSTGRES_PASSWORD` só vale na 1ª criação do volume |
| `DB_HOST=localhost` | `connect ECONNREFUSED 127.0.0.1:5432` / `::1:5432` | Logs da API | `localhost` = o próprio container da API. Use `DB_HOST=postgres` |
| API desconectada da `nest-net` | `curl` sem resposta (`000`) | Script: etapa 2 | Sem rede o container perde também a porta publicada. `docker network connect nest-net nest-docker-app` ou `docker compose up -d` |

Dica: o log de retry do TypeORM mostra só `Unable to connect...`; **a causa real aparece na última linha** (`ERROR [ExceptionHandler] ...`). Para vê-la já: `docker compose logs api | grep -iE "ExceptionHandler|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|authentication"`.

## Testes

```bash
npm test              # unitários (sem Docker)
npm run test:e2e      # e2e: exige Docker rodando
```

O e2e usa **Testcontainers**: sobe um Postgres descartável (mesma imagem pinada do compose), aponta `DB_*` para ele e remove ao final. Não usa nem altera o banco de desenvolvimento. O container `testcontainers-ryuk-*` é o coletor de limpeza e encerra sozinho segundos depois.

## Problemas comuns

| Sintoma | Verificar |
|---|---|
| `port is already allocated` | Outra coisa usa a porta → `lsof -i :3000` ou mude `HOST_PORT` |
| Container `unhealthy` | `docker compose logs api` e `docker inspect --format '{{json .State.Health}}' nest-docker-app` |
| Alteração no código não aparece | Faltou `--build`: `docker compose up -d --build` |
| Variável nova não aparece | `docker compose up -d` (recria) — `restart` não relê o `env_file` |
| `docker: command not found` | Abra um terminal novo (OrbStack configura o PATH no `~/.zprofile`) |
| API reiniciando em loop | Banco inalcançável no boot: após 5 tentativas a API encerra e o `restart` a sobe de novo → `./scripts/diagnosticar-conexao.sh` |
| `/health` 200 mas `/health/db` 503 | API ok, banco não — veja a mensagem no JSON (`error.postgres.message`) |
