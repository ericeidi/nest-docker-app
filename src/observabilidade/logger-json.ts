import { ConsoleLogger, type ConsoleLoggerOptions, type LogLevel } from '@nestjs/common';
import { CHAVE_CORRELATION_ID, obterCorrelationId } from './contexto-correlacao.js';

/**
 * Severidade no formato do Cloud Logging: com o campo `severity`, o Cloud Run classifica a
 * linha pelo nível certo (sem ele, tudo vira DEFAULT).
 */
const SEVERIDADE_POR_NIVEL: Record<LogLevel, string> = {
  verbose: 'DEBUG',
  debug: 'DEBUG',
  log: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/** Propriedades mascaradas em objetos logados (case-insensitive, em qualquer profundidade). */
export const CAMPOS_MASCARADOS = ['password', 'senha', 'authorization', 'cookie', 'token', 'secret'];

/** Mesmas formas de `ConsoleLogger.getJsonLogObject` (protegido, então sem acesso por tipo indexado). */
interface OpcoesLogJson {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: 'stdout' | 'stderr';
  errorStack?: unknown;
  params?: Record<string, unknown>;
  error?: Error;
}
interface ObjetoLogJson {
  [chave: string]: unknown;
  level: LogLevel;
  pid: number;
  timestamp: number;
  message: unknown;
}

/**
 * Logger do Nest em JSON (uma linha por log) com `severity` e o `correlationId` da
 * requisição/evento em andamento. Sem lib extra: usa o modo JSON do ConsoleLogger.
 */
export class LoggerJson extends ConsoleLogger {
  constructor(opcoes: ConsoleLoggerOptions = {}) {
    super({ json: true, redact: CAMPOS_MASCARADOS, ...opcoes });
  }

  protected override getJsonLogObject(mensagem: unknown, opcoes: OpcoesLogJson): ObjetoLogJson {
    const objetoLog = super.getJsonLogObject(mensagem, opcoes);
    objetoLog.severity = SEVERIDADE_POR_NIVEL[opcoes.logLevel] ?? 'DEFAULT';

    const correlationId = obterCorrelationId();
    if (correlationId) {
      objetoLog[CHAVE_CORRELATION_ID] = correlationId;
    }
    return objetoLog;
  }
}

/** JSON por padrão (Cloud Run, docker compose); LOG_JSON=false volta ao texto colorido para leitura local. */
export function criarLogger(logJson: string | undefined): ConsoleLogger {
  return logJson === 'false' ? new ConsoleLogger({ redact: CAMPOS_MASCARADOS }) : new LoggerJson();
}
