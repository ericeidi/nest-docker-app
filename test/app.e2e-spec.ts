import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from './../src/app.module.js';
import { configurarSegurancaHttp } from './../src/seguranca/seguranca-http.js';

// Mesma imagem pinada do docker-compose.yml — o teste roda contra a mesma versão do banco
const IMAGEM_POSTGRES =
  'postgres:18.7-alpine@sha256:b6972e1115a4ff8eba5d7f7d19184926d1e16d7d1136ae1e1a7ebf286da0f015';

// Limite baixo para provar o 429 sem disparar centenas de requisições
const LIMITE_REQUISICOES_TESTE = 3;
const ORIGEM_PERMITIDA = 'https://permitido.exemplo';
const ORIGEM_NAO_PERMITIDA = 'https://atacante.exemplo';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let containerPostgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    // Postgres descartável só para o teste — não toca no banco de desenvolvimento
    containerPostgres = await new PostgreSqlContainer(IMAGEM_POSTGRES).start();

    // Variáveis do ambiente de execução têm precedência sobre o .env no @nestjs/config
    process.env.DB_HOST = containerPostgres.getHost();
    process.env.DB_PORT = String(containerPostgres.getPort());
    process.env.DB_USER = containerPostgres.getUsername();
    process.env.DB_PASSWORD = containerPostgres.getPassword();
    process.env.DB_NAME = containerPostgres.getDatabase();
    process.env.THROTTLE_LIMIT = String(LIMITE_REQUISICOES_TESTE);
    process.env.THROTTLE_TTL_MS = '60000';
    process.env.CORS_ORIGINS = ORIGEM_PERMITIDA;
    // Schema nest_outbox criado na inicialização e relay sem loop em background
    process.env.OUTBOX_MIGRAR_NA_INICIALIZACAO = 'true';
    process.env.OUTBOX_RELAY_MODO = 'sob-demanda';
  });

  // App novo por teste: o contador do rate limit (em memória) começa zerado
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mesma configuração de segurança do main.ts
    configurarSegurancaHttp(app, app.get(ConfigService));
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health/db (GET) — conecta no PostgreSQL', () => {
    return request(app.getHttpServer())
      .get('/health/db')
      .expect(200)
      .expect((resposta) => {
        expect(resposta.body.status).toBe('ok');
        expect(resposta.body.info.postgres.status).toBe('up');
      });
  });

  it('não expõe X-Powered-By e envia headers de segurança', async () => {
    const resposta = await request(app.getHttpServer()).get('/').expect(200);

    expect(resposta.headers['x-powered-by']).toBeUndefined();
    expect(resposta.headers['content-security-policy']).toBeDefined();
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['strict-transport-security']).toBeDefined();
    expect(resposta.headers['x-frame-options']).toBeDefined();
  });

  it(`responde 429 após ${LIMITE_REQUISICOES_TESTE} requisições na janela`, async () => {
    const servidor = app.getHttpServer();
    for (let numeroRequisicao = 1; numeroRequisicao <= LIMITE_REQUISICOES_TESTE; numeroRequisicao++) {
      await request(servidor).get('/').expect(200);
    }
    await request(servidor).get('/').expect(429);
  });

  it('health checks não sofrem rate limit', async () => {
    const servidor = app.getHttpServer();
    for (let numeroRequisicao = 1; numeroRequisicao <= LIMITE_REQUISICOES_TESTE + 3; numeroRequisicao++) {
      await request(servidor).get('/health').expect(200);
    }
  });

  it('CORS libera só origens configuradas', async () => {
    const servidor = app.getHttpServer();

    const respostaPermitida = await request(servidor).get('/').set('Origin', ORIGEM_PERMITIDA).expect(200);
    expect(respostaPermitida.headers['access-control-allow-origin']).toBe(ORIGEM_PERMITIDA);

    const respostaNegada = await request(servidor).get('/').set('Origin', ORIGEM_NAO_PERMITIDA).expect(200);
    expect(respostaNegada.headers['access-control-allow-origin']).toBeUndefined();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await containerPostgres?.stop();
  });
});
