import type { EntityManager } from 'typeorm';

/** Token da lista de manipuladores registrados no worker. */
export const MANIPULADORES_EVENTO = Symbol('MANIPULADORES_EVENTO');

/** O que o manipulador recebe além do payload. */
export interface ContextoEvento {
  /** Id do outbox: igual em todas as entregas da mesma mensagem. Use como idempotency key. */
  readonly idEvento: string;
  readonly topico: string;
  /** Número da entrega informado pelo Pub/Sub (1 = primeira). Ausente se a assinatura não tem DLQ. */
  readonly tentativa: number | undefined;
  /**
   * Transação em que o id já foi registrado no inbox. Escritas feitas por ela confirmam
   * junto com o registro; se o manipulador lançar, tudo é desfeito e o Pub/Sub reentrega.
   */
  readonly gerenciadorTransacao: EntityManager;
}

/**
 * Um tipo de job do worker. Um manipulador por tópico.
 *
 * Efeitos externos (email, SMS, chamada a outra API) não são desfeitos pelo rollback:
 * repasse `contexto.idEvento` como idempotency key ao provedor.
 */
export interface ManipuladorEvento {
  /** Tópico do outbox que este manipulador trata, ex.: 'usuario.criado'. */
  readonly topico: string;
  /**
   * Identidade no inbox (deduplicação). Mantenha estável: um nome novo faz todas as
   * mensagens antigas parecerem novas.
   */
  readonly consumidor: string;
  executar(payload: unknown, contexto: ContextoEvento): Promise<void>;
}
