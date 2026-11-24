export type ModoApp = 'api' | 'worker';

const MODOS_APP_VALIDOS: readonly ModoApp[] = ['api', 'worker'];

/**
 * Papel do processo. Lido de process.env antes do Nest subir (o módulo raiz depende dele),
 * então precisa vir do ambiente do container, não do arquivo .env.
 * Ausente = 'api'.
 */
export function lerModoApp(valorModoApp: string | undefined): ModoApp {
  if (valorModoApp === undefined || valorModoApp === '') {
    return 'api';
  }
  if (!MODOS_APP_VALIDOS.includes(valorModoApp as ModoApp)) {
    throw new Error(`MODO_APP inválido: "${valorModoApp}". Valores aceitos: ${MODOS_APP_VALIDOS.join(', ')}`);
  }
  return valorModoApp as ModoApp;
}
