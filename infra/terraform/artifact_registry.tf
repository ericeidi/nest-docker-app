# Repositório da imagem da API.
# Limpeza automática para ficar dentro dos 0,5 GB gratuitos: mantém as 2 versões mais recentes
# e apaga o resto com mais de 1 dia (KEEP tem precedência sobre DELETE).
resource "google_artifact_registry_repository" "app" {
  location      = var.regiao
  repository_id = "app"
  format        = "DOCKER"
  description   = "Imagens da nest-docker-app"

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "manter-2-mais-recentes"
    action = "KEEP"
    most_recent_versions {
      keep_count = 2
    }
  }

  cleanup_policies {
    id     = "apagar-antigas"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "86400s"
    }
  }

  depends_on = [google_project_service.apis]
}

# Proxy do Docker Hub: a VM sem IP público puxa a imagem do Postgres por aqui (Private Google Access)
resource "google_artifact_registry_repository" "dockerhub_proxy" {
  location      = var.regiao
  repository_id = "dockerhub-proxy"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  description   = "Cache remoto do Docker Hub (imagem do Postgres)"

  remote_repository_config {
    docker_repository {
      public_repository = "DOCKER_HUB"
    }
  }

  depends_on = [google_project_service.apis]
}

locals {
  registro_docker = "${var.regiao}-docker.pkg.dev"
  imagem_api      = "${local.registro_docker}/${var.projeto_id}/${google_artifact_registry_repository.app.repository_id}/nest-api:${var.tag_imagem_api}"
  imagem_postgres = "${local.registro_docker}/${var.projeto_id}/${google_artifact_registry_repository.dockerhub_proxy.repository_id}/${var.imagem_postgres}"
}
