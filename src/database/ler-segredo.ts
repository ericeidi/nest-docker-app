import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';

/**
 * Lê um segredo seguindo a convenção `<NOME>_FILE` das imagens oficiais Docker:
 * se `<NOME>_FILE` existir, lê o conteúdo do arquivo (ex.: /run/secrets/...);
 * senão, usa a variável `<NOME>` diretamente (ex.: testes e2e).
 *
 * Implementação própria: o @nestjs/config não suporta a convenção `_FILE`.
 */
export function lerSegredo(configService: ConfigService, nomeVariavel: string): string {
  const caminhoArquivoSegredo = configService.get<string>(`${nomeVariavel}_FILE`);

  if (caminhoArquivoSegredo) {
    const valorSegredo = readFileSync(caminhoArquivoSegredo, 'utf8').trim();
    if (!valorSegredo) {
      // Mensagem sem o valor do segredo, apenas o caminho
      throw new Error(`Arquivo de segredo vazio: ${nomeVariavel}_FILE=${caminhoArquivoSegredo}`);
    }
    return valorSegredo;
  }

  return configService.getOrThrow<string>(nomeVariavel);
}
