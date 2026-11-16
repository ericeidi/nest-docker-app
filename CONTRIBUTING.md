# Fluxo de trabalho

Toda entrega nasce de uma **issue** e chega na `main` por um **pull request** ligado a ela.

```
Issue #N  →  branch feat/N  →  commits feat(#N): ...  →  PR "Closes #N"  →  merge  →  issue fechada
```

## 1. Issue

- Abra pelo template: **Feature**, **Bug** ou **Chore** (issue em branco desabilitada).
- Preencha critérios de aceite verificáveis.
- Labels: tipo (`feature`, `bug`, `chore`) + área (`infra`, `database`, `security`, `tests`, `docs`) + prioridade (`P1`, `P2`, `P3`).
- Associe a um milestone.

## 2. Branch

Sempre a partir da `main` atualizada. Padrão `<tipo>/<número-da-issue>`:

| Tipo | Uso | Exemplo |
|---|---|---|
| `feat/` | Nova funcionalidade | `feat/12` |
| `fix/` | Correção de bug | `fix/15` |
| `chore/` | Manutenção, config, deps, infra | `chore/9` |
| `refactor/` | Refatoração sem mudar comportamento | `refactor/20` |
| `test/` | Apenas testes | `test/18` |

```bash
git switch main && git pull
git switch -c feat/12
```

## 3. Commits

Em português, padrão `<tipo>(#<issue>): <descrição>`:

```
feat(#12): adiciona migrations do TypeORM
fix(#15): corrige timeout na conexão com o banco
chore(#9): separa arquivos de ambiente por serviço
```

O `#12` vira link para a issue no GitHub.

## 4. Pull request

- Título no mesmo padrão do commit.
- Preencha o template e mantenha **`Closes #N`** — ao fazer merge, a issue fecha sozinha.
- Rode a checklist de validação do template antes de pedir merge.
- A `main` é protegida: mudanças só entram via PR.

## 5. Merge

- **Squash and merge** (um commit por entrega na `main`).
- Apague a branch após o merge.
