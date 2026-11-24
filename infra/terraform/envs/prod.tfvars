# EXEMPLO — ambiente prod (não provisionado). Fora do free tier: gera custo.
# Projeto GCP separado do dev (isola IAM, billing e quotas).
#   terraform init -reconfigure -backend-config=envs/prod.backend.hcl
#   terraform plan -var-file=envs/prod.tfvars

projeto_id = "<projeto-prod>"
regiao     = "us-central1"
zona       = "us-central1-a"

# e2-small (2 GB RAM): sai do free tier (~US$ 12/mês)
tipo_maquina_postgres  = "e2-small"
tamanho_disco_dados_gb = 50
max_instancias_api     = 3
# 3 API + 1 worker = 4 instâncias × 5 = 20 conexões (limite do Postgres: 30)
pool_conexoes_banco = 5

# API fechada: só contas com roles/run.invoker (ex.: atrás de um gateway)
api_publica = false

orcamento_moeda = "BRL"
orcamento_valor = 150
