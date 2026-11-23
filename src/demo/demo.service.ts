import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Outbox } from '@nestjs/outbox';
import { DataSource, type EntityManager } from 'typeorm';
import { DisparadorRelay } from '../mensageria/disparador-relay.service.js';
import { TOPICO_TAREFA_DEMO_CRIADA, type PayloadTarefaDemoCriada } from './demo.constants.js';

export interface TarefaDemoAgendada {
  idEvento: string;
  tarefaId: string;
}

/**
 * Produtor de demonstração: grava o evento no outbox dentro de uma transação e aciona o relay.
 * Numa feature real, a mesma transação também grava os dados de negócio (ex.: o usuário),
 * e os dois confirmam ou são desfeitos juntos.
 */
@Injectable()
export class DemoService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: Outbox<EntityManager>,
    private readonly disparadorRelay: DisparadorRelay,
  ) {}

  async agendarTarefa(): Promise<TarefaDemoAgendada> {
    const payload: PayloadTarefaDemoCriada = { tarefaId: randomUUID(), criadaEm: new Date().toISOString() };

    const mensagemGravada = await this.dataSource.transaction(async (gerenciadorTransacao) =>
      this.outbox.add(gerenciadorTransacao, { topic: TOPICO_TAREFA_DEMO_CRIADA, payload }),
    );

    // Só depois do commit: a linha precisa estar visível para o relay
    await this.disparadorRelay.aposCommit();

    return { idEvento: mensagemGravada.id, tarefaId: payload.tarefaId };
  }
}
