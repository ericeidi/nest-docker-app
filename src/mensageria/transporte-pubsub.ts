import { OutboxTransport, type OutboxMessage } from '@nestjs/outbox';
import type { Topic } from '@google-cloud/pubsub';
import { ATRIBUTO_ID_EVENTO, ATRIBUTO_TOPICO } from './mensageria.constants.js';

/**
 * Transporte do outbox para o Google Cloud Pub/Sub (o @nestjs/outbox não traz um pronto).
 *
 * Resolver = o Pub/Sub aceitou a mensagem; lançar = tentativa falha, e o relay reagenda
 * com backoff. O id do outbox vai como atributo: é a chave de deduplicação no worker,
 * igual em todas as republicações da mesma mensagem.
 */
export class TransportePubSub extends OutboxTransport {
  constructor(private readonly topico: Topic) {
    super();
  }

  async publish(mensagem: OutboxMessage, { signal }: { signal: AbortSignal }): Promise<void> {
    const publicacao = this.topico.publishMessage({
      data: Buffer.from(JSON.stringify(mensagem.payload)),
      attributes: {
        [ATRIBUTO_ID_EVENTO]: mensagem.id,
        [ATRIBUTO_TOPICO]: mensagem.topic,
      },
    });
    await aguardarOuCancelar(publicacao, signal);
  }
}

/**
 * Espera a promessa, mas rejeita assim que o `signal` abortar (publishTimeout do relay).
 *
 * Implementação própria: `publishMessage` do client do Pub/Sub não aceita AbortSignal, e o
 * Node não tem utilitário nativo que corra uma promessa qualquer contra um signal. Se a
 * publicação ainda concluir depois do abort, a mensagem é republicada na próxima tentativa
 * e o worker descarta a duplicata pelo id.
 */
export function aguardarOuCancelar<T>(promessa: Promise<T>, sinal: AbortSignal): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    if (sinal.aborted) {
      rejeitar(sinal.reason);
      return;
    }
    const aoAbortar = () => rejeitar(sinal.reason);
    sinal.addEventListener('abort', aoAbortar, { once: true });
    promessa.then(
      (valor) => {
        sinal.removeEventListener('abort', aoAbortar);
        resolver(valor);
      },
      (erro: unknown) => {
        sinal.removeEventListener('abort', aoAbortar);
        rejeitar(erro);
      },
    );
  });
}
