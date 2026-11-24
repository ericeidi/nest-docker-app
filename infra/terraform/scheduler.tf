# Rede de segurança do outbox: a cada minuto o worker publica o que ficou pendente
# (publicação após commit que falhou, API que caiu logo depois do commit).
# Free tier do Cloud Scheduler: 3 jobs por conta de faturamento.
resource "google_cloud_scheduler_job" "relay_outbox" {
  name        = "relay-outbox"
  region      = var.regiao
  description = "Drena o outbox (POST /internal/outbox/relay no nest-worker)"
  schedule    = var.agenda_relay_outbox
  time_zone   = "Etc/UTC"

  attempt_deadline = "60s"

  # Sem retry: a próxima execução (1 min) já cobre uma falha
  retry_config {
    retry_count = 0
  }

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
}
