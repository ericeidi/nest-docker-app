import { Injectable, Logger } from '@nestjs/common';
import type { ContextoEvento, ManipuladorEvento } from '../mensageria/manipulador-evento.interface.js';
import { TOPICO_TAREFA_DEMO_CRIADA } from './demo.constants.js';

/**
 * Job de demonstração do worker: só registra no log, para provar o caminho completo
 * (outbox → relay → Pub/Sub → worker) sem depender de provedor externo.
 */
@Injectable()
export class TarefaDemoManipulador implements ManipuladorEvento {
  readonly topico = TOPICO_TAREFA_DEMO_CRIADA;
  readonly consumidor = 'demo-processar-tarefa';
  private readonly logger = new Logger(TarefaDemoManipulador.name);

  async executar(_payload: unknown, contexto: ContextoEvento): Promise<void> {
    this.logger.log(
      `Tarefa demo processada idEvento=${contexto.idEvento} tentativa=${contexto.tentativa ?? '?'}`,
    );
  }
}
