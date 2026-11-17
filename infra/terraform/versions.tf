# Versões pinadas do Terraform e dos providers.
terraform {
  required_version = ">= 1.9"

  # State remoto no GCS (bucket criado em infra/bootstrap). Contém as senhas geradas.
  # Configuração parcial: bucket/prefix vêm de envs/<ambiente>.backend.hcl
  #   terraform init -backend-config=envs/dev.backend.hcl
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}
