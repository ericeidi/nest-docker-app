variable "projeto_id" {
  description = "ID do projeto GCP"
  type        = string
}

variable "regiao" {
  description = "Região do bucket de state (us-central1/us-west1/us-east1 = 5 GB grátis)"
  type        = string
  default     = "us-central1"
}

variable "conta_faturamento" {
  description = "ID da conta de faturamento — a SA do CI recebe billing.costsManager nela (alerta de orçamento)"
  type        = string
}

variable "repositorio_github" {
  description = "Repositório autorizado a autenticar no GCP via OIDC (owner/nome)"
  type        = string
  default     = "ericeidi/nest-docker-app"
}

variable "repositorio_github_id" {
  description = "ID numérico do repositório (gh api repos/<owner>/<repo> --jq .id). Imune a renomear/recriar repo com o mesmo nome"
  type        = string
}
