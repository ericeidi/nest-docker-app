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
    });
  });

  it('lê os valores definidos', () => {
    const configuracao = lerConfiguracaoMensageria(
      criarConfigService({
        PUBSUB_PROJETO_ID: 'nest-local',
        PUBSUB_TOPICO_EVENTOS: 'outro-topico',
        OUTBOX_RELAY_MODO: 'sob-demanda',
        OUTBOX_MIGRAR_NA_INICIALIZACAO: 'true',
      }),
    );

    expect(configuracao).toEqual({
      projetoPubSub: 'nest-local',
      topicoEventos: 'outro-topico',
      modoRelay: 'sob-demanda',
      migrarNaInicializacao: true,
    });
  });

  it('rejeita modo de relay desconhecido', () => {
    expect(() => lerConfiguracaoMensageria(criarConfigService({ OUTBOX_RELAY_MODO: 'sempre' }))).toThrow(
      'OUTBOX_RELAY_MODO inválido',
    );
  });
});
