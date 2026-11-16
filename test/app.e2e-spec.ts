import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from './../src/app.module.js';

// Mesma imagem pinada do docker-compose.yml — o teste roda contra a mesma versão do banco
const IMAGEM_POSTGRES =
  'postgres:18.7-alpine@sha256:b6972e1115a4ff8eba5d7f7d19184926d1e16d7d1136ae1e1a7ebf286da0f015';

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
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await containerPostgres?.stop();
  });
});
