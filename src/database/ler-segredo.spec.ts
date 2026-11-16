import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { lerSegredo } from './ler-segredo.js';

describe('lerSegredo', () => {
  let diretorioTemporario: string;

  beforeEach(() => {
    diretorioTemporario = mkdtempSync(join(tmpdir(), 'segredo-'));
  });

  afterEach(() => {
    rmSync(diretorioTemporario, { recursive: true, force: true });
  });

  it('lê o valor do arquivo quando <NOME>_FILE existe (removendo quebra de linha)', () => {
    const caminhoSegredo = join(diretorioTemporario, 'senha.txt');
    writeFileSync(caminhoSegredo, 'senha-do-arquivo\n');
    const configService = new ConfigService({ DB_PASSWORD_FILE: caminhoSegredo, DB_PASSWORD: 'ignorada' });

    expect(lerSegredo(configService, 'DB_PASSWORD')).toBe('senha-do-arquivo');
  });

  it('usa a variável direta quando <NOME>_FILE não existe', () => {
    const configService = new ConfigService({ DB_PASSWORD: 'senha-direta' });

    expect(lerSegredo(configService, 'DB_PASSWORD')).toBe('senha-direta');
  });

  it('falha sem expor valor quando o arquivo está vazio', () => {
    const caminhoSegredo = join(diretorioTemporario, 'vazio.txt');
    writeFileSync(caminhoSegredo, '\n');
    const configService = new ConfigService({ DB_PASSWORD_FILE: caminhoSegredo });

    expect(() => lerSegredo(configService, 'DB_PASSWORD')).toThrow(/Arquivo de segredo vazio/);
  });

  it('falha quando nenhuma das duas variáveis existe', () => {
    const configService = new ConfigService({});

    expect(() => lerSegredo(configService, 'DB_PASSWORD')).toThrow();
  });
});
