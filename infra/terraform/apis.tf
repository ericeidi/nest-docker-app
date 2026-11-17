# APIs necessárias. disable_on_destroy=false: o destroy não desliga APIs (evita quebrar outros usos do projeto).
locals {
  apis_necessarias = [
    "run.googleapis.com",
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "billingbudgets.googleapis.com",
    "iap.googleapis.com",
    "iam.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.apis_necessarias)

  project            = var.projeto_id
  service            = each.value
  disable_on_destroy = false
}
