# Valores usados no workflow do GitHub Actions (variáveis do environment)
output "bucket_state" {
  description = "Bucket do state remoto (envs/*.backend.hcl)"
  value       = google_storage_bucket.tfstate.name
}

output "workload_identity_provider" {
  description = "GitHub var GCP_WORKLOAD_IDENTITY_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "service_account_ci" {
  description = "GitHub var GCP_SERVICE_ACCOUNT"
  value       = google_service_account.terraform_ci.email
}
