import type { NextFunction, Request, Response } from 'express';
import {
  CABECALHO_CORRELATION_ID,
  executarComCorrelationId,
  normalizarCorrelationId,
} from './contexto-correlacao.js';

/**
 * Lê `X-Correlation-ID` (ou gera um UUID), devolve no header da resposta e mantém o valor
 * disponível durante toda a requisição — os logs dela saem com o mesmo `correlationId`.
 */
export function middlewareCorrelationId(requisicao: Request, resposta: Response, proximo: NextFunction): void {
  const correlationId = normalizarCorrelationId(requisicao.headers[CABECALHO_CORRELATION_ID]);
  resposta.setHeader(CABECALHO_CORRELATION_ID, correlationId);
  executarComCorrelationId(correlationId, () => proximo());
}
