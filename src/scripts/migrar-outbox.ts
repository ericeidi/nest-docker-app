import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PostgresOutboxStore, fromTypeOrm } from '@nestjs/outbox/postgres';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';

/**
 * Aplica as migrations do schema nest_outbox (mensagens, dead letters, inbox).
 *
 * Roda ANTES do deploy, uma única vez: serviço `migracoes` no docker compose e Cloud Run Job
 * no GCP. API e worker sobem com `migrate: false` e falham na inicialização se o schema
 * estiver atrás da versão do pacote.
 *
 *   node dist/scripts/migrar-outbox.js
 *
 * A imagem de runtime não tem npm/npx, por isso não usamos `npx @nestjs/outbox migrate`.
 * Precisa do privilégio CREATE no banco (CREATE SCHEMA): ver docker/postgres/init.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
})
class MigracaoOutboxModule {}

async function migrarOutbox(): Promise<void> {
  const logger = new Logger('MigracaoOutbox');
  const contexto = await NestFactory.createApplicationContext(MigracaoOutboxModule, { logger: ['error', 'warn', 'log'] });

  try {
    const store = new PostgresOutboxStore({ executor: fromTypeOrm(contexto.get(DataSource)), migrate: true });
    // migrate() roda numa transação sob advisory lock: execuções simultâneas aplicam uma vez só
    const versoesAplicadas = await store.migrate();
    logger.log(
      versoesAplicadas.length > 0
        ? `Migrations do outbox aplicadas: ${versoesAplicadas.join(', ')}`
        : `Schema do outbox já está na versão ${PostgresOutboxStore.schemaVersion}`,
    );
  } finally {
    await contexto.close();
  }
}

await migrarOutbox();
