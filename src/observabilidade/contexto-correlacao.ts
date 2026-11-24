import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Header HTTP de entrada e de resposta (Express normaliza para minúsculas). */
export const CABECALHO_CORRELATION_ID = 'x-correlation-id';

/** Nome do campo nos logs, no header da mensagem do outbox e no atributo do Pub/Sub. */
export const CHAVE_CORRELATION_ID = 'correlationId';

/**
 * Formato aceito de quem chama: evita log injection (quebra de linha, JSON) e valores enormes.
 * Fora do formato, o valor recebido é descartado e um UUID novo é gerado.
 */
const FORMATO_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

interface ContextoCorrelacao {
  correlationId: string;
}

const armazenamentoContexto = new AsyncLocalStorage<ContextoCorrelacao>();

/** Devolve o valor recebido se for válido; senão, um UUID novo. */
export function normalizarCorrelationId(valorRecebido: unknown): string {
  return typeof valorRecebido === 'string' && FORMATO_CORRELATION_ID.test(valorRecebido)
    ? valorRecebido
    : randomUUID();
}

/** Roda `trabalho` com o correlation ID disponível para tudo que ele chamar (inclusive async). */
export function executarComCorrelationId<T>(correlationId: string, trabalho: () => T): T {
  return armazenamentoContexto.run({ correlationId }, trabalho);
}

/** Correlation ID da requisição ou do evento em andamento; undefined fora de um contexto. */
export function obterCorrelationId(): string | undefined {
  return armazenamentoContexto.getStore()?.correlationId;
}

/**
 * Headers para `Outbox.add()`: levam o correlation ID até o worker.
 * Produtores usam `{ topic, payload, headers: cabecalhosCorrelacao() }`.
 */
export function cabecalhosCorrelacao(): Record<string, string> {
  const correlationId = obterCorrelationId();
  return correlationId ? { [CHAVE_CORRELATION_ID]: correlationId } : {};
}
