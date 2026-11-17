# VM do Postgres. No dev (free tier): e2-micro + 30 GB pd-standard no total (10 boot + 20 dados).
# Tamanhos por ambiente em envs/<ambiente>.tfvars.
# Sem IP público (nada de access_config) → sem cobrança de IPv4 e sem exposição à internet.

resource "google_compute_disk" "pgdata" {
  name = "nest-postgres-dados"
  type = "pd-standard"
  zone = var.zona
  size = var.tamanho_disco_dados_gb

  depends_on = [google_project_service.apis]
}

resource "google_compute_instance" "postgres" {
  name         = "nest-postgres"
  machine_type = var.tipo_maquina_postgres
  zone         = var.zona
  tags         = ["postgres"]

  # Permite trocar machine_type/metadata sem recriar manualmente
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      # Container-Optimized OS: Docker já instalado, SO mínimo e somente leitura
      image = "cos-cloud/cos-stable"
      size  = 10
      type  = "pd-standard"
    }
  }

  attached_disk {
    source      = google_compute_disk.pgdata.id
    device_name = "pgdata"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.subnet.id
    network_ip = google_compute_address.postgres_interno.address
    # Sem access_config: VM sem IP público
  }

  service_account {
    email  = google_service_account.postgres.email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  metadata = {
    enable-oslogin         = "TRUE"
    google-logging-enabled = "true"
    user-data = templatefile("${path.module}/templates/postgres-cloud-init.yaml.tftpl", {
      projeto_id          = var.projeto_id
      registro_docker     = local.registro_docker
      imagem_postgres     = local.imagem_postgres
      faixa_subnet        = var.faixa_subnet
      banco_nome          = var.banco_nome
      banco_usuario_app   = var.banco_usuario_app
      banco_usuario_admin = var.banco_usuario_admin
      segredo_app         = google_secret_manager_secret.db_password.secret_id
      segredo_admin       = google_secret_manager_secret.postgres_admin_password.secret_id
      # Reaproveita o MESMO script de criação da role usado no docker-compose
      script_criar_role_app = file("${path.module}/../../docker/postgres/init/01-criar-role-app.sh")
    })
  }

  # Os segredos e permissões precisam existir antes do primeiro boot
  depends_on = [
    google_secret_manager_secret_version.db_password,
    google_secret_manager_secret_version.postgres_admin_password,
    google_secret_manager_secret_iam_member.postgres_le_db_password,
    google_secret_manager_secret_iam_member.postgres_le_admin_password,
    google_artifact_registry_repository_iam_member.postgres_le_dockerhub_proxy,
  ]
}
