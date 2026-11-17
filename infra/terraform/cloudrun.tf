# API no Cloud Run — escala a zero (free tier), acessa o Postgres pelo IP interno via Direct VPC egress.
resource "google_cloud_run_v2_service" "api" {
  name     = "nest-api"
  location = var.regiao
  ingress  = "INGRESS_TRAFFIC_ALL"

  # Ambiente de teste: permite terraform destroy
  deletion_protection = false

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = 0
      # Teto de custo (dev: 1 instância)
      max_instance_count = var.max_instancias_api
    }

    # Sai para a VPC só para IPs privados (Postgres); internet segue pelo caminho padrão
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.subnet.id
      }
    }

    # Senha montada como arquivo — mesma convenção DB_PASSWORD_FILE do docker-compose
    volumes {
      name = "db-password"
      secret {
        secret = google_secret_manager_secret.db_password.secret_id
        items {
          version = "latest"
          path    = "db_password"
        }
      }
    }

    containers {
      image = local.imagem_api

      # PORT é definido pelo próprio Cloud Run a partir de container_port
      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # CPU só durante requisições (cobrança por request — é o que o free tier cobre)
        cpu_idle = true
      }

      volume_mounts {
        name       = "db-password"
        mount_path = "/secrets"
      }

      env {
        name  = "APP_NAME"
        value = "nest-docker-app"
      }
      env {
        name  = "DB_HOST"
        value = google_compute_address.postgres_interno.address
      }
      env {
        name  = "DB_PORT"
        value = "5432"
      }
      env {
        name  = "DB_USER"
        value = var.banco_usuario_app
      }
      env {
        name  = "DB_NAME"
        value = var.banco_nome
      }
      env {
        name  = "DB_PASSWORD_FILE"
        value = "/secrets/db_password"
      }
      env {
        name  = "CORS_ORIGINS"
        value = var.origens_cors
      }
      env {
        name  = "THROTTLE_TTL_MS"
        value = tostring(var.throttle_ttl_ms)
      }
      env {
        name  = "THROTTLE_LIMIT"
        value = tostring(var.throttle_limite)
      }
      env {
        # Heap do V8 em 75% da memória do container, igual ao compose
        name  = "NODE_OPTIONS"
        value = "--max-old-space-size=384"
      }

      # Folga para o pool do TypeORM (5 tentativas × 3s) conectar ao Postgres
      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 5
        timeout_seconds   = 3
        failure_threshold = 12
      }

      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 30
        timeout_seconds   = 3
        failure_threshold = 3
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.db_password,
    google_secret_manager_secret_iam_member.api_le_db_password,
    google_compute_instance.postgres,
  ]
}

# Acesso público à URL (opcional — var.api_publica)
resource "google_cloud_run_v2_service_iam_member" "publico" {
  count = var.api_publica ? 1 : 0

  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
