import type { Topic } from '@google-cloud/pubsub';
import type { OutboxMessage } from '@nestjs/outbox';
import { TransportePubSub, aguardarOuCancelar } from './transporte-pubsub.js';

function criarMensagemOutbox(): OutboxMessage {
  return {
    id: '0193a1b2-0000-7000-8000-000000000001',
    topic: 'demo.tarefa-criada',
    payload: { tarefaId: 'tarefa-1' },
    headers: {},
    key: null,
    createdAt: 0,
    availableAt: 0,
    attempts: 0,
    lastError: null,
  };
}

describe('TransportePubSub', () => {
  it('publica o payload em JSON e leva id e tópico do outbox como atributos', async () => {
    const publishMessage = vi.fn().mockResolvedValue('id-pubsub-1');
    const transporte = new TransportePubSub({ publishMessage } as unknown as Topic);

    await transporte.publish(criarMensagemOutbox(), { signal: new AbortController().signal });

    expect(publishMessage).toHaveBeenCalledTimes(1);
    const mensagemPublicada = publishMessage.mock.calls[0][0];
    expect(JSON.parse(mensagemPublicada.data.toString('utf8'))).toEqual({ tarefaId: 'tarefa-1' });
    expect(mensagemPublicada.attributes).toEqual({
      idEvento: '0193a1b2-0000-7000-8000-000000000001',
      topico: 'demo.tarefa-criada',
    });
  });

  it('propaga a falha do Pub/Sub para o relay reagendar', async () => {
    const publishMessage = vi.fn().mockRejectedValue(new Error('UNAVAILABLE'));
    const transporte = new TransportePubSub({ publishMessage } as unknown as Topic);

    await expect(
      transporte.publish(criarMensagemOutbox(), { signal: new AbortController().signal }),
    ).rejects.toThrow('UNAVAILABLE');
  });
});

describe('aguardarOuCancelar', () => {
  it('resolve com o valor da promessa', async () => {
    await expect(aguardarOuCancelar(Promise.resolve('ok'), new AbortController().signal)).resolves.toBe('ok');
  });

  it('rejeita quando o signal aborta antes da promessa terminar', async () => {
    const controlador = new AbortController();
    const promessaQueNaoTermina = new Promise<string>(() => {});
    const espera = aguardarOuCancelar(promessaQueNaoTermina, controlador.signal);

    controlador.abort(new Error('publishTimeout'));

    await expect(espera).rejects.toThrow('publishTimeout');
  });

  it('rejeita na hora se o signal já estava abortado', async () => {
    const controlador = new AbortController();
    controlador.abort(new Error('já abortado'));

    await expect(aguardarOuCancelar(Promise.resolve('ok'), controlador.signal)).rejects.toThrow('já abortado');
  });
});
