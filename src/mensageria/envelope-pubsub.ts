import { BadRequestException } from '@nestjs/common';
import { ATRIBUTO_ID_EVENTO, ATRIBUTO_TOPICO } from './mensageria.constants.js';

/** Evento extraído do corpo do push do Pub/Sub. */
export interface EventoRecebido {
  idEvento: string;
  topico: string;
  payload: unknown;
  tentativa: number | undefined;
}

/**
 * Valida e decodifica o corpo que o Pub/Sub envia no push:
 * `{ message: { data: <base64>, attributes: {...}, messageId }, subscription, deliveryAttempt? }`.
 *
 * Corpo inválido vira 400. O Pub/Sub trata qualquer resposta não-2xx como falha, então a
 * mensagem é reentregue e, depois do limite de tentativas, vai para a DLQ, onde fica visível.
 */
export function lerEnvelopePubSub(corpoRequisicao: unknown): EventoRecebido {
  if (!ehObjeto(corpoRequisicao) || !ehObjeto(corpoRequisicao.message)) {
    throw new BadRequestException('Envelope do Pub/Sub sem "message"');
  }
  const mensagem = corpoRequisicao.message;

  const atributos = ehObjeto(mensagem.attributes) ? mensagem.attributes : {};
  const idEvento = atributos[ATRIBUTO_ID_EVENTO];
  const topico = atributos[ATRIBUTO_TOPICO];
  if (typeof idEvento !== 'string' || idEvento.length === 0) {
    throw new BadRequestException(`Mensagem sem o atributo "${ATRIBUTO_ID_EVENTO}"`);
  }
  if (typeof topico !== 'string' || topico.length === 0) {
    throw new BadRequestException(`Mensagem sem o atributo "${ATRIBUTO_TOPICO}"`);
  }
  if (typeof mensagem.data !== 'string') {
    throw new BadRequestException('Mensagem sem "data"');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(mensagem.data, 'base64').toString('utf8'));
  } catch {
    // Sem o conteúdo na mensagem de erro: o payload pode ter dados que não devem ir para log
    throw new BadRequestException(`"data" não é JSON válido (idEvento=${idEvento})`);
  }

  const tentativa = corpoRequisicao.deliveryAttempt;

  return {
    idEvento,
    topico,
    payload,
    tentativa: typeof tentativa === 'number' ? tentativa : undefined,
  };
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
