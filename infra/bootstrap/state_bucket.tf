# Bucket do state remoto do Terraform principal.
# O state contém as senhas geradas → bucket privado, acesso só para o dono do projeto e a SA do CI.
resource "google_storage_bucket" "tfstate" {
  name     = "${var.projeto_id}-tfstate"
  location = upper(var.regiao)

  # Standard em região US = dentro dos 5 GB gratuitos
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Histórico do state: permite recuperar uma versão anterior se algo corromper
  versioning {
    enabled = true
  }

  # Mantém só as 5 versões antigas mais recentes (custo ~zero)
  lifecycle_rule {
    condition {
      num_newer_versions = 5
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  # Proteção contra apagar o bucket com o state dentro
  force_destroy = false

  depends_on = [google_project_service.bootstrap]
}
