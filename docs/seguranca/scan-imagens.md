# Scan de vulnerabilidades das imagens

```bash
./scripts/scan-imagens.sh                 # todas as severidades
./scripts/scan-imagens.sh CRITICAL,HIGH   # só as graves
```

- Trivy **0.76.2** em container (pinado por digest), cache em volume `trivy-cache`.
- Imagens: `nest-docker-app:local` e o Postgres lido do `docker-compose.yml`.
- **Código de saída 1** se houver CRITICAL/HIGH **com correção disponível** — pronto para uso no CI (#18).

## Resultado — 16/11/2026

### API (`nest-docker-app:local`, Alpine 3.24.4)

| | Antes | Depois |
|---|---|---|
| Vulnerabilidades | 1 MEDIUM — `CVE-2026-4738` `zlib@1.3.2-r1` (corrigido em `1.4-r0`) | **0** |
| Correção | — | `apk upgrade --no-cache` no estágio `runtime` do `Dockerfile` |
| Tamanho | 295,6 MB | 296,1 MB |

`apk upgrade` aplica correções publicadas no repositório do Alpine depois do digest da imagem base. Contrapartida: builds em datas diferentes podem ter versões de pacotes diferentes (dentro do mesmo Alpine 3.24).

Dependências npm de produção na imagem: **0** vulnerabilidades (também confirmado por `npm audit --omit=dev` — ver `dependencias.md`).

### Postgres (`postgres:18.7-alpine@sha256:b6972e11…`)

| Severidade | Quantidade | Onde |
|---|---|---|
| CRITICAL | 1 | `/usr/local/bin/gosu` (stdlib Go 1.24.6) |
| HIGH | 25 | idem |
| MEDIUM | 31 | idem (+1 em `github.com/moby/sys/user@v0.1.0`) |
| LOW | 3 | idem |

**Todas** no binário `gosu` 1.19 (`go1.24.6`) da imagem oficial. Pacotes do Alpine e o próprio PostgreSQL: sem achados.

Por que não foi corrigido nesta entrega:
- O digest pinado **já é o mais recente** de `postgres:18-alpine` — não existe imagem oficial corrigida.
- Corrigir exige imagem derivada (trocar `gosu` por `su-exec` ou recompilar) → tratado na **issue #37**.

Exposição (análise, não verificada CVE a CVE): o `gosu` roda **uma vez** no entrypoint (`exec gosu postgres …`) para trocar de root para `postgres` e é substituído pelo processo do Postgres; não abre rede nem processa entrada externa. Os CVEs são da stdlib do Go (rede, TLS, parsing).

Acompanhamento: Dependabot (`docker-compose`) abre PR quando o upstream publicar novo digest; reexecutar o scan nesse PR.
