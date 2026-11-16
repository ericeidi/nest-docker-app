import { lerOrigensPermitidas } from './seguranca-http.js';

describe('lerOrigensPermitidas', () => {
  it('retorna lista vazia quando a variável não existe', () => {
    expect(lerOrigensPermitidas(undefined)).toEqual([]);
  });

  it('retorna lista vazia para string vazia ou só espaços/vírgulas', () => {
    expect(lerOrigensPermitidas('')).toEqual([]);
    expect(lerOrigensPermitidas(' , ')).toEqual([]);
  });

  it('separa por vírgula e remove espaços', () => {
    expect(lerOrigensPermitidas('https://a.exemplo, https://b.exemplo ')).toEqual([
      'https://a.exemplo',
      'https://b.exemplo',
    ]);
  });
});
