import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { NonRetryableMessageError } from '@nestjs/outbox';
import { CLIENTE_PUBSUB } from './../src/mensageria/mensageria.constants.js';
import { TarefaDemoManipulador } from './../src/demo/tarefa-demo.manipulador.js';

// Mesma imagem pinada do docker-compose.yml
const IMAGEM_POSTGRES =
  'postgres:18.7-alpine@sha256:b6972e1115a4ff8eba5d7f7d19184926d1e16d7d1136ae1e1a7ebf286da0f015';

// Backoff da 1ª republicação é de até 1s (jitter 'equal' sobre delay de 1s)
const ESPERA_BACKOFF_PRIMEIRA_TENTATIVA_MS = 1200;

interface MensagemPublicada {
  data: Buffer;
  attributes: Record<string, string>;
}

/**
 * Caminho completo sem o Pub/Sub real: API grava no outbox e o relay publica num client falso,
 * que captura a mensagem; o teste entrega ao worker o mesmo envelope que o push do Pub/Sub manda.
 * O Pub/Sub real (emulador) é validado pelo docker compose.
 */
describe('Mensageria: outbox → relay → worker (e2e)', () => {
  let containerPostgres: StartedPostgreSqlContainer;
  let api: INestApplication<App>;
  let worker: INestApplication<App>;
  let dataSourceApi: DataSource;
  const mensagensPublicadas: MensagemPublicada[] = [];
  const publicarNoPubSub = vi.fn(async (mensagem: MensagemPublicada) => {
    mensagensPublicadas.push(mensagem);
    return `id-pubsub-${mensagensPublicadas.length}`;
  });
  const clientePubSubFalso = { topic: () => ({ publishMessage: publicarNoPubSub }), close: async () => {} };

  function montarEnvelopePush(mensagem: MensagemPublicada, tentativaEntrega: number) {
    return {
      message: { data: mensagem.data.toString('base64'), attributes: mensagem.attributes, messageId: 'x' },
      subscription: 'projects/nest-local/subscriptions/eventos-app-worker',
      deliveryAttempt: tentativaEntrega,
    };
  }

  async function contarMensagensPendentes(): Promise<number> {
    const [linha] = await dataSourceApi.query('SELECT count(*)::int AS quantidade FROM nest_outbox.messages');
    return linha.quantidade;
  }

  beforeAll(async () => {
    containerPostgres = await new PostgreSqlContainer(IMAGEM_POSTGRES).start();

    process.env.DB_HOST = containerPostgres.getHost();
    process.env.DB_PORT = String(containerPostgres.getPort());
    process.env.DB_USER = containerPostgres.getUsername();
    process.env.DB_PASSWORD = containerPostgres.getPassword();
    process.env.DB_NAME = containerPostgres.getDatabase();
    process.env.OUTBOX_MIGRAR_NA_INICIALIZACAO = 'true';
    // Sem loop em background: o teste controla quando o relay roda
    process.env.OUTBOX_RELAY_MODO = 'sob-demanda';
    process.env.DEMO_MENSAGERIA_HABILITADA = 'true';

    // Import depois das variáveis: o ConditionalModule da demo avalia o ambiente no import
    const { AppModule } = await import('./../src/app.module.js');
    const { WorkerModule } = await import('./../src/worker/worker.module.js');

    const moduloApi = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_PUBSUB)
      .useValue(clientePubSubFalso)
      .compile();
    api = moduloApi.createNestApplication();
    await api.init();
    dataSourceApi = api.get(DataSource);

    const moduloWorker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(CLIENTE_PUBSUB)
      .useValue(clientePubSubFalso)
      .compile();
    worker = moduloWorker.createNestApplication();
    await worker.init();
  });

  beforeEach(() => {
    mensagensPublicadas.length = 0;
    publicarNoPubSub.mockClear();
  });

  it('API responde 202 e publica o evento logo após o commit', async () => {
    const resposta = await request(api.getHttpServer()).post('/demo/tarefas').expect(202);

    expect(mensagensPublicadas).toHaveLength(1);
    expect(mensagensPublicadas[0].attributes).toEqual({
      idEvento: resposta.body.idEvento,
      topico: 'demo.tarefa-criada',
    });
    expect(JSON.parse(mensagensPublicadas[0].data.toString('utf8')).tarefaId).toBe(resposta.body.tarefaId);
    // Publicada = removida do outbox
    expect(await contarMensagensPendentes()).toBe(0);
  });

  it('worker processa uma vez e ignora a reentrega do mesmo evento', async () => {
    const executarJob = vi.spyOn(worker.get(TarefaDemoManipulador), 'executar');
    await request(api.getHttpServer()).post('/demo/tarefas').expect(202);
    const envelope = montarEnvelopePush(mensagensPublicadas[0], 1);

    await request(worker.getHttpServer()).post('/internal/eventos').send(envelope).expect(204);
    await request(worker.getHttpServer()).post('/internal/eventos').send(montarEnvelopePush(mensagensPublicadas[0], 2)).expect(204);

    expect(executarJob).toHaveBeenCalledTimes(1);
    executarJob.mockRestore();
  });

  it('falha no job responde 500 e a reentrega roda o job de novo', async () => {
    const executarJob = vi
      .spyOn(worker.get(TarefaDemoManipulador), 'executar')
      .mockRejectedValueOnce(new Error('provedor fora do ar'));
    await request(api.getHttpServer()).post('/demo/tarefas').expect(202);

    await request(worker.getHttpServer()).post('/internal/eventos').send(montarEnvelopePush(mensagensPublicadas[0], 1)).expect(500);
    await request(worker.getHttpServer()).post('/internal/eventos').send(montarEnvelopePush(mensagensPublicadas[0], 2)).expect(204);

    expect(executarJob).toHaveBeenCalledTimes(2);
    executarJob.mockRestore();
  });

  it('envelope inválido responde 400', async () => {
    await request(worker.getHttpServer()).post('/internal/eventos').send({ qualquer: 'coisa' }).expect(400);
  });

  it('Pub/Sub fora do ar: API responde 202, a mensagem fica pendente e o relay do worker publica depois', async () => {
    publicarNoPubSub.mockRejectedValueOnce(new Error('UNAVAILABLE'));

    await request(api.getHttpServer()).post('/demo/tarefas').expect(202);
    expect(await contarMensagensPendentes()).toBe(1);

    await new Promise((resolver) => setTimeout(resolver, ESPERA_BACKOFF_PRIMEIRA_TENTATIVA_MS));
    const resposta = await request(worker.getHttpServer()).post('/internal/outbox/relay').expect(200);

    expect(resposta.body.publicadas).toBe(1);
    expect(await contarMensagensPendentes()).toBe(0);
  });

  it('publicação rejeitada vai para as dead letters do outbox; o requeue publica de novo com o mesmo id', async () => {
    publicarNoPubSub.mockRejectedValueOnce(new NonRetryableMessageError('payload recusado'));

    const resposta = await request(api.getHttpServer()).post('/demo/tarefas').expect(202);

    const listagem = await request(worker.getHttpServer()).get('/internal/outbox/dead-letters').expect(200);
    const deadLetter = listagem.body.find((item: { id: string }) => item.id === resposta.body.idEvento);
    expect(deadLetter).toMatchObject({ topico: 'demo.tarefa-criada', motivo: 'rejected' });
    expect(deadLetter).not.toHaveProperty('payload');

    await request(worker.getHttpServer()).post(`/internal/outbox/dead-letters/${deadLetter.id}/requeue`).expect(204);
    await request(worker.getHttpServer()).post('/internal/outbox/relay').expect(200);

    expect(mensagensPublicadas).toHaveLength(1);
    expect(mensagensPublicadas[0].attributes.idEvento).toBe(resposta.body.idEvento);
    await request(worker.getHttpServer())
      .post(`/internal/outbox/dead-letters/${deadLetter.id}/requeue`)
      .expect(404);
  });

  it('dead-letters valida paginação e formato do id', async () => {
    await request(worker.getHttpServer()).get('/internal/outbox/dead-letters?limit=101').expect(400);
    await request(worker.getHttpServer()).post('/internal/outbox/dead-letters/nao-e-uuid/requeue').expect(400);
  });

  it('manutenção roda a retenção no banco real', async () => {
    const resposta = await request(worker.getHttpServer()).post('/internal/outbox/manutencao').expect(200);

    // Tudo foi criado agora: nada passa da retenção
    expect(resposta.body).toEqual({ inboxRemovidas: 0, deadLettersRemovidas: 0 });
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
    await containerPostgres?.stop();
  });
});
