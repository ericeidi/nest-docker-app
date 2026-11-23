import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxRelay, type OutboxRelayRunResult } from '@nestjs/outbox';
import { CONFIGURACAO_MENSAGERIA } from './mensageria.tokens.js';
import type { ConfiguracaoMensageria } from './mensageria.config.js';

/** Soma das rodadas de `drenar()`. */
export interface ResumoDrenagem {
  rodadas: number;
  publicadas: number;
  reagendadas: number;
  enviadasParaDeadLetter: number;
}

/** Limite de rodadas por drenagem: impede que uma chamada do Scheduler rode indefinidamente. */
const MAXIMO_RODADAS_DRENAGEM = 20;

/**
 * Decide como o relay é acionado, conforme OUTBOX_RELAY_MODO.
 * Produtores chamam `aposCommit()` depois que a transação com `outbox.add()` confirmou.
 */
@Injectable()
export class DisparadorRelay {
  private readonly logger = new Logger(DisparadorRelay.name);

  constructor(
    private readonly relay: OutboxRelay,
    @Inject(CONFIGURACAO_MENSAGERIA) private readonly configuracao: ConfiguracaoMensageria,
  ) {}

  /**
   * Nunca lança: os dados já foram confirmados no banco, e a mensagem pendente no outbox
   * será publicada pela próxima rodada do relay (loop ou Cloud Scheduler).
   */
  async aposCommit(): Promise<void> {
    if (this.configuracao.modoRelay === 'continuo') {
      // Acorda o loop agora, sem esperar o próximo poll
      this.relay.notify();
      return;
    }

    // Sob demanda: publica dentro da requisição, enquanto o Cloud Run ainda dá CPU
    try {
      await this.relay.runOnce();
    } catch (erro) {
      this.logger.warn(
        `Publicação após commit falhou; a mensagem segue pendente no outbox: ${descreverErro(erro)}`,
      );
    }
  }

  /** Roda o relay até não restar mensagem disponível (ou até o limite de rodadas). */
  async drenar(): Promise<ResumoDrenagem> {
    const resumo: ResumoDrenagem = { rodadas: 0, publicadas: 0, reagendadas: 0, enviadasParaDeadLetter: 0 };

    while (resumo.rodadas < MAXIMO_RODADAS_DRENAGEM) {
      const resultado: OutboxRelayRunResult = await this.relay.runOnce();
      resumo.rodadas += 1;
      resumo.publicadas += resultado.published;
      resumo.reagendadas += resultado.retried;
      resumo.enviadasParaDeadLetter += resultado.deadLettered;
      if (resultado.claimed === 0) {
        break;
      }
    }

    return resumo;
  }
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
