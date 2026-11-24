# Ambiente dev — free tier.
#   terraform init -reconfigure -backend-config=envs/dev.backend.hcl
#   terraform plan -var-file=envs/dev.tfvars
# conta_faturamento e tag_imagem_api NÃO ficam aqui (repo público):
# localmente em terraform.tfvars; no CI a conta vem de variável do GitHub e a tag do commit (ver .github/workflows/terraform.yml).

projeto_id = "nest-docker-lab-dexicm"
regiao     = "us-central1"
zona       = "us-central1-a"

tipo_maquina_postgres  = "e2-micro"
tamanho_disco_dados_gb = 20
max_instancias_api     = 1
api_publica            = true

# Rate limiting: requisições por IP a cada THROTTLE_TTL_MS (default 100)
throttle_limite = 200

orcamento_moeda = "BRL"
orcamento_valor = 30
