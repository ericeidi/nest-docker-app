# ---------- Projeto ----------
variable "projeto_id" {
  description = "ID do projeto GCP pessoal de teste"
  type        = string
}

variable "conta_faturamento" {
  description = "ID da conta de faturamento (gcloud billing accounts list) — usado pelo alerta de orçamento"
  type        = string
}

# Free tier do e2-micro só vale em us-central1, us-west1 ou us-east1
variable "regiao" {
  description = "Região GCP (precisa ser elegível ao free tier do e2-micro)"
  type        = string
  default     = "us-central1"

  validation {
    condition     = contains(["us-central1", "us-west1", "us-east1"], var.regiao)
    error_message = "Use us-central1, us-west1 ou us-east1 — fora delas o e2-micro é cobrado."
  }
}

variable "zona" {
  description = "Zona da VM do Postgres (dentro da região)"
  type        = string
  default     = "us-central1-a"
}

# ---------- Rede ----------
variable "faixa_subnet" {
  description = "CIDR da subnet (VM + IPs do Direct VPC egress do Cloud Run)"
  type        = string
  default     = "10.10.0.0/24"
}

variable "ip_interno_postgres" {
  description = "IP interno fixo da VM do Postgres (dentro de faixa_subnet)"
  type        = string
  default     = "10.10.0.10"
}

# ---------- Dimensionamento (defaults = dev no free tier) ----------
variable "tipo_maquina_postgres" {
  description = "Tipo da VM do Postgres. e2-micro é o único gratuito (1 por conta de faturamento)"
  type        = string
  default     = "e2-micro"
}

variable "tamanho_disco_dados_gb" {
  description = "Disco de dados do Postgres (GB). Free tier: 30 GB no total, 10 já vão para o boot"
  type        = number
  default     = 20
}

variable "max_instancias_api" {
  description = "Máximo de instâncias do Cloud Run (teto de custo)"
  type        = number
  default     = 1
}

variable "max_instancias_worker" {
  description = "Máximo de instâncias do nest-worker (teto de custo e de conexões no Postgres)"
  type        = number
  default     = 1
}

variable "pool_conexoes_banco" {
  description = "Máximo de conexões do pool por instância (API e worker). Soma de todas as instâncias precisa caber no max_connections=30 do Postgres"
  type        = number
  default     = 10
}

variable "concorrencia_worker" {
  description = "Mensagens processadas ao mesmo tempo por instância do worker"
  type        = number
  default     = 10
}

# ---------- Imagens ----------
variable "tag_imagem_api" {
  description = "Tag da imagem da API no Artifact Registry (ex.: v1)"
  type        = string
}

variable "imagem_postgres" {
  description = "Imagem do Postgres no Docker Hub (puxada via repositório remoto do Artifact Registry). Mesma do docker-compose."
  type        = string
  default     = "library/postgres:18.7-alpine@sha256:b6972e1115a4ff8eba5d7f7d19184926d1e16d7d1136ae1e1a7ebf286da0f015"
}

# ---------- Banco ----------
variable "banco_nome" {
  description = "Nome do banco da aplicação"
  type        = string
  default     = "nest_app_db"
}

variable "banco_usuario_app" {
  description = "Role da aplicação (sem superuser)"
  type        = string
  default     = "nest_app"
}

variable "banco_usuario_admin" {
  description = "Superuser do Postgres (uso manual apenas)"
  type        = string
  default     = "postgres_admin"
}

# ---------- API ----------
variable "origens_cors" {
  description = "Origens liberadas para CORS, separadas por vírgula. Vazio = nenhuma"
  type        = string
  default     = ""
}

variable "throttle_ttl_ms" {
  description = "Janela do rate limiting (ms)"
  type        = number
  default     = 60000
}

variable "throttle_limite" {
  description = "Máximo de requisições por IP na janela"
  type        = number
  default     = 100
}

variable "api_publica" {
  description = "true = qualquer pessoa com a URL acessa a API (allUsers). false = só contas com roles/run.invoker"
  type        = bool
  default     = true
}

# ---------- Orçamento ----------
variable "orcamento_valor" {
  description = "Valor do alerta de orçamento (só envia e-mail, NÃO bloqueia gastos)"
  type        = number
  default     = 5
}

variable "orcamento_moeda" {
  description = "Moeda da conta de faturamento (precisa ser a MESMA da conta: USD ou BRL)"
  type        = string
  default     = "USD"
}

# ---------- Mensageria ----------
variable "prazo_ack_pubsub_segundos" {
  description = "Tempo que o Pub/Sub espera a resposta do worker antes de reentregar (10–600). O job precisa terminar nesse prazo"
  type        = number
  default     = 60

  validation {
    condition     = var.prazo_ack_pubsub_segundos >= 10 && var.prazo_ack_pubsub_segundos <= 600
    error_message = "O Pub/Sub aceita ack deadline entre 10 e 600 segundos."
  }
}

variable "tentativas_entrega_pubsub" {
  description = "Entregas ao worker antes de mandar a mensagem para a DLQ (5–100)"
  type        = number
  default     = 5

  validation {
    condition     = var.tentativas_entrega_pubsub >= 5 && var.tentativas_entrega_pubsub <= 100
    error_message = "O Pub/Sub aceita max_delivery_attempts entre 5 e 100."
  }
}

variable "agenda_relay_outbox" {
  description = "Cron do Cloud Scheduler que drena o outbox no worker (UTC)"
  type        = string
  default     = "* * * * *"
}

variable "agenda_manutencao_outbox" {
  description = "Cron do Cloud Scheduler que aplica a retenção do outbox no worker (UTC)"
  type        = string
  default     = "0 6 * * *" # 03h em São Paulo, fora do horário de uso
}
