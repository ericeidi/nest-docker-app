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
}

const MODOS_RELAY_VALIDOS: readonly ModoRelay[] = ['continuo', 'sob-demanda'];
const TOPICO_EVENTOS_PADRAO = 'eventos-app';

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

  return {
    projetoPubSub: projetoPubSub ? projetoPubSub : undefined,
    topicoEventos: configService.get<string>('PUBSUB_TOPICO_EVENTOS', TOPICO_EVENTOS_PADRAO),
    modoRelay: modoRelay as ModoRelay,
    migrarNaInicializacao: configService.get<string>('OUTBOX_MIGRAR_NA_INICIALIZACAO', 'false') === 'true',
  };
}
