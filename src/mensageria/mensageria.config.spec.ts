import { ConfigService } from '@nestjs/config';
import { lerConfiguracaoMensageria } from './mensageria.config.js';

function criarConfigService(variaveis: Record<string, string>): ConfigService {
  return new ConfigService(variaveis);
}

describe('lerConfiguracaoMensageria', () => {
  it('usa os padrões quando nada é definido', () => {
    expect(lerConfiguracaoMensageria(criarConfigService({}))).toEqual({
      projetoPubSub: undefined,
      topicoEventos: 'eventos-app',
      modoRelay: 'continuo',
      migrarNaInicializacao: false,
      retencaoInboxDias: 30,
      retencaoDeadLettersDias: 14,
    });
  });

  it('lê os valores definidos', () => {
    const configuracao = lerConfiguracaoMensageria(
      criarConfigService({
        PUBSUB_PROJETO_ID: 'nest-local',
        PUBSUB_TOPICO_EVENTOS: 'outro-topico',
        OUTBOX_RELAY_MODO: 'sob-demanda',
        OUTBOX_MIGRAR_NA_INICIALIZACAO: 'true',
        OUTBOX_RETENCAO_INBOX_DIAS: '60',
        OUTBOX_RETENCAO_DEAD_LETTERS_DIAS: '7',
      }),
    );

    expect(configuracao).toEqual({
      projetoPubSub: 'nest-local',
      topicoEventos: 'outro-topico',
      modoRelay: 'sob-demanda',
      migrarNaInicializacao: true,
      retencaoInboxDias: 60,
      retencaoDeadLettersDias: 7,
    });
  });

  it('rejeita modo de relay desconhecido', () => {
    expect(() => lerConfiguracaoMensageria(criarConfigService({ OUTBOX_RELAY_MODO: 'sempre' }))).toThrow(
      'OUTBOX_RELAY_MODO inválido',
    );
  });

  it('rejeita retenção que não é inteiro positivo', () => {
    expect(() => lerConfiguracaoMensageria(criarConfigService({ OUTBOX_RETENCAO_INBOX_DIAS: '0' }))).toThrow(
      'OUTBOX_RETENCAO_INBOX_DIAS inválido',
    );
    expect(() => lerConfiguracaoMensageria(criarConfigService({ OUTBOX_RETENCAO_DEAD_LETTERS_DIAS: 'abc' }))).toThrow(
      'OUTBOX_RETENCAO_DEAD_LETTERS_DIAS inválido',
    );
  });

  it('rejeita inbox mais curto que as dead letters (requeue reprocessaria o job)', () => {
    expect(() =>
      lerConfiguracaoMensageria(
        criarConfigService({ OUTBOX_RETENCAO_INBOX_DIAS: '7', OUTBOX_RETENCAO_DEAD_LETTERS_DIAS: '14' }),
      ),
    ).toThrow('precisa ser >=');
  });
});
