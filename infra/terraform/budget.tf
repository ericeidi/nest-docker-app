# Alerta de orçamento: envia e-mail aos administradores da conta de faturamento.
# NÃO bloqueia gastos — é só aviso.
resource "google_billing_budget" "teste" {
  billing_account = var.conta_faturamento
  display_name    = "nest-docker-lab (teste)"

  budget_filter {
    projects = ["projects/${data.google_project.atual.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.orcamento_moeda
      units         = tostring(var.orcamento_valor)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.apis]
}
