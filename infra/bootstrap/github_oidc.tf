# Workload Identity Federation: o GitHub Actions troca o token OIDC do job por credencial GCP temporária.
# Sem chave JSON de service account em lugar nenhum.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Tokens OIDC do GitHub Actions"

  depends_on = [google_project_service.bootstrap]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Só tokens do repositório autorizado (pelo ID numérico) são aceitos
  attribute_condition = "assertion.repository_id == '${var.repositorio_github_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}
