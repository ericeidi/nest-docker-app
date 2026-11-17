# Senhas geradas pelo Terraform — nunca escritas em .tf/.tfvars.
# Atenção: ficam no terraform.tfstate (local, gitignored).
resource "random_password" "db_app" {
  length  = 32
  special = false
}

resource "random_password" "db_admin" {
  length  = 32
  special = false
}

# Nomes iguais aos Docker secrets do compose
resource "google_secret_manager_secret" "db_password" {
  secret_id = "db_password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_app.result
}

resource "google_secret_manager_secret" "postgres_admin_password" {
  secret_id = "postgres_admin_password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "postgres_admin_password" {
  secret      = google_secret_manager_secret.postgres_admin_password.id
  secret_data = random_password.db_admin.result
}
