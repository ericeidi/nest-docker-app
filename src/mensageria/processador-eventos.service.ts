import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxInbox } from '@nestjs/outbox';
import { DataSource } from 'typeorm';
import type { EventoRecebido } from './envelope-pubsub.js';
import { MANIPULADORES_EVENTO, type ManipuladorEvento } from './manipulador-evento.interface.js';

export type ResultadoProcessamento = 'processado' | 'duplicado';

/** Tópico sem manipulador: tratado como erro para a mensagem acabar visível na DLQ. */
export class TopicoSemManipuladorError extends Error {
  constructor(topico: string) {
    super(`Nenhum manipulador registrado para o tópico "${topico}"`);
    this.name = 'TopicoSemManipuladorError';
  }
}

/**
 * Executa o manipulador do tópico no máximo uma vez por id de evento.
 *
 * Numa transação: registra o id no inbox do outbox (nest_outbox.inbox) e roda o manipulador.
 * - Id já registrado → não executa, retorna 'duplicado'.
 * - Manipulador lança → rollback desfaz também o registro, e a reentrega roda de novo.
 */
@Injectable()
export class ProcessadorEventos {
  private readonly logger = new Logger(ProcessadorEventos.name);
  private readonly manipuladoresPorTopico: Map<string, ManipuladorEvento>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly inbox: OutboxInbox,
    @Inject(MANIPULADORES_EVENTO) manipuladores: ManipuladorEvento[],
  ) {
    this.manipuladoresPorTopico = indexarPorTopico(manipuladores);
  }

  async processar(evento: EventoRecebido): Promise<ResultadoProcessamento> {
    const manipulador = this.manipuladoresPorTopico.get(evento.topico);
    if (!manipulador) {
      throw new TopicoSemManipuladorError(evento.topico);
    }

    const resultadoInbox = await this.dataSource.transaction(async (gerenciadorTransacao) =>
      this.inbox.processInTransaction(gerenciadorTransacao, manipulador.consumidor, evento.idEvento, () =>
        manipulador.executar(evento.payload, {
          idEvento: evento.idEvento,
          topico: evento.topico,
          tentativa: evento.tentativa,
          gerenciadorTransacao,
        }),
      ),
    );

    if (resultadoInbox.duplicate) {
      this.logger.log(`Evento duplicado ignorado idEvento=${evento.idEvento} topico=${evento.topico}`);
      return 'duplicado';
    }
    return 'processado';
  }
}

function indexarPorTopico(manipuladores: ManipuladorEvento[]): Map<string, ManipuladorEvento> {
  const manipuladoresPorTopico = new Map<string, ManipuladorEvento>();
  for (const manipulador of manipuladores) {
    if (manipuladoresPorTopico.has(manipulador.topico)) {
      throw new Error(`Dois manipuladores registrados para o tópico "${manipulador.topico}"`);
    }
    manipuladoresPorTopico.set(manipulador.topico, manipulador);
  }
  return manipuladoresPorTopico;
}
