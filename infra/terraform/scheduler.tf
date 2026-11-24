# Rede de segurança do outbox: a cada minuto o worker publica o que ficou pendente
# (publicação após commit que falhou, API que caiu logo depois do commit).
# Free tier do Cloud Scheduler: 3 jobs por conta de faturamento.
resource "google_cloud_scheduler_job" "relay_outbox" {
  name        = "relay-outbox"
  region      = var.regiao
  description = "Drena o outbox (POST /internal/outbox/relay no nest-worker)"
  schedule    = var.agenda_relay_outbox
  time_zone   = "Etc/UTC"

  # Sem retry: o padrão já é 0 tentativas extras, e a próxima execução (1 min) cobre uma falha
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/internal/outbox/relay"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_service_iam_member.worker_invocado_pelo_scheduler,
  ]

  lifecycle {
    # A API às vezes devolve retry_config com os valores padrão e às vezes omite o bloco:
    # declarar ou não o bloco gerava diff em todo plan. Usamos sempre o padrão (0 retries).
    ignore_changes = [retry_config]
  }
}

# Retenção do outbox: apaga inbox e dead letters antigos (POST /internal/outbox/manutencao).
# Segundo de 3 jobs do free tier.
resource "google_cloud_scheduler_job" "manutencao_outbox" {
  name        = "manutencao-outbox"
  region      = var.regiao
  description = "Retenção do outbox: inbox e dead letters antigos (POST /internal/outbox/manutencao no nest-worker)"
  schedule    = var.agenda_manutencao_outbox
  time_zone   = "Etc/UTC"

  # Sem retry_config: se falhar, roda de novo no dia seguinte sem perda
  attempt_deadline = "120s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/internal/outbox/manutencao"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_service_iam_member.worker_invocado_pelo_scheduler,
  ]

  lifecycle {
    # A API às vezes devolve retry_config com os valores padrão e às vezes omite o bloco:
    # declarar ou não o bloco gerava diff em todo plan. Usamos sempre o padrão (0 retries).
    ignore_changes = [retry_config]
  }
}
