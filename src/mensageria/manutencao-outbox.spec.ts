import type { OutboxDeadLetter, OutboxDeadLetters, OutboxInbox } from '@nestjs/outbox';
import type { ConfiguracaoMensageria } from './mensageria.config.js';
import { ManutencaoOutbox } from './manutencao-outbox.service.js';

const configuracao: ConfiguracaoMensageria = {
  projetoPubSub: undefined,
  topicoEventos: 'eventos-app',
  modoRelay: 'sob-demanda',
  migrarNaInicializacao: false,
  retencaoInboxDias: 30,
  retencaoDeadLettersDias: 14,
};

function criarManutencao(deadLetters: Partial<OutboxDeadLetters>, inbox: Partial<OutboxInbox> = {}): ManutencaoOutbox {
  return new ManutencaoOutbox(deadLetters as OutboxDeadLetters, inbox as OutboxInbox, configuracao);
}

describe('ManutencaoOutbox', () => {
  it('lista dead letters sem o payload', async () => {
    const falhouEm = Date.UTC(2026, 10, 24, 12, 0, 0);
    const deadLetter: OutboxDeadLetter = {
      id: '01a20f36-1ea0-71e5-8b50-fb1516968b2d',
      topic: 'demo.tarefa',
      payload: { dadoSensivel: 'não pode sair' },
      headers: {},
      key: null,
      createdAt: falhouEm - 1000,
      attempts: 10,
      lastError: 'Pub/Sub indisponível',
      reason: 'exhausted',
      failedAt: falhouEm,
      history: [],
    };
    const list = vi.fn().mockResolvedValue([deadLetter]);

    const resumos = await criarManutencao({ list }).listarDeadLetters(20, 40);

    expect(list).toHaveBeenCalledWith({ limit: 20, offset: 40 });
    expect(resumos).toEqual([
      {
        id: deadLetter.id,
        topico: 'demo.tarefa',
        motivo: 'exhausted',
        tentativas: 10,
        ultimoErro: 'Pub/Sub indisponível',
        falhouEm: '2026-11-24T12:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(resumos)).not.toContain('dadoSensivel');
  });

  it('reenfileirar: true quando a dead letter existe, false quando não', async () => {
    const requeue = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const manutencao = criarManutencao({ requeue });

    await expect(manutencao.reenfileirar('id-existente')).resolves.toBe(true);
    await expect(manutencao.reenfileirar('id-inexistente')).resolves.toBe(false);
    expect(requeue).toHaveBeenCalledWith('id-existente');
  });

  it('limpar: aplica a retenção configurada ao inbox e às dead letters', async () => {
    const prune = vi.fn().mockResolvedValue(120);
    const purge = vi.fn().mockResolvedValue(3);
    const agora = new Date('2026-11-24T00:00:00.000Z');

    const resultado = await criarManutencao({ purge }, { prune }).limpar(agora);

    expect(prune).toHaveBeenCalledWith('30d');
    expect(purge).toHaveBeenCalledWith({ failedBefore: new Date('2026-11-10T00:00:00.000Z') });
    expect(resultado).toEqual({ inboxRemovidas: 120, deadLettersRemovidas: 3 });
  });
});
