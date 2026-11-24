import { ConsoleLogger } from '@nestjs/common';
import { executarComCorrelationId } from './contexto-correlacao.js';
import { LoggerJson, criarLogger } from './logger-json.js';

/** Captura as linhas escritas em stdout/stderr pelo logger. */
function capturarSaida() {
  const linhas: string[] = [];
  const capturar = (pedaco: string | Uint8Array) => {
    linhas.push(String(pedaco));
    return true;
  };
  const espiaStdout = vi.spyOn(process.stdout, 'write').mockImplementation(capturar);
  const espiaStderr = vi.spyOn(process.stderr, 'write').mockImplementation(capturar);
  return {
    objetos: () => linhas.map((linha) => JSON.parse(linha) as Record<string, unknown>),
    restaurar: () => {
      espiaStdout.mockRestore();
      espiaStderr.mockRestore();
    },
  };
}

describe('LoggerJson', () => {
  it('escreve uma linha JSON com severity, contexto e correlationId', () => {
    const saida = capturarSaida();
    try {
      executarComCorrelationId('req-123', () => new LoggerJson().log('Tarefa processada', 'TarefaDemo'));
    } finally {
      saida.restaurar();
    }

    expect(saida.objetos()).toEqual([
      expect.objectContaining({
        level: 'log',
        severity: 'INFO',
        message: 'Tarefa processada',
        context: 'TarefaDemo',
        correlationId: 'req-123',
      }),
    ]);
  });

  it('mapeia níveis para a severidade do Cloud Logging e omite correlationId fora de contexto', () => {
    const saida = capturarSaida();
    try {
      const logger = new LoggerJson();
      logger.warn('aviso');
      logger.error('falha');
    } finally {
      saida.restaurar();
    }

    const [aviso, falha] = saida.objetos();
    expect(aviso.severity).toBe('WARNING');
    expect(falha.severity).toBe('ERROR');
    expect(aviso).not.toHaveProperty('correlationId');
  });

  it('mascara campos sensíveis em objetos logados', () => {
    const saida = capturarSaida();
    try {
      new LoggerJson().log({ usuario: 'u-1', senha: '123456', headers: { Authorization: 'Bearer x' } });
    } finally {
      saida.restaurar();
    }

    const linha = JSON.stringify(saida.objetos()[0]);
    expect(linha).not.toContain('123456');
    expect(linha).not.toContain('Bearer x');
    expect(linha).toContain('u-1');
  });
});

describe('criarLogger', () => {
  it('JSON por padrão e texto com LOG_JSON=false', () => {
    expect(criarLogger(undefined)).toBeInstanceOf(LoggerJson);
    const loggerTexto = criarLogger('false');
    expect(loggerTexto).toBeInstanceOf(ConsoleLogger);
    expect(loggerTexto).not.toBeInstanceOf(LoggerJson);
  });
});
