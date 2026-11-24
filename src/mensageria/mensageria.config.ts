import { ConfigService } from '@nestjs/config';

/**
 * Como o relay do outbox é disparado neste processo:
 * - `continuo`: loop de polling em background (processo sempre ligado: docker compose, VM).
 * - `sob-demanda`: sem loop; o relay roda dentro da requisição, logo após o commit, e pelo
 *   endpoint chamado pelo Cloud Scheduler. Para o Cloud Run com `cpu_idle = true`, onde não
 *   há CPU entre requisições e um loop em background ficaria parado.
 */
export type ModoRelay = 'continuo' | 'sob-demanda';

export interface ConfiguracaoMensageria {
  /** Projeto GCP do Pub/Sub. Vazio = detectado pelo client (Cloud Run). */
  projetoPubSub: string | undefined;
  /** Tópico onde o relay publica os eventos do outbox. */
  topicoEventos: string;
  modoRelay: ModoRelay;
  /** Aplica as migrations do schema nest_outbox na inicialização (só testes/desenvolvimento). */
  migrarNaInicializacao: boolean;
  /** Dias que o inbox guarda os ids processados. Precisa cobrir qualquer reentrega, replay de DLQ incluído. */
  retencaoInboxDias: number;
  /** Dias que uma dead letter do outbox fica disponível para requeue antes de ser apagada. */
  retencaoDeadLettersDias: number;
}

const MODOS_RELAY_VALIDOS: readonly ModoRelay[] = ['continuo', 'sob-demanda'];
const TOPICO_EVENTOS_PADRAO = 'eventos-app';
const RETENCAO_INBOX_DIAS_PADRAO = 30;
const RETENCAO_DEAD_LETTERS_DIAS_PADRAO = 14;

/**
 * Lê e valida as variáveis de mensageria. Falha na inicialização com mensagem clara
 * em vez de deixar um valor inválido estourar no meio de uma publicação.
 */
export function lerConfiguracaoMensageria(configService: ConfigService): ConfiguracaoMensageria {
  const modoRelay = configService.get<string>('OUTBOX_RELAY_MODO', 'continuo');
  if (!MODOS_RELAY_VALIDOS.includes(modoRelay as ModoRelay)) {
    throw new Error(
      `OUTBOX_RELAY_MODO inválido: "${modoRelay}". Valores aceitos: ${MODOS_RELAY_VALIDOS.join(', ')}`,
    );
  }

  const projetoPubSub = configService.get<string>('PUBSUB_PROJETO_ID')?.trim();
  const retencaoInboxDias = lerDiasPositivos(configService, 'OUTBOX_RETENCAO_INBOX_DIAS', RETENCAO_INBOX_DIAS_PADRAO);
  const retencaoDeadLettersDias = lerDiasPositivos(
    configService,
    'OUTBOX_RETENCAO_DEAD_LETTERS_DIAS',
    RETENCAO_DEAD_LETTERS_DIAS_PADRAO,
  );
  // Uma dead letter reenfileirada mantém o id: se o inbox já esqueceu o id, o job roda de novo
  if (retencaoInboxDias < retencaoDeadLettersDias) {
    throw new Error(
      `OUTBOX_RETENCAO_INBOX_DIAS (${retencaoInboxDias}) precisa ser >= OUTBOX_RETENCAO_DEAD_LETTERS_DIAS (${retencaoDeadLettersDias})`,
    );
  }

  return {
    projetoPubSub: projetoPubSub ? projetoPubSub : undefined,
    topicoEventos: configService.get<string>('PUBSUB_TOPICO_EVENTOS', TOPICO_EVENTOS_PADRAO),
    modoRelay: modoRelay as ModoRelay,
    migrarNaInicializacao: configService.get<string>('OUTBOX_MIGRAR_NA_INICIALIZACAO', 'false') === 'true',
    retencaoInboxDias,
    retencaoDeadLettersDias,
  };
}

function lerDiasPositivos(configService: ConfigService, nomeVariavel: string, diasPadrao: number): number {
  const valorConfigurado = configService.get<string>(nomeVariavel, String(diasPadrao));
  const dias = Number(valorConfigurado);
  if (!Number.isInteger(dias) || dias < 1) {
    throw new Error(`${nomeVariavel} inválido: "${valorConfigurado}". Use um número inteiro de dias >= 1`);
  }
  return dias;
}
