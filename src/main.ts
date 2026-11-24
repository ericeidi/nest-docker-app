import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { lerModoApp } from './modo-app.js';
import { criarLogger } from './observabilidade/logger-json.js';
import { configurarSegurancaHttp } from './seguranca/seguranca-http.js';
import { WorkerModule } from './worker/worker.module.js';

// Host 0.0.0.0 é obrigatório dentro do container: localhost só aceitaria conexões internas
const HOST_PADRAO = '0.0.0.0';
const PORTA_PADRAO = 3000;

async function bootstrap() {
  // Mesma imagem, dois papéis: MODO_APP=api (padrão) ou MODO_APP=worker
  const modoApp = lerModoApp(process.env.MODO_APP);
  // Logs em JSON com correlationId (LOG_JSON=false volta ao texto para leitura local)
  const app = await NestFactory.create(modoApp === 'worker' ? WorkerModule : AppModule, {
    logger: criarLogger(process.env.LOG_JSON),
  });

  // Trata SIGTERM/SIGINT enviados por `docker stop` para encerrar a aplicação de forma limpa
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);

  // Headers de segurança + CORS (antes do listen)
  configurarSegurancaHttp(app, configService);

  const portaAplicacao = Number(configService.get<string>('PORT', String(PORTA_PADRAO)));

  await app.listen(portaAplicacao, HOST_PADRAO);
}
await bootstrap();
