import { lerModoApp } from './modo-app.js';

describe('lerModoApp', () => {
  it.each([
    [undefined, 'api'],
    ['', 'api'],
    ['api', 'api'],
    ['worker', 'worker'],
  ])('MODO_APP=%s → %s', (valorModoApp, modoEsperado) => {
    expect(lerModoApp(valorModoApp)).toBe(modoEsperado);
  });

  it('rejeita valor desconhecido', () => {
    expect(() => lerModoApp('relay')).toThrow('MODO_APP inválido');
  });
});
