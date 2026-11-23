/** Nome do transporte registrado no OutboxModule para o Google Cloud Pub/Sub. */
export const TRANSPORTE_PUBSUB = 'pubsub';

/** Token do client do Pub/Sub (instância única por processo). */
export const CLIENTE_PUBSUB = Symbol('CLIENTE_PUBSUB');

/**
 * Atributos da mensagem no Pub/Sub. O `data` leva só o payload; o id e o tópico do
 * outbox vão como atributos, para o worker deduplicar e escolher o manipulador.
 */
export const ATRIBUTO_ID_EVENTO = 'idEvento';
export const ATRIBUTO_TOPICO = 'topico';
