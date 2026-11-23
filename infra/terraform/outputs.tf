output "api_url" {
  description = "URL pública da API no Cloud Run"
  value       = google_cloud_run_v2_service.api.uri
}

output "postgres_ip_interno" {
  description = "IP interno da VM do Postgres (DB_HOST da API)"
  value       = google_compute_address.postgres_interno.address
}

output "imagem_api" {
  description = "Caminho completo da imagem da API (use no docker build/push)"
  value       = local.imagem_api
}

output "comando_ssh_postgres" {
  description = "SSH na VM do Postgres via IAP (sem IP público)"
  value       = "gcloud compute ssh ${google_compute_instance.postgres.name} --zone ${var.zona} --tunnel-through-iap --project ${var.projeto_id}"
}

output "worker_url" {
  description = "URL do nest-worker (privado: só Pub/Sub e Cloud Scheduler invocam)"
  value       = google_cloud_run_v2_service.worker.uri
}

output "comando_migrar_outbox" {
  description = "Aplica as migrations do schema nest_outbox — rode antes de cada deploy de imagem nova"
  value       = "gcloud run jobs execute ${google_cloud_run_v2_job.migracoes.name} --region ${var.regiao} --project ${var.projeto_id} --wait"
}

output "comando_ler_dlq" {
  description = "Lê (sem confirmar) até 10 mensagens da DLQ"
  value       = "gcloud pubsub subscriptions pull ${google_pubsub_subscription.eventos_dlq_inspecao.name} --limit 10 --project ${var.projeto_id}"
}
