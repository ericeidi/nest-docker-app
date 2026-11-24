import type { NextFunction, Request, Response } from 'express';
import {
  cabecalhosCorrelacao,
  executarComCorrelationId,
  normalizarCorrelationId,
  obterCorrelationId,
} from './contexto-correlacao.js';
import { middlewareCorrelationId } from './correlation-id.middleware.js';

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('contexto de correlação', () => {
  it('normalizarCorrelationId: mantém valor válido e troca inválido por UUID', () => {
    expect(normalizarCorrelationId('req-123_abc.v1:2')).toBe('req-123_abc.v1:2');
    expect(normalizarCorrelationId(undefined)).toMatch(FORMATO_UUID);
    expect(normalizarCorrelationId('')).toMatch(FORMATO_UUID);
    // Quebra de linha e JSON: tentativa de log injection
    expect(normalizarCorrelationId('abc\n{"level":"error"}')).toMatch(FORMATO_UUID);
    expect(normalizarCorrelationId('a'.repeat(129))).toMatch(FORMATO_UUID);
    expect(normalizarCorrelationId(['req-1', 'req-2'])).toMatch(FORMATO_UUID);
  });

  it('o valor fica disponível em chamadas assíncronas dentro do contexto, e só nelas', async () => {
    expect(obterCorrelationId()).toBeUndefined();

    await executarComCorrelationId('req-123', async () => {
      await new Promise((resolver) => setTimeout(resolver, 1));
      expect(obterCorrelationId()).toBe('req-123');
      expect(cabecalhosCorrelacao()).toEqual({ correlationId: 'req-123' });
    });

    expect(obterCorrelationId()).toBeUndefined();
    expect(cabecalhosCorrelacao()).toEqual({});
  });
});

describe('middlewareCorrelationId', () => {
  function executarMiddleware(cabecalhos: Record<string, unknown>) {
    const setHeader = vi.fn();
    let correlationIdNoHandler: string | undefined;
    const proximo: NextFunction = () => {
      correlationIdNoHandler = obterCorrelationId();
    };

    middlewareCorrelationId({ headers: cabecalhos } as unknown as Request, { setHeader } as unknown as Response, proximo);

    return { setHeader, correlationIdNoHandler };
  }

  it('reaproveita o X-Correlation-ID recebido e devolve na resposta', () => {
    const { setHeader, correlationIdNoHandler } = executarMiddleware({ 'x-correlation-id': 'req-123' });

    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'req-123');
    expect(correlationIdNoHandler).toBe('req-123');
  });

  it('gera um UUID quando o header não vem', () => {
    const { setHeader, correlationIdNoHandler } = executarMiddleware({});

    expect(correlationIdNoHandler).toMatch(FORMATO_UUID);
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', correlationIdNoHandler);
  });
});
