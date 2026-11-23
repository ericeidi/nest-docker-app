# API e worker no Cloud Run — mesma imagem, papel escolhido por MODO_APP.
# Escalam a zero (free tier) e acessam o Postgres pelo IP interno via Direct VPC egress.

locals {
  # Variáveis de banco e de mensageria comuns a API, worker e job de migração (mesmo padrão do compose)
  ambiente_comum_app = [
    { nome = "APP_NAME", valor = "nest-docker-app" },
    { nome = "DB_HOST", valor = google_compute_address.postgres_interno.address },
    { nome = "DB_PORT", valor = "5432" },
    { nome = "DB_USER", valor = var.banco_usuario_app },
    { nome = "DB_NAME", valor = var.banco_nome },
    { nome = "DB_PASSWORD_FILE", valor = "/secrets/db_password" },
    { nome = "PUBSUB_PROJETO_ID", valor = var.projeto_id },
    { nome = "PUBSUB_TOPICO_EVENTOS", valor = google_pubsub_topic.eventos.name },
    # Cloud Run com cpu_idle: sem CPU entre requisições, então o relay não roda em loop
    { nome = "OUTBOX_RELAY_MODO", valor = "sob-demanda" },
    # Heap do V8 em 75% da memória do container, igual ao compose
    { nome = "NODE_OPTIONS", valor = "--max-old-space-size=384" },
  ]
}

# ---------- API (pública) ----------
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

      dynamic "env" {
        for_each = local.ambiente_comum_app
        content {
          name  = env.value.nome
          value = env.value.valor
        }
      }
      env {
        name  = "MODO_APP"
        value = "api"
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

# ---------- Worker (privado) ----------
# Recebe o push do Pub/Sub (/internal/eventos) e as chamadas do Cloud Scheduler (/internal/outbox/relay).
# Ingress ALL, mas SEM allUsers: o Cloud Run só deixa passar quem tem roles/run.invoker
# (as SAs do push do Pub/Sub e do Scheduler) — o token OIDC é validado antes do container.
resource "google_cloud_run_v2_service" "worker" {
  name     = "nest-worker"
  location = var.regiao
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false

  template {
    service_account = google_service_account.worker.email

    # Maior que o ack deadline da assinatura: o Cloud Run não corta a requisição antes do Pub/Sub desistir
    timeout = "${var.prazo_ack_pubsub_segundos * 2}s"

    # Mensagens processadas ao mesmo tempo por instância
    max_instance_request_concurrency = var.concorrencia_worker

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instancias_worker
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.subnet.id
      }
    }

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

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # O job roda dentro da requisição do push, então CPU só durante requisições basta
        cpu_idle = true
      }

      volume_mounts {
        name       = "db-password"
        mount_path = "/secrets"
      }

      dynamic "env" {
        for_each = local.ambiente_comum_app
        content {
          name  = env.value.nome
          value = env.value.valor
        }
      }
      env {
        name  = "MODO_APP"
        value = "worker"
      }

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
    google_secret_manager_secret_iam_member.worker_le_db_password,
    google_compute_instance.postgres,
  ]
}

# Só o push do Pub/Sub e o Cloud Scheduler chamam o worker
resource "google_cloud_run_v2_service_iam_member" "worker_invocado_pelo_pubsub" {
  name     = google_cloud_run_v2_service.worker.name
  location = google_cloud_run_v2_service.worker.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_push.email}"
}

resource "google_cloud_run_v2_service_iam_member" "worker_invocado_pelo_scheduler" {
  name     = google_cloud_run_v2_service.worker.name
  location = google_cloud_run_v2_service.worker.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# ---------- Job de migração do outbox ----------
# API e worker sobem com o schema nest_outbox já migrado (migrate: false em produção).
# Rode ANTES de cada deploy de imagem nova:
#   gcloud run jobs execute nest-migracoes --region <regiao> --wait
resource "google_cloud_run_v2_job" "migracoes" {
  name     = "nest-migracoes"
  location = var.regiao

  deletion_protection = false

  template {
    # Uma execução, uma tarefa: migrate() já roda sob advisory lock, mas não há o que paralelizar
    task_count = 1

    template {
      service_account = google_service_account.migracoes.email
      max_retries     = 1
      timeout         = "300s"

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.subnet.id
        }
      }

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
        image   = local.imagem_api
        command = ["node", "dist/scripts/migrar-outbox.js"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        volume_mounts {
          name       = "db-password"
          mount_path = "/secrets"
        }

        dynamic "env" {
          for_each = local.ambiente_comum_app
          content {
            name  = env.value.nome
            value = env.value.valor
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.db_password,
    google_secret_manager_secret_iam_member.migracoes_le_db_password,
    google_compute_instance.postgres,
  ]
}
