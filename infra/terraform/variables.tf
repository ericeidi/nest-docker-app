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
