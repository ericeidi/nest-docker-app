# Mensageria assíncrona (outbox + Pub/Sub)

Issue #47. Jobs em background disparados por eventos gravados na mesma transação dos dados de negócio.

- Código: `src/mensageria/` (núcleo), `src/worker/` (endpoints do worker), `src/demo/` (exemplo completo)
- Infra GCP: `infra/terraform/pubsub.tf`, `scheduler.tf`, `cloudrun.tf` — ordem de subida e operação da DLQ em `infra/terraform/README.md` → "Mensageria"
- Biblioteca: `@nestjs/outbox` (store PostgreSQL, schema `nest_outbox`) + transporte Pub/Sub próprio (`TransportePubSub`)

## Visão geral

```
 API (MODO_APP=api)                                         Worker (MODO_APP=worker, privado)
 ┌──────────────────────────────┐                           ┌───────────────────────────────────┐
 │ transação                    │                           │ POST /internal/eventos            │
 │  ├─ dados de negócio         │                           │  ├─ lê envelope (idEvento, topico)│
 │  └─ outbox.add()  ──► nest_outbox.messages              │  └─ transação                     │
 │ commit                       │        │                  │      ├─ inbox (dedupe por id)     │
 │ disparadorRelay.aposCommit() │        ▼                  │      └─ manipulador.executar()    │
 └──────────────────────────────┘     relay ──► tópico eventos-app ──push OIDC──►              │
                                        ▲                  │                                   │
   Cloud Scheduler (1/min) ──► POST /internal/outbox/relay (no worker) ─ drena pendentes       │
                                                            └───────────────────────────────────┘
                                         falha 5x no worker ──► eventos-app-dlq ──► eventos-app-dlq-inspecao (pull, 7 dias)
```

1. O produtor grava o evento com `outbox.add()` **na mesma transação** dos dados. Ou os dois confirmam, ou nenhum.
2. Depois do commit, `DisparadorRelay.aposCommit()` aciona o relay, que publica no tópico `eventos-app`. O `data` leva só o payload; `idEvento` (id do outbox) e `topico` vão como atributos.
3. A assinatura push `eventos-app-worker` entrega no worker (`POST /internal/eventos`).
4. O worker registra o `idEvento` no inbox (`nest_outbox.inbox`) e roda o manipulador do tópico na mesma transação.
5. O Cloud Scheduler chama `POST /internal/outbox/relay` a cada minuto como rede de segurança: publica o que ficou pendente (publicação após commit que falhou, instância que caiu logo depois do commit).

## Modos

### `MODO_APP` — papel do processo

| Valor | Módulo raiz | O que expõe |
|---|---|---|
| `api` (padrão) | `AppModule` | rotas da aplicação; produz eventos |
| `worker` | `WorkerModule` | `POST /internal/eventos` (push do Pub/Sub), `POST /internal/outbox/relay` (Scheduler), health |

Mesma imagem para os dois. É lido de `process.env` **antes** do Nest subir, então tem que vir do ambiente do container (no `start:dev`: `MODO_APP=worker npm run start:dev`), não do `.env`.

### `OUTBOX_RELAY_MODO` — como o relay é acionado

| Valor | Onde | Comportamento |
|---|---|---|
| `continuo` (padrão) | docker compose, VM | loop de polling em background; `aposCommit()` só acorda o loop (`relay.notify()`) |
| `sob-demanda` | Cloud Run | sem loop; `aposCommit()` roda `relay.runOnce()` dentro da requisição, e o Scheduler drena o resto |

No Cloud Run com `cpu_idle = true` não há CPU entre requisições, então um loop em background ficaria parado. Por isso a publicação acontece dentro da requisição. Se ela falhar, `aposCommit()` só loga um warning (nunca lança: os dados já foram confirmados) e a mensagem fica pendente até a próxima chamada do Scheduler.

`drenar()` (endpoint do Scheduler) roda no máximo 20 rodadas por chamada.

## Garantias e o que o manipulador precisa respeitar

- **Entrega pelo menos uma vez.** A mesma mensagem pode chegar mais de uma vez: republicação após timeout, reentrega do Pub/Sub, replay da DLQ.
- **Execução no máximo uma vez por `consumidor` + `idEvento`** para o que é escrito no banco: o registro no inbox e as escritas feitas por `contexto.gerenciadorTransacao` confirmam juntos. Se o manipulador lançar, tudo é desfeito (inclusive o registro no inbox) e a reentrega roda de novo. Duplicata → 204 sem executar.
- **Efeitos externos não são desfeitos** (email, SMS, chamada HTTP). Repasse `contexto.idEvento` como idempotency key ao provedor.
- **Sem garantia de ordem.** Mensagens podem chegar fora de ordem. Verifique o estado atual antes de transicionar (ex.: só cancela se ainda está agendado).
- **Payload sem dados pessoais.** Só ids e datas. O worker nunca loga o payload, só `idEvento`, `topico` e `tentativa`.
- **Escritas no banco dentro do manipulador:** use `contexto.gerenciadorTransacao`. Escrita por outra conexão fica fora da transação e não é desfeita no rollback.

## Como adicionar um job

Exemplo completo e funcional em `src/demo/`. Para um tópico novo, ex. `usuario.criado`:

**1. Tópico e payload** (constante compartilhada entre produtor e manipulador):

```ts
export const TOPICO_USUARIO_CRIADO = 'usuario.criado';

/** Só ids e datas, nunca dados pessoais. */
export interface PayloadUsuarioCriado {
  usuarioId: string;
  criadoEm: string;
}
```

**2. Produtor** (lado da API). O módulo importa `MensageriaModule`; o service injeta `DataSource`, `Outbox<EntityManager>` e `DisparadorRelay`:

```ts
const usuarioCriado = await this.dataSource.transaction(async (gerenciadorTransacao) => {
  const usuario = await gerenciadorTransacao.save(Usuario, novoUsuario);
  await this.outbox.add(gerenciadorTransacao, {
    topic: TOPICO_USUARIO_CRIADO,
    payload: { usuarioId: usuario.id, criadoEm: new Date().toISOString() } satisfies PayloadUsuarioCriado,
  });
  return usuario;
});

// Só depois do commit: a linha do outbox precisa estar visível para o relay
await this.disparadorRelay.aposCommit();
```

**3. Manipulador** (lado do worker) implementando `ManipuladorEvento`:

```ts
@Injectable()
export class EnviarBoasVindasManipulador implements ManipuladorEvento {
  readonly topico = TOPICO_USUARIO_CRIADO;
  /** Identidade no inbox. NUNCA renomeie: um nome novo faz as mensagens antigas parecerem novas. */
  readonly consumidor = 'enviar-boas-vindas';

  async executar(payload: unknown, contexto: ContextoEvento): Promise<void> {
    // Valide o payload antes de usar: ele chega como unknown
    // Efeito externo: idempotency key = contexto.idEvento
  }
}
```

**4. Registro no `WorkerModule`** (`src/worker/worker.module.ts`): adicione a classe em `providers` **e** na lista `inject` de `MANIPULADORES_EVENTO`.

```ts
providers: [
  TarefaDemoManipulador,
  EnviarBoasVindasManipulador,
  {
    provide: MANIPULADORES_EVENTO,
    inject: [TarefaDemoManipulador, EnviarBoasVindasManipulador],
    useFactory: (...manipuladores: ManipuladorEvento[]) => manipuladores,
  },
  ProcessadorEventos,
],
```

Regras:
- **Um manipulador por tópico.** Dois para o mesmo tópico → erro na inicialização do worker.
- **Tópico sem manipulador** → o worker responde erro (`TopicoSemManipuladorError`), a mensagem é reentregue e acaba na DLQ. Faça o deploy do worker **antes** (ou junto) do produtor.
- **Não precisa de infra nova:** todos os tópicos do outbox passam pelo mesmo tópico Pub/Sub `eventos-app`; o roteamento é pelo atributo `topico`.
- O manipulador tem que terminar dentro do `ack_deadline` da assinatura (60s, `prazo_ack_pubsub_segundos`). Trabalho mais longo precisa de outra abordagem.

## Falhas e as duas DLQs

| | Outbox (`nest_outbox.dead_letters`) | Pub/Sub (`eventos-app-dlq`) |
|---|---|---|
| Falha de quê | **publicar** no Pub/Sub | **processar** no worker (resposta não-2xx) |
| Tentativas | 10, backoff 1s × 2 até 5 min (`mensageria.module.ts`) | 5 entregas, backoff 10s–600s (`tentativas_entrega_pubsub`) |
| Onde fica | tabela no Postgres | assinatura pull `eventos-app-dlq-inspecao`, retenção de 7 dias |
| Inspeção / replay | endpoints internos do worker (abaixo) | `infra/terraform/README.md` → "DLQ" |
| Retenção | 14 dias (`OUTBOX_RETENCAO_DEAD_LETTERS_DIAS`) | 7 dias |

Envelope inválido no push (sem `idEvento`, sem `topico`, `data` que não é JSON) → 400 → reentregue e, depois do limite, vai para a DLQ do Pub/Sub, onde fica visível.

**Replay da DLQ do Pub/Sub:** corrija a causa e republique em `eventos-app` com os **mesmos atributos** (`idEvento`, `topico`). O worker deduplica pelo `idEvento`, então o replay de uma mensagem que já foi processada é inofensivo. Os comandos estão no README da infra.

> No emulador local a DLQ funciona, mas o emulador não envia `deliveryAttempt`: `contexto.tentativa` chega `undefined`.

### Dead letters do outbox

Rotas no worker (privado no Cloud Run: só quem tem `roles/run.invoker`):

| Rota | O que faz |
|---|---|
| `GET /internal/outbox/dead-letters?limit=&offset=` | lista as mais recentes (limit 1–100, padrão 50): id, tópico, motivo, tentativas, último erro, data. **Sem payload**, que pode conter dados pessoais |
| `POST /internal/outbox/dead-letters/:id/requeue` | devolve ao outbox com novas tentativas e o **mesmo id** (o inbox continua deduplicando); 204, ou 404 se não existe |

No GCP: `$(terraform output -raw comando_listar_dead_letters_outbox)` e `comando_reenfileirar_dead_letter_outbox` (troque `<ID>`). O relay publica na próxima rodada (até 1 min).

### Retenção

O pacote não limpa `nest_outbox.inbox` nem `nest_outbox.dead_letters`. `POST /internal/outbox/manutencao` no worker apaga inbox com mais de `OUTBOX_RETENCAO_INBOX_DIAS` (30) e dead letters com mais de `OUTBOX_RETENCAO_DEAD_LETTERS_DIAS` (14). No GCP, o Cloud Scheduler `manutencao-outbox` chama uma vez por dia (06:00 UTC).

O inbox precisa durar **pelo menos** tanto quanto as dead letters: uma dead letter reenfileirada mantém o id, e se o inbox já tiver esquecido esse id o job roda de novo. A configuração recusa subir com inbox < dead letters.

## Rodando local (docker compose)

| Serviço | Papel |
|---|---|
| `pubsub-emulator` | emulador oficial do Pub/Sub (estado só em memória) |
| `pubsub-setup` | job: cria tópico, DLQ e assinatura push para `http://worker:3000/internal/eventos` (equivalente ao Terraform; recusa rodar sem `PUBSUB_EMULATOR_HOST`) |
| `migracoes` | job: aplica as migrations do schema `nest_outbox` (`dist/scripts/migrar-outbox.js`) |
| `api` | `MODO_APP=api`, `DEMO_MENSAGERIA_HABILITADA=true` |
| `worker` | `MODO_APP=worker`, sem porta publicada |

As variáveis comuns ficam em `x-ambiente-app` no `docker-compose.yml` (`OUTBOX_RELAY_MODO=continuo`). Para rodar fora do compose, veja a seção "Mensageria" do `.env.api.example`.

Teste ponta a ponta:

```bash
docker compose up -d --build
curl -X POST http://localhost:${HOST_PORT:-3000}/demo/tarefas    # 202 { idEvento, tarefaId }
docker compose logs -f worker                                    # "Tarefa demo processada idEvento=..."
```

`POST /demo/tarefas` é uma rota pública que grava no banco: só existe com `DEMO_MENSAGERIA_HABILITADA=true`. **Nunca ligue em produção.**

### Variáveis

| Variável | Padrão | Descrição |
|---|---|---|
| `MODO_APP` | `api` | `api` ou `worker` (do ambiente do container) |
| `OUTBOX_RELAY_MODO` | `continuo` | `continuo` ou `sob-demanda` (Cloud Run) |
| `PUBSUB_PROJETO_ID` | detectado pelo client | projeto GCP do Pub/Sub |
| `PUBSUB_TOPICO_EVENTOS` | `eventos-app` | tópico onde o relay publica |
| `PUBSUB_EMULATOR_HOST` | — | definida = usa o emulador |
| `OUTBOX_MIGRAR_NA_INICIALIZACAO` | `false` | `true` só em testes/desenvolvimento; senão, rode o job de migração |
| `OUTBOX_RETENCAO_INBOX_DIAS` | `30` | dias que o inbox guarda ids processados (>= dead letters) |
| `OUTBOX_RETENCAO_DEAD_LETTERS_DIAS` | `14` | dias que uma dead letter do outbox fica disponível para requeue |
| `DEMO_MENSAGERIA_HABILITADA` | `false` | registra `POST /demo/tarefas` |

### Migrations do outbox

API e worker sobem com `migrate: false` e **falham na inicialização** se o schema `nest_outbox` estiver atrás da versão do pacote. Ao atualizar `@nestjs/outbox`, rode o job de migração antes do deploy: serviço `migracoes` no compose, Cloud Run Job `nest-migracoes` no GCP (`$(terraform output -raw comando_migrar_outbox)`). A role da aplicação precisa de `CREATE` no banco.

## Pontos em aberto

- **Sem correlation ID entre API e worker.** Ligar a requisição ao processamento do job exige busca por timestamp. Escopo no #15.
- **Pool de conexões vs `max_connections`.** Pool configurável por `DB_POOL_MAX` (default 10 por instância) contra `max_connections=30` no Postgres. Ver `infra/terraform/README.md` → "Conexões no Postgres".
