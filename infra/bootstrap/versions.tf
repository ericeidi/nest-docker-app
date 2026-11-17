# Bootstrap: o que precisa existir ANTES do Terraform principal (infra/terraform).
# State LOCAL de propósito (o bucket de state é criado aqui) — gitignored.
terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.12"
    }
  }
}

provider "google" {
  project = var.projeto_id
  region  = var.regiao

  user_project_override = true
  billing_project       = var.projeto_id
}

data "google_project" "atual" {
  project_id = var.projeto_id
}
