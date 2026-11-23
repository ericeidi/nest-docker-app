import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PubSub } from '@google-cloud/pubsub';
import { lerConfiguracaoMensageria, type ConfiguracaoMensageria } from './mensageria.config.js';
import { CLIENTE_PUBSUB } from './mensageria.constants.js';
import { CONFIGURACAO_MENSAGERIA } from './mensageria.tokens.js';

/**
 * Configuração validada e client do Pub/Sub, num módulo à parte para o
 * `OutboxModule.forRootAsync()` conseguir injetá-los na factory.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CONFIGURACAO_MENSAGERIA,
      inject: [ConfigService],
      useFactory: lerConfiguracaoMensageria,
    },
    {
      provide: CLIENTE_PUBSUB,
      inject: [CONFIGURACAO_MENSAGERIA],
      useFactory: (configuracao: ConfiguracaoMensageria) => new PubSub({ projectId: configuracao.projetoPubSub }),
    },
  ],
  exports: [CONFIGURACAO_MENSAGERIA, CLIENTE_PUBSUB],
})
export class MensageriaClientesModule implements OnApplicationShutdown {
  constructor(@Inject(CLIENTE_PUBSUB) private readonly clientePubSub: PubSub) {}

  /** Depois do relay parar (onModuleDestroy), fecha as conexões gRPC do Pub/Sub. */
  async onApplicationShutdown(): Promise<void> {
    await this.clientePubSub.close();
  }
}
