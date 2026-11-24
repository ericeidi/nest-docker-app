import type { OutboxInbox } from '@nestjs/outbox';
import type { DataSource } from 'typeorm';
import type { EventoRecebido } from './envelope-pubsub.js';
import type { ManipuladorEvento } from './manipulador-evento.interface.js';
import { ProcessadorEventos, TopicoSemManipuladorError } from './processador-eventos.service.js';

const GERENCIADOR_TRANSACAO_FALSO = { nome: 'transacao-de-teste' };

function criarEvento(sobrescrever: Partial<EventoRecebido> = {}): EventoRecebido {
  return { idEvento: 'evento-1', topico: 'demo.tarefa-criada', payload: { tarefaId: 't-1' }, tentativa: 1, ...sobrescrever };
}

function criarManipulador(): ManipuladorEvento & { executar: ReturnType<typeof vi.fn> } {
  return { topico: 'demo.tarefa-criada', consumidor: 'demo-processar-tarefa', executar: vi.fn().mockResolvedValue(undefined) };
}

/** Inbox em memória que imita processInTransaction: roda o trabalho só na primeira vez do id. */
function criarInboxFalso() {
  const idsProcessados = new Set<string>();
  return {
    processInTransaction: vi.fn(async (_tx: unknown, consumidor: string, idMensagem: string, trabalho: () => unknown) => {
      const chave = `${consumidor}:${idMensagem}`;
      if (idsProcessados.has(chave)) {
        return { duplicate: true };
      }
      const resultadoTrabalho = await trabalho();
      idsProcessados.add(chave);
      return { duplicate: false, result: resultadoTrabalho };
    }),
  };
}

function criarDataSourceFalso() {
  return { transaction: vi.fn(async (trabalho: (tx: unknown) => unknown) => trabalho(GERENCIADOR_TRANSACAO_FALSO)) };
}

describe('ProcessadorEventos', () => {
  it('executa o manipulador do tópico dentro da transação, com o contexto do evento', async () => {
    const manipulador = criarManipulador();
    const inbox = criarInboxFalso();
    const processador = new ProcessadorEventos(
      criarDataSourceFalso() as unknown as DataSource,
      inbox as unknown as OutboxInbox,
      [manipulador],
    );

    await expect(processador.processar(criarEvento())).resolves.toBe('processado');

    expect(inbox.processInTransaction).toHaveBeenCalledWith(
      GERENCIADOR_TRANSACAO_FALSO,
      'demo-processar-tarefa',
      'evento-1',
      expect.any(Function),
    );
    expect(manipulador.executar).toHaveBeenCalledWith(
      { tarefaId: 't-1' },
      { idEvento: 'evento-1', topico: 'demo.tarefa-criada', tentativa: 1, gerenciadorTransacao: GERENCIADOR_TRANSACAO_FALSO },
    );
  });

  it('não executa de novo o mesmo id de evento', async () => {
    const manipulador = criarManipulador();
    const processador = new ProcessadorEventos(
      criarDataSourceFalso() as unknown as DataSource,
      criarInboxFalso() as unknown as OutboxInbox,
      [manipulador],
    );

    await processador.processar(criarEvento());
    await expect(processador.processar(criarEvento({ tentativa: 2 }))).resolves.toBe('duplicado');

    expect(manipulador.executar).toHaveBeenCalledTimes(1);
  });

  it('propaga o erro do manipulador para o Pub/Sub reentregar', async () => {
    const manipulador = criarManipulador();
    manipulador.executar.mockRejectedValue(new Error('provedor fora do ar'));
    const processador = new ProcessadorEventos(
      criarDataSourceFalso() as unknown as DataSource,
      criarInboxFalso() as unknown as OutboxInbox,
      [manipulador],
    );

    await expect(processador.processar(criarEvento())).rejects.toThrow('provedor fora do ar');
  });

  it('falha quando o tópico não tem manipulador', async () => {
    const processador = new ProcessadorEventos(
      criarDataSourceFalso() as unknown as DataSource,
      criarInboxFalso() as unknown as OutboxInbox,
      [criarManipulador()],
    );

    await expect(processador.processar(criarEvento({ topico: 'topico.desconhecido' }))).rejects.toThrow(
      TopicoSemManipuladorError,
    );
  });

  it('recusa dois manipuladores para o mesmo tópico', () => {
    expect(
      () =>
        new ProcessadorEventos(
          criarDataSourceFalso() as unknown as DataSource,
          criarInboxFalso() as unknown as OutboxInbox,
          [criarManipulador(), criarManipulador()],
        ),
    ).toThrow('Dois manipuladores');
  });
});
