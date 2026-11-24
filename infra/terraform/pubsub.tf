# Mensageria: o relay do outbox (API/worker) publica em "eventos-app"; o Pub/Sub entrega por push
# ao nest-worker. Depois de N entregas falhas, a mensagem vai para "eventos-app-dlq".
# Mesmos nomes e políticas do emulador local (src/scripts/configurar-pubsub-local.ts).

locals {
  # Agente de serviço do Pub/Sub: é quem move mensagens para a DLQ e gera o token OIDC do push
  agente_servico_pubsub = "serviceAccount:service-${data.google_project.atual.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic" "eventos" {
  name = "eventos-app"

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "eventos_dlq" {
  name = "eventos-app-dlq"

  depends_on = [google_project_service.apis]
}

# Push para o worker, autenticado com OIDC (a SA tem roles/run.invoker no worker)
resource "google_pubsub_subscription" "eventos_worker" {
  name  = "eventos-app-worker"
  topic = google_pubsub_topic.eventos.id

  ack_deadline_seconds = var.prazo_ack_pubsub_segundos

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker.uri}/internal/eventos"

    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.eventos_dlq.id
    max_delivery_attempts = var.tentativas_entrega_pubsub
  }

  # Nunca expira por inatividade (o padrão apaga a assinatura após 31 dias sem uso)
  expiration_policy {
    ttl = ""
  }

  depends_on = [
    google_pubsub_topic_iam_member.agente_publica_na_dlq,
  ]
}

# Pull na DLQ: as mensagens mortas ficam guardadas para inspeção e replay (7 dias)
resource "google_pubsub_subscription" "eventos_dlq_inspecao" {
  name  = "eventos-app-dlq-inspecao"
  topic = google_pubsub_topic.eventos_dlq.id

  message_retention_duration = "604800s"
  ack_deadline_seconds       = 60

  expiration_policy {
    ttl = ""
  }
}

# ---------- IAM do Pub/Sub ----------

# Relay da API (após commit) e do worker (Cloud Scheduler) publicam no tópico de eventos
resource "google_pubsub_topic_iam_member" "api_publica_eventos" {
  topic  = google_pubsub_topic.eventos.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_pubsub_topic_iam_member" "worker_publica_eventos" {
  topic  = google_pubsub_topic.eventos.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.worker.email}"
}

# Dead lettering: o agente do Pub/Sub precisa publicar na DLQ e confirmar (ack) na assinatura de origem
resource "google_pubsub_topic_iam_member" "agente_publica_na_dlq" {
  topic  = google_pubsub_topic.eventos_dlq.id
  role   = "roles/pubsub.publisher"
  member = local.agente_servico_pubsub

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_subscription_iam_member" "agente_assina_origem_da_dlq" {
  subscription = google_pubsub_subscription.eventos_worker.id
  role         = "roles/pubsub.subscriber"
  member       = local.agente_servico_pubsub
}
