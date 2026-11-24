import type { OutboxRelay, OutboxRelayRunResult } from '@nestjs/outbox';
import type { ConfiguracaoMensageria, ModoRelay } from './mensageria.config.js';
import { DisparadorRelay } from './disparador-relay.service.js';

function criarResultadoRodada(sobrescrever: Partial<OutboxRelayRunResult> = {}): OutboxRelayRunResult {
  return { claimed: 0, published: 0, retried: 0, deadLettered: 0, released: 0, leaseLost: 0, ...sobrescrever };
}

function criarDisparador(modoRelay: ModoRelay, relay: Partial<OutboxRelay>): DisparadorRelay {
  const configuracao: ConfiguracaoMensageria = {
    projetoPubSub: undefined,
    topicoEventos: 'eventos-app',
    modoRelay,
    migrarNaInicializacao: false,
    retencaoInboxDias: 30,
    retencaoDeadLettersDias: 14,
  };
  return new DisparadorRelay(relay as OutboxRelay, configuracao);
}

describe('DisparadorRelay', () => {
  it('modo contínuo: só acorda o loop', async () => {
    const relay = { notify: vi.fn(), runOnce: vi.fn() };

    await criarDisparador('continuo', relay).aposCommit();

    expect(relay.notify).toHaveBeenCalledTimes(1);
    expect(relay.runOnce).not.toHaveBeenCalled();
  });

  it('modo sob demanda: publica dentro da requisição', async () => {
    const relay = { notify: vi.fn(), runOnce: vi.fn().mockResolvedValue(criarResultadoRodada({ claimed: 1, published: 1 })) };

    await criarDisparador('sob-demanda', relay).aposCommit();

    expect(relay.runOnce).toHaveBeenCalledTimes(1);
  });

  it('modo sob demanda: falha na publicação não derruba a requisição', async () => {
    const relay = { notify: vi.fn(), runOnce: vi.fn().mockRejectedValue(new Error('banco indisponível')) };

    await expect(criarDisparador('sob-demanda', relay).aposCommit()).resolves.toBeUndefined();
  });

  it('drenar: roda até não sobrar mensagem e soma as rodadas', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce(criarResultadoRodada({ claimed: 100, published: 98, retried: 2 }))
      .mockResolvedValueOnce(criarResultadoRodada({ claimed: 3, published: 2, deadLettered: 1 }))
      .mockResolvedValueOnce(criarResultadoRodada());

    const resumo = await criarDisparador('sob-demanda', { runOnce }).drenar();

    expect(resumo).toEqual({ rodadas: 3, publicadas: 100, reagendadas: 2, enviadasParaDeadLetter: 1 });
  });

  it('drenar: para no limite de rodadas mesmo com mensagens restantes', async () => {
    const runOnce = vi.fn().mockResolvedValue(criarResultadoRodada({ claimed: 100, published: 100 }));

    const resumo = await criarDisparador('sob-demanda', { runOnce }).drenar();

    expect(resumo.rodadas).toBe(20);
  });
});
