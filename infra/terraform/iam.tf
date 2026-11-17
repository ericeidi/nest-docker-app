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
