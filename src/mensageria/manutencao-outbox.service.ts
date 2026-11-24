import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxDeadLetters, OutboxInbox, type OutboxDeadLetter } from '@nestjs/outbox';
import { CONFIGURACAO_MENSAGERIA } from './mensageria.tokens.js';
import type { ConfiguracaoMensageria } from './mensageria.config.js';

/**
 * Dead letter do outbox sem o payload: o payload pode conter dados pessoais e não sai do banco
 * por esta rota. Para inspecionar o conteúdo, consulte `nest_outbox.dead_letters` direto.
 */
export interface ResumoDeadLetter {
  id: string;
  topico: string;
  motivo: OutboxDeadLetter['reason'];
  tentativas: number;
  ultimoErro: string | null;
  /** ISO 8601. */
  falhouEm: string;
}

export interface ResultadoLimpeza {
  inboxRemovidas: number;
  deadLettersRemovidas: number;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Operação do outbox no worker: dead letters (mensagens que esgotaram as publicações) e
 * retenção das tabelas `nest_outbox.inbox` e `nest_outbox.dead_letters`, que o pacote não limpa sozinho.
 */
@Injectable()
export class ManutencaoOutbox {
  private readonly logger = new Logger(ManutencaoOutbox.name);

  constructor(
    private readonly deadLetters: OutboxDeadLetters,
    private readonly inbox: OutboxInbox,
    @Inject(CONFIGURACAO_MENSAGERIA) private readonly configuracao: ConfiguracaoMensageria,
  ) {}

  /** Mais recentes primeiro. */
  async listarDeadLetters(limite: number, deslocamento: number): Promise<ResumoDeadLetter[]> {
    const deadLetters = await this.deadLetters.list({ limit: limite, offset: deslocamento });
    return deadLetters.map((deadLetter) => ({
      id: deadLetter.id,
      topico: deadLetter.topic,
      motivo: deadLetter.reason,
      tentativas: deadLetter.attempts,
      ultimoErro: deadLetter.lastError,
      falhouEm: new Date(deadLetter.failedAt).toISOString(),
    }));
  }

  /**
   * Devolve a mensagem ao outbox com novo orçamento de tentativas e o mesmo id
   * (o inbox do worker continua deduplicando). Retorna false se o id não existe.
   */
  async reenfileirar(idDeadLetter: string): Promise<boolean> {
    const quantidadeReenfileirada = await this.deadLetters.requeue(idDeadLetter);
    if (quantidadeReenfileirada > 0) {
      this.logger.log(`Dead letter reenfileirada id=${idDeadLetter}`);
    }
    return quantidadeReenfileirada > 0;
  }

  /** Remove registros do inbox e dead letters mais antigos que a retenção configurada. */
  async limpar(agora: Date = new Date()): Promise<ResultadoLimpeza> {
    const { retencaoInboxDias, retencaoDeadLettersDias } = this.configuracao;

    const inboxRemovidas = await this.inbox.prune(`${retencaoInboxDias}d`);
    const deadLettersRemovidas = await this.deadLetters.purge({
      failedBefore: new Date(agora.getTime() - retencaoDeadLettersDias * MS_POR_DIA),
    });

    this.logger.log(`Limpeza do outbox: inbox=${inboxRemovidas} deadLetters=${deadLettersRemovidas}`);
    return { inboxRemovidas, deadLettersRemovidas };
  }
}
