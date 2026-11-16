# nest-docker-app — Guia Docker

Aplicação NestJS 12 + PostgreSQL 18 rodando via Docker Compose (runtime: OrbStack).

- URL: http://localhost:3000 (porta definida por `HOST_PORT` no `.env`)
- Liveness: http://localhost:3000/health · Readiness (banco): http://localhost:3000/health/db
- Serviço `api` · Container `nest-docker-app` · Imagem `nest-docker-app:local`
- Serviço `postgres` · Container `nest-docker-postgres` · Volume `nest-docker-postgres-data`
- Rede: `nest-net` (bridge)

## Primeira execução

```bash
cp .env.example .env          # ajuste os valores se precisar
docker compose up -d --build  # build da imagem + sobe o container em background
docker compose ps             # STATUS deve ficar "(healthy)"
curl http://localhost:3000/health
```

## Variáveis de ambiente (`.env`)

| Variável | Uso |
|---|---|
| `NODE_ENV` | Ambiente da aplicação |
| `PORT` | Porta em que o Nest escuta **dentro** do container |
| `HOST_PORT` | Porta exposta na sua máquina (`HOST_PORT:PORT`) |
| `APP_NAME` | Exemplo de variável lida via `ConfigService` |
| `DB_HOST` | Host do banco **visto pela API** = nome do serviço (`postgres`). Nunca `localhost` |
| `DB_PORT` | Porta **interna** do Postgres (`5432`) |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Credenciais usadas pela API (TypeORM) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Criação do banco pelo container Postgres — **só na primeira criação do volume** |

- Nova variável: adicione no `.env` **e** no `.env.example` (sem valor real), depois rode `docker compose up -d` (recria o container com o novo env).
- O `.env` nunca entra na imagem (`.dockerignore`) e não deve ser commitado.
- Trocar a porta da máquina: altere `HOST_PORT=8080` → `docker compose up -d` → http://localhost:8080

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
docker compose exec postgres psql -U nest_app -d nest_app_db          # console SQL
docker compose exec postgres psql -U nest_app -d nest_app_db -c '\dt'  # listar tabelas
docker compose exec api getent hosts postgres                          # DNS a partir da API
docker compose exec api nc -zv postgres 5432                           # TCP a partir da API
docker network inspect nest-net                                        # quem está na rede + IPs
curl localhost:3000/health/db                                          # ping do banco pela aplicação
docker compose logs postgres --tail 50                                 # logs do banco
```

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
| `DB_HOST=postgress` (typo) | `Error: getaddrinfo ENOTFOUND postgress` | Logs da API: 4× `Unable to connect... Retrying`, depois a API **encerra** (~13s) | Nome ≠ serviço do compose. Corrija o `.env` → `docker compose up -d` |
| `DB_PASSWORD` errada | `error: password authentication failed for user "nest_app"` | Logs da API, após os retries | `.env` ≠ senha do banco. Lembre: `POSTGRES_PASSWORD` só vale na 1ª criação do volume |
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
| Variável nova não aparece | `docker compose up -d` (recria) — `restart` não relê o `.env` |
| `docker: command not found` | Abra um terminal novo (OrbStack configura o PATH no `~/.zprofile`) |
| API reiniciando em loop | Banco inalcançável no boot: após 5 tentativas a API encerra e o `restart` a sobe de novo → `./scripts/diagnosticar-conexao.sh` |
| `/health` 200 mas `/health/db` 503 | API ok, banco não — veja a mensagem no JSON (`error.postgres.message`) |
