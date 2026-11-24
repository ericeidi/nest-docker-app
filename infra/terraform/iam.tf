# Uma service account por workload, com o mínimo de permissões.

# ---------- API (Cloud Run) ----------
resource "google_service_account" "api" {
  account_id   = "sa-nest-api"
  display_name = "Cloud Run — nest-api"

  depends_on = [google_project_service.apis]
}

# Só lê a senha da própria role (não a do admin)
resource "google_secret_manager_secret_iam_member" "api_le_db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# ---------- Postgres (VM) ----------
resource "google_service_account" "postgres" {
  account_id   = "sa-nest-postgres"
  display_name = "VM — nest-postgres"

  depends_on = [google_project_service.apis]
}

# Precisa das duas senhas: admin (POSTGRES_PASSWORD_FILE) e app (script de criação da role)
resource "google_secret_manager_secret_iam_member" "postgres_le_db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postgres.email}"
}

resource "google_secret_manager_secret_iam_member" "postgres_le_admin_password" {
  secret_id = google_secret_manager_secret.postgres_admin_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postgres.email}"
}

# Puxa a imagem do Postgres pelo proxy do Docker Hub (só esse repositório)
resource "google_artifact_registry_repository_iam_member" "postgres_le_dockerhub_proxy" {
  location   = google_artifact_registry_repository.dockerhub_proxy.location
  repository = google_artifact_registry_repository.dockerhub_proxy.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.postgres.email}"
}

# Logs do container no Cloud Logging
resource "google_project_iam_member" "postgres_escreve_logs" {
  project = var.projeto_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.postgres.email}"
}

# ---------- Worker (Cloud Run) ----------
resource "google_service_account" "worker" {
  account_id   = "sa-nest-worker"
  display_name = "Cloud Run — nest-worker"

  depends_on = [google_project_service.apis]
}

# Mesma senha da role da aplicação (o worker usa o mesmo banco)
resource "google_secret_manager_secret_iam_member" "worker_le_db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

# ---------- Job de migração (Cloud Run Job) ----------
# SA própria: só lê a senha do banco (não publica no Pub/Sub nem invoca serviços)
resource "google_service_account" "migracoes" {
  account_id   = "sa-nest-migracoes"
  display_name = "Cloud Run Job — nest-migracoes"

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "migracoes_le_db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migracoes.email}"
}

# ---------- Push do Pub/Sub → worker ----------
# Identidade do token OIDC que o Pub/Sub envia no push. Só tem roles/run.invoker no worker.
resource "google_service_account" "pubsub_push" {
  account_id   = "sa-pubsub-push"
  display_name = "Pub/Sub push — invoca o nest-worker"

  depends_on = [google_project_service.apis]
}

# O agente do Pub/Sub gera o token OIDC em nome desta SA (só nesta SA, não no projeto)
resource "google_service_account_iam_member" "agente_pubsub_gera_token_push" {
  service_account_id = google_service_account.pubsub_push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.agente_servico_pubsub
}

# ---------- Cloud Scheduler → worker ----------
resource "google_service_account" "scheduler" {
  account_id   = "sa-scheduler-relay"
  display_name = "Cloud Scheduler — relay do outbox no nest-worker"

  depends_on = [google_project_service.apis]
}
