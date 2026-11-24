import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../health/health.module.js';
import { MensageriaModule } from '../mensageria/mensageria.module.js';
import { MANIPULADORES_EVENTO, type ManipuladorEvento } from '../mensageria/manipulador-evento.interface.js';
import { ProcessadorEventos } from '../mensageria/processador-eventos.service.js';
import { TarefaDemoManipulador } from '../demo/tarefa-demo.manipulador.js';
import { ConsumidorEventosController } from './consumidor-eventos.controller.js';
import { RelayController } from './relay.controller.js';
import { ManutencaoOutboxController } from './manutencao-outbox.controller.js';

/**
 * Módulo raiz do modo worker (MODO_APP=worker): recebe o push do Pub/Sub e roda os jobs.
 * Sem rotas públicas e sem rate limit (as chamadas vêm do Pub/Sub e do Cloud Scheduler).
 *
 * Novo job: crie a classe que implementa ManipuladorEvento, adicione em `providers` e na
 * lista `inject` de MANIPULADORES_EVENTO.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, HealthModule, MensageriaModule],
  controllers: [ConsumidorEventosController, RelayController, ManutencaoOutboxController],
  providers: [
    TarefaDemoManipulador,
    {
      provide: MANIPULADORES_EVENTO,
      inject: [TarefaDemoManipulador],
      useFactory: (...manipuladores: ManipuladorEvento[]) => manipuladores,
    },
    ProcessadorEventos,
  ],
})
export class WorkerModule {}
