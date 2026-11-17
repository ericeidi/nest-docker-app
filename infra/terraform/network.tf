# VPC própria, sem subnets automáticas.
resource "google_compute_network" "vpc" {
  name                    = "nest-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

# Private Google Access: a VM (sem IP público) alcança Artifact Registry e Secret Manager
# sem Cloud NAT (que seria cobrado).
resource "google_compute_subnetwork" "subnet" {
  name                     = "nest-subnet"
  region                   = var.regiao
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.faixa_subnet
  private_ip_google_access = true
}

# Postgres: só aceita conexões vindas da própria subnet (Cloud Run via Direct VPC egress usa IPs dela)
resource "google_compute_firewall" "permitir_postgres_da_subnet" {
  name      = "nest-permitir-postgres-da-subnet"
  network   = google_compute_network.vpc.id
  direction = "INGRESS"

  source_ranges = [var.faixa_subnet]
  target_tags   = ["postgres"]

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
}

# SSH só pelo IAP (faixa fixa do Google) — para diagnóstico via `gcloud compute ssh --tunnel-through-iap`
resource "google_compute_firewall" "permitir_ssh_iap" {
  name      = "nest-permitir-ssh-iap"
  network   = google_compute_network.vpc.id
  direction = "INGRESS"

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["postgres"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# IP interno fixo: o DB_HOST da API não muda se a VM for recriada
resource "google_compute_address" "postgres_interno" {
  name         = "nest-postgres-ip-interno"
  region       = var.regiao
  subnetwork   = google_compute_subnetwork.subnet.id
  address_type = "INTERNAL"
  address      = var.ip_interno_postgres
}
