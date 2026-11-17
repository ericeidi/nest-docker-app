# Provider fixo no projeto pessoal de teste — nunca herda o projeto ativo do gcloud.
provider "google" {
  project = var.projeto_id
  region  = var.regiao
  zone    = var.zona

  # Necessário para a API de Billing Budgets com credenciais de usuário (ADC):
  # a cota é cobrada do próprio projeto, não do projeto padrão do ADC.
  user_project_override = true
  billing_project       = var.projeto_id
}

data "google_project" "atual" {
  project_id = var.projeto_id
}
