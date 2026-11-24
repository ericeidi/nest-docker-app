import { Module } from '@nestjs/common';
import { OutboxModule, OutboxStorage } from '@nestjs/outbox';
import { PostgresOutboxStore, fromTypeOrm } from '@nestjs/outbox/postgres';
import type { PubSub } from '@google-cloud/pubsub';
import { DataSource } from 'typeorm';
import { DisparadorRelay } from './disparador-relay.service.js';
import { ManutencaoOutbox } from './manutencao-outbox.service.js';
import type { ConfiguracaoMensageria } from './mensageria.config.js';
import { CLIENTE_PUBSUB, TRANSPORTE_PUBSUB } from './mensageria.constants.js';
import { MensageriaClientesModule } from './mensageria-clientes.module.js';
import { CONFIGURACAO_MENSAGERIA } from './mensageria.tokens.js';
import { TransportePubSub } from './transporte-pubsub.js';

/** Publicações por mensagem antes de ir para nest_outbox.dead_letters. */
const TENTATIVAS_PUBLICACAO = 10;

/**
 * Outbox (PostgreSQL via TypeORM) + transporte Pub/Sub. Usado pelos dois modos:
 * - api: `Outbox.add()` nas transações e `DisparadorRelay.aposCommit()` depois do commit;
 * - worker: `OutboxInbox` para deduplicar e o relay para o endpoint do Cloud Scheduler.
 *
 * Com PUBSUB_EMULATOR_HOST definido, o client do Pub/Sub usa o emulador (docker compose).
 */
@Module({
  imports: [
    MensageriaClientesModule,
    OutboxModule.forRootAsync({
      imports: [MensageriaClientesModule],
      inject: [CONFIGURACAO_MENSAGERIA, CLIENTE_PUBSUB],
      useFactory: (configuracao: ConfiguracaoMensageria, clientePubSub: PubSub) => ({
        transports: {
          [TRANSPORTE_PUBSUB]: new TransportePubSub(clientePubSub.topic(configuracao.topicoEventos)),
        },
        route: () => TRANSPORTE_PUBSUB,
        relay: {
          enabled: configuracao.modoRelay === 'continuo',
          lease: '30s',
        },
        retry: {
          attempts: TENTATIVAS_PUBLICACAO,
          backoff: { delay: '1s', factor: 2, maxDelay: '5m' },
        },
      }),
    }),
  ],
  providers: [
    {
      // Registra-se no OutboxStorage pelo construtor; mensagens e inbox ficam no schema nest_outbox
      provide: PostgresOutboxStore,
      inject: [DataSource, OutboxStorage, CONFIGURACAO_MENSAGERIA],
      useFactory: (dataSource: DataSource, armazenamento: OutboxStorage, configuracao: ConfiguracaoMensageria) =>
        new PostgresOutboxStore(
          { executor: fromTypeOrm(dataSource), migrate: configuracao.migrarNaInicializacao },
          armazenamento,
        ),
    },
    DisparadorRelay,
    ManutencaoOutbox,
  ],
  exports: [DisparadorRelay, ManutencaoOutbox],
})
export class MensageriaModule {}
