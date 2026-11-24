import { BadRequestException } from '@nestjs/common';
import { lerEnvelopePubSub } from './envelope-pubsub.js';

function criarEnvelope(sobrescrever: Record<string, unknown> = {}) {
  return {
    message: {
      data: Buffer.from(JSON.stringify({ tarefaId: 'tarefa-1' })).toString('base64'),
      attributes: { idEvento: 'evento-1', topico: 'demo.tarefa-criada' },
      messageId: 'id-pubsub-1',
      ...sobrescrever,
    },
    subscription: 'projects/nest-local/subscriptions/eventos-app-worker',
    deliveryAttempt: 2,
  };
}

describe('lerEnvelopePubSub', () => {
  it('lê o correlationId dos atributos quando presente', () => {
    const envelope = criarEnvelope({
      attributes: { idEvento: 'evento-1', topico: 'demo.tarefa-criada', correlationId: 'req-123' },
    });

    expect(lerEnvelopePubSub(envelope).correlationId).toBe('req-123');
  });

  it('decodifica o payload e lê id, tópico e tentativa', () => {
    expect(lerEnvelopePubSub(criarEnvelope())).toEqual({
      idEvento: 'evento-1',
      topico: 'demo.tarefa-criada',
      payload: { tarefaId: 'tarefa-1' },
      tentativa: 2,
    });
  });

  it('tentativa fica indefinida quando a assinatura não informa', () => {
    const { deliveryAttempt: _tentativaIgnorada, ...envelopeSemTentativa } = criarEnvelope();
    expect(lerEnvelopePubSub(envelopeSemTentativa).tentativa).toBeUndefined();
  });

  it.each([
    ['corpo vazio', undefined],
    ['sem message', { subscription: 'x' }],
    ['sem idEvento', criarEnvelope({ attributes: { topico: 'demo.tarefa-criada' } })],
    ['sem topico', criarEnvelope({ attributes: { idEvento: 'evento-1' } })],
    ['sem data', criarEnvelope({ data: undefined })],
    ['data que não é JSON', criarEnvelope({ data: Buffer.from('não é json').toString('base64') })],
  ])('rejeita com 400: %s', (_descricao, corpoInvalido) => {
    expect(() => lerEnvelopePubSub(corpoInvalido)).toThrow(BadRequestException);
  });
});
