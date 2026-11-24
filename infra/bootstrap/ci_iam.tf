# Service account usada pelo GitHub Actions para plan/apply do Terraform principal.
# Papéis = só o que os recursos de infra/terraform precisam (sem roles/owner ou roles/editor).

resource "google_service_account" "terraform_ci" {
  account_id   = "sa-terraform-ci"
  display_name = "GitHub Actions — Terraform"

  depends_on = [google_project_service.bootstrap]
}

# Só o repositório autorizado pode se passar por esta SA
resource "google_service_account_iam_member" "github_usa_sa" {
  service_account_id = google_service_account.terraform_ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.repositorio_github}"
}

locals {
  papeis_projeto_ci = [
    "roles/run.admin",                       # Cloud Run (serviços e jobs)
    "roles/compute.networkAdmin",            # VPC, subnet, IP interno
    "roles/compute.securityAdmin",           # firewall
    "roles/compute.instanceAdmin.v1",        # VM e disco
    "roles/artifactregistry.admin",          # repositórios + IAM do repositório
    "roles/secretmanager.admin",             # segredos + versões + IAM do segredo
    "roles/iam.serviceAccountAdmin",         # sa-nest-api / sa-nest-postgres
    "roles/iam.serviceAccountUser",          # anexar SAs na VM e no Cloud Run
    "roles/resourcemanager.projectIamAdmin", # google_project_iam_member (logWriter)
    "roles/serviceusage.serviceUsageAdmin",  # google_project_service
    "roles/pubsub.admin",                    # tópicos, assinaturas + IAM (mensageria)
    "roles/cloudscheduler.admin",            # job do relay do outbox
  ]
}

resource "google_project_iam_member" "ci" {
  for_each = toset(local.papeis_projeto_ci)

  project = var.projeto_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.terraform_ci.email}"
}

# Ler/gravar o state (e o lock) — somente neste bucket
resource "google_storage_bucket_iam_member" "ci_state" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.terraform_ci.email}"
}

# Alerta de orçamento (google_billing_budget) vive na conta de faturamento
resource "google_billing_account_iam_member" "ci_orcamento" {
  billing_account_id = var.conta_faturamento
  role               = "roles/billing.costsManager"
  member             = "serviceAccount:${google_service_account.terraform_ci.email}"

  # Precisa da Cloud Billing API ligada (cota cobrada do projeto)
  depends_on = [google_project_service.bootstrap]
}
