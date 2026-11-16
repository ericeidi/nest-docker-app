import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

// Host 0.0.0.0 é obrigatório dentro do container: localhost só aceitaria conexões internas
const HOST_PADRAO = '0.0.0.0';
const PORTA_PADRAO = 3000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Trata SIGTERM/SIGINT enviados por `docker stop` para encerrar a aplicação de forma limpa
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const portaAplicacao = Number(configService.get<string>('PORT', String(PORTA_PADRAO)));

  await app.listen(portaAplicacao, HOST_PADRAO);
}
await bootstrap();
