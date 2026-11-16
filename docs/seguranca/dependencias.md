# Segurança de dependências

## Atualização automática (Dependabot)

`.github/dependabot.yml` — verificação semanal (segunda-feira):

| Ecossistema | O que acompanha | Agrupamento |
|---|---|---|
| `npm` | `package.json` / `package-lock.json` | minors+patches de produção juntos; de dev juntos; `@nestjs/*` sempre juntos |
| `docker` | `Dockerfile` (`node:…-alpine@sha256`, `alpine:…@sha256`) | — |
| `docker-compose` | `docker-compose.yml` (`postgres:…-alpine@sha256`) | — |
| `github-actions` | workflows (CI da #18), pinados por SHA | — |

Os PRs do Dependabot passam pelo fluxo normal: `main` protegida, validação do template de PR.

> **Atenção ao atualizar a imagem do Node:** o runtime usa `alpine` puro na **mesma versão do Alpine** da imagem do Node (ver `DOCKER.md` → Imagem). Se o PR do Dependabot subir só uma das duas, alinhe a outra no mesmo PR.

## Auditoria `npm audit` — 16/11/2026

| Escopo | Antes | Depois |
|---|---|---|
| Produção (`--omit=dev`) | **0** | **0** |
| Total (inclui dev) | 12 (2 high, 8 moderate, 2 low) | **7 moderate**, 0 high |

### Corrigido

| Origem | Vulnerabilidades | Ação |
|---|---|---|
| `@nestjs/mau@0.2.9` (CLI de deploy do Nest, veio do scaffold) | `tmp` (high), `undici` (high), `external-editor`, `inquirer`, `@nestjs/mau` | **Removido** — só usado pelo script `deploy: nest deploy`; o projeto não faz deploy na Mau |

### Aceito com justificativa (dev-only)

| Cadeia | Advisory | Por que não corrigir agora |
|---|---|---|
| `@testcontainers/postgresql@12.2.1` → `testcontainers` → `archiver@7` → `glob@10.5.0` | GHSA-3g3m-2fjr-6pw4 (corrigido só em `glob` ≥ 14.0.2) | Correção exige saltar major de dependência transitiva que não controlamos |
| … → `glob` / `readdir-glob` → `minimatch@9.0.9`, `minimatch@5.1.9` | GHSA-g3hv-75wg-m249 (corrigido em `minimatch` ≥ 11.0.1) | Idem |

- `npm audit fix` (sem `--force`): **não corrige nada**.
- `npm audit fix --force`: faria **downgrade** de `@testcontainers/postgresql` 12.2.1 → 10.10.4 — rejeitado.
- Exposição: só em `npm run test:e2e` (máquina do dev/CI), com entradas fixas do próprio teste. **Não entra na imagem** (runtime instala `--omit=dev`).
- Reavaliar quando o Dependabot propuser nova versão do `testcontainers`.

```bash
npm audit --omit=dev   # deve ser sempre 0
npm audit              # dev: conferir se só restam os itens aceitos acima
```
