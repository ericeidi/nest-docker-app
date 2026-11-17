# APIs de base: necessárias para o Terraform principal ler o projeto e para o OIDC do GitHub.
# (cloudresourcemanager e serviceusage já tinham sido ligadas manualmente — agora ficam no código)
locals {
  apis_bootstrap = [
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudbilling.googleapis.com",
  ]
}

resource "google_project_service" "bootstrap" {
  for_each = toset(local.apis_bootstrap)

  project            = var.projeto_id
  service            = each.value
  disable_on_destroy = false
}
