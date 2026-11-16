import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Converte "https://a.com, https://b.com" em lista de origens.
 * Vazio/ausente → lista vazia (nenhuma origem cross-origin permitida).
 */
export function lerOrigensPermitidas(valorCorsOrigins: string | undefined): string[] {
  if (!valorCorsOrigins) {
    return [];
  }
  return valorCorsOrigins
    .split(',')
    .map((origem) => origem.trim())
    .filter((origem) => origem.length > 0);
}

/**
 * Segurança HTTP aplicada à aplicação. Usada no main.ts e nos testes e2e,
 * para o teste exercitar exatamente a mesma configuração da produção.
 * Deve ser chamada ANTES de app.init()/app.listen().
 */
export function configurarSegurancaHttp(app: INestApplication, configService: ConfigService): void {
  // Headers de segurança nativos do Nest 12.1+ (mesmos padrões do helmet 8) e remove X-Powered-By
  app.useSecurityHeaders();

  // CORS só para origens explícitas; sem CORS_ORIGINS nenhuma origem externa é liberada
  const origensPermitidas = lerOrigensPermitidas(configService.get<string>('CORS_ORIGINS'));
  app.enableCors({
    origin: origensPermitidas.length > 0 ? origensPermitidas : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
}
