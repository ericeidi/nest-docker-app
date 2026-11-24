# Infra GCP (teste, free tier) — Terraform

Sobe a nest-docker-app no GCP mirando **~US$ 0/mês** no ambiente dev.

```
Internet ─HTTPS─▶ Cloud Run (nest-api, min=0/max=1) ──publica──▶ Pub/Sub: eventos-app
                      │ Direct VPC egress                          │ push + OIDC
                      │                                            ▼
                      │                         Cloud Run (nest-worker, privado, min=0/max=1)
                      │                                            │        ▲
                      ▼                                            │        │ a cada 1 min (OIDC)
              VPC nest-vpc · 10.10.0.0/24 ◀────────────────────────┘   Cloud Scheduler: relay-outbox
                      │
              VM e2-micro nest-postgres (sem IP público, COS)
                └─ container postgres:18.7-alpine · dados em disco pd-standard 20 GB
                   └─ schema nest_outbox (outbox, dead letters, inbox) — migrado pelo job nest-migracoes

Pub/Sub:           eventos-app → assinatura push eventos-app-worker → (5 falhas) → eventos-app-dlq
Artifact Registry: app (imagem da API, mantém 2) · dockerhub-proxy (cache da imagem do Postgres)
Secret Manager:    db_password · postgres_admin_password (gerados pelo Terraform)
Orçamento:         alerta por e-mail (50% / 90% / 100%)
State:             gs://<projeto>-tfstate/nest-docker-app/<ambiente>
```
## Estrutura

```
infra/
├── bootstrap/            roda 1x por projeto, state local
│   ├── state_bucket.tf   bucket do state remoto (versionado, privado)
│   ├── github_oidc.tf    Workload Identity Federation (GitHub Actions → GCP, sem chave JSON)
│   ├── ci_iam.tf         SA sa-terraform-ci com papéis mínimos
│   └── apis.tf           APIs de base (resource manager, IAM, STS, billing…)
└── terraform/            a infra da aplicação, state no GCS
    ├── envs/
    │   ├── dev.tfvars / dev.backend.hcl     ambiente provisionado (free tier)
    │   └── prod.tfvars / prod.backend.hcl   EXEMPLO, não provisionado (gera custo)
    └── *.tf
.github/workflows/terraform.yml   plan no PR · apply na main com aprovação manual
```

## Por que fica no free tier (dev)

| Recurso | Limite gratuito | Como respeitamos |
|---|---|---|
| Cloud Run | 2M req, 180k vCPU-s, 360k GiB-s/mês | `min=0`, `max=1`, CPU só durante request |
| e2-micro | 1 VM/conta de faturamento, só us-central1/us-west1/us-east1 | região validada em `variables.tf` |
| Disco | 30 GB pd-standard | 10 GB boot + 20 GB dados |
| IPv4 público | — (cobrado) | VM **sem** IP público |
| Cloud NAT | — (cobrado) | não usado: Private Google Access |
| Artifact Registry | 0,5 GB | política de limpeza mantém 2 versões |
| Cloud Storage (state) | 5 GB Standard em região US | poucos KB, 5 versões antigas |
| Snapshots/backups | — (cobrado) | **não** são criados — dados descartáveis |
| Pub/Sub | 10 GiB de mensagens/mês | payloads pequenos (só ids) |
| Cloud Scheduler | 3 jobs por conta de faturamento | 1 job (`relay-outbox`) |
| Cloud Run Jobs | mesma cota de vCPU-s do Cloud Run | `nest-migracoes` roda segundos por deploy |

> Valores de preço/free tier mudam. Confira em https://cloud.google.com/free e no relatório de Billing.

## 1. Pré-requisitos (uma vez por máquina)

```bash
brew install hashicorp/tap/terraform

# Perfil pessoal do gcloud (NÃO usar o perfil de trabalho)
gcloud config configurations activate pessoal
gcloud auth application-default login   # conta pessoal — credencial usada pelo Terraform
```

> `application-default login` sobrescreve a credencial ADC única da máquina. Ao voltar ao trabalho, rode de novo com a conta corporativa se alguma ferramenta depender dela.

## 2. Bootstrap (uma vez por projeto)

```bash
# Projeto novo: APIs que o Terraform precisa para ler o próprio projeto
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com --project <projeto_id>

cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars   # projeto, conta de faturamento, repo GitHub + ID
terraform init && terraform apply
terraform output                               # valores para as variáveis do GitHub
```

O state do bootstrap fica **local** (`infra/bootstrap/terraform.tfstate`, gitignored, sem senhas).

## 3. Infra da aplicação

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # conta_faturamento e tag_imagem_api (não vão para o repo público)
terraform init -reconfigure -backend-config=envs/dev.backend.hcl

# Primeira vez: registry antes (a imagem precisa existir antes do Cloud Run)
terraform apply -var-file=envs/dev.tfvars -target=google_artifact_registry_repository.app

# Build e push da imagem da API (Cloud Run roda amd64)
gcloud auth configure-docker us-central1-docker.pkg.dev
IMAGEM=us-central1-docker.pkg.dev/<projeto_id>/app/nest-api:v1
docker build --platform linux/amd64 --target runtime -t "$IMAGEM" ../..
docker push "$IMAGEM"

terraform plan  -var-file=envs/dev.tfvars
terraform apply -var-file=envs/dev.tfvars
curl "$(terraform output -raw api_url)/health/db"
```

Nova versão da API: merge na `main` — o CI faz build/push com a tag `sha-<commit>`, roda a migração e aplica (seção 4). Para um plan local sem trocar a imagem, use a tag em uso: `gcloud run services describe nest-api --region us-central1 --format='value(spec.template.spec.containers[0].image)'`.

### Ambientes

Cada ambiente = um par `envs/<ambiente>.tfvars` + `envs/<ambiente>.backend.hcl` (state separado), idealmente em **projeto GCP separado**.

```bash
terraform init -reconfigure -backend-config=envs/prod.backend.hcl
terraform plan -var-file=envs/prod.tfvars
```

`prod` é só **exemplo**: e2-small, 3 instâncias, API fechada — fora do free tier.

## 4. CI/CD (GitHub Actions)

Dois workflows:

| Workflow | Evento | O que roda |
|---|---|---|
| `ci.yml` | todo PR e push na `main` | `npm ci` → lint → build → testes unitários → e2e (Testcontainers) → `docker build`. O check `verificar` é obrigatório para merge |
| `terraform.yml` | PR que altera `infra/terraform/**` | `fmt -check` → `validate` → `plan` com a imagem **em uso** → comentário com o plan no PR |
| `terraform.yml` | push na `main` (exceto só docs) | `imagem`: build + push `nest-api:sha-<commit>` → `deploy`, **após aprovação manual** no environment `dev`: job `nest-migracoes` com a imagem nova → `plan` → `apply` |

O Artifact Registry guarda as 2 imagens mais recentes (política de limpeza em `artifact_registry.tf`), suficiente para rollback para a versão anterior.

- Autenticação via OIDC (Workload Identity Federation) — só o repositório configurado no bootstrap (por ID numérico) consegue credencial.
- PRs de fork não recebem credencial.
- Variáveis do repositório: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `GCP_BILLING_ACCOUNT`. A tag da imagem vem do commit (deploy) ou do Cloud Run (plan de PR).
- Rollback: re-run do workflow `terraform` do commit anterior na `main` (a imagem dele ainda está no registry).
- **Repo público:** o comentário do plan e os logs são públicos. Valores sensíveis (senhas) aparecem como `(sensitive value)`; IDs de projeto, IPs internos e config ficam visíveis.

## Mensageria (outbox + Pub/Sub)

A API grava o evento no outbox (mesma transação dos dados) e publica no Pub/Sub logo após o commit, ainda dentro da requisição (`OUTBOX_RELAY_MODO=sob-demanda`: com `cpu_idle` não há CPU para um loop em background). O Pub/Sub entrega por push ao `nest-worker`, que é **privado**: só `sa-pubsub-push` e `sa-scheduler-relay` têm `roles/run.invoker`. O Cloud Scheduler chama `/internal/outbox/relay` a cada minuto para publicar o que ficou pendente.

### Primeira subida da mensageria (ordem importa)

A API e o worker sobem com `migrate: false`: sem o schema `nest_outbox` o startup falha. E a imagem `v1` ainda não tem o worker.

```bash
# 0. Uma vez: o CI precisa dos papéis novos (pubsub.admin, cloudscheduler.admin) — state local
cd infra/bootstrap && terraform apply

# 1. Imagem nova (com a mensageria)
IMAGEM=us-central1-docker.pkg.dev/<projeto_id>/app/nest-api:v2
docker build --platform linux/amd64 --target runtime -t "$IMAGEM" ../.. && docker push "$IMAGEM"
#    e atualize tag_imagem_api (local) / API_IMAGE_TAG (GitHub) para v2

# 2. Permissão da role da aplicação para criar o schema. O volume do Postgres já existe e o
#    script de init só roda sozinho em volume novo (e a cópia na VM só é atualizada no próximo boot),
#    então aplique o GRANT direto, pelo socket local do container:
$(terraform output -raw comando_ssh_postgres)
sudo docker exec postgres psql -U postgres_admin -d nest_app_db -c 'GRANT CREATE ON DATABASE nest_app_db TO nest_app;'

# 3. Job de migração primeiro, depois o resto
terraform apply -var-file=envs/dev.tfvars -target=google_cloud_run_v2_job.migracoes
$(terraform output -raw comando_migrar_outbox)
terraform apply -var-file=envs/dev.tfvars
```

Nos deploys seguintes é automático: merge na `main` → imagem → migração → apply (seção 4).

### DLQ

```bash
$(terraform output -raw comando_ler_dlq)          # lê sem confirmar (a mensagem continua lá)
gcloud pubsub subscriptions pull eventos-app-dlq-inspecao --auto-ack --limit 10   # lê e descarta
```

Replay: corrija a causa, leia a mensagem e republique em `eventos-app` com os mesmos atributos (`idEvento`, `topico`) — o worker deduplica pelo `idEvento`.

DLQ do Pub/Sub = falha ao **processar**. Falha ao **publicar** vai para as dead letters do outbox, no Postgres:

```bash
$(terraform output -raw comando_listar_dead_letters_outbox)        # lista, sem payload
# requeue: copie o comando, troque <ID> e rode
terraform output -raw comando_reenfileirar_dead_letter_outbox
```

Retenção: o Scheduler `manutencao-outbox` limpa inbox (30 dias) e dead letters (14 dias) uma vez por dia. Detalhes em `docs/mensageria.md`.

### Conexões no Postgres

Cada instância (API ou worker) abre um pool de até `pool_conexoes_banco` conexões (variável `DB_POOL_MAX`, default 10), e o Postgres aceita `max_connections=30`:

`(max_instancias_api + max_instancias_worker) × pool_conexoes_banco + admin` precisa ficar abaixo de 30.

Dev (1 + 1, pool 10) usa 20. O exemplo de prod (3 + 1) usa pool 5 → 20. Para escalar além disso sem custo, reduza o pool; aumentar `max_connections` exige mais RAM na VM (sai do e2-micro gratuito).

## Diagnóstico

```bash
# SSH na VM (via IAP, sem IP público)
$(terraform output -raw comando_ssh_postgres)

# Dentro da VM
sudo systemctl status postgres
sudo journalctl -u postgres -n 100
sudo docker logs postgres

# Logs da API e do worker
gcloud run services logs read nest-api --region us-central1
gcloud run services logs read nest-worker --region us-central1
```

## Derrubar (volta a custo zero)

```bash
cd infra/terraform && terraform destroy -var-file=envs/dev.tfvars
```

Apaga toda a infra da aplicação, **inclusive o disco com os dados do Postgres**. O bootstrap (bucket de state, OIDC, SA do CI) continua — custo ~zero. Para remover tudo: `gcloud projects delete <projeto_id>`.

## Observações

- O **state** (no GCS) contém as senhas geradas — acesso ao bucket só para o dono do projeto e a SA do CI.
- **API pública** no dev (`api_publica = true`).
- Tráfego API → Postgres sem TLS, mas só dentro da VPC privada. Aceitável para teste, não para produção.
- O alerta de orçamento **não** bloqueia gastos. `orcamento_moeda` precisa ser a moeda da conta de faturamento.
- O script de criação da role (`docker/postgres/init/01-criar-role-app.sh`) é o mesmo do docker-compose.
