import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ManutencaoOutbox } from '../mensageria/manutencao-outbox.service.js';
import { ManutencaoOutboxController } from './manutencao-outbox.controller.js';

const ID_VALIDO = '01a20f36-1ea0-71e5-8b50-fb1516968b2d';

function criarController(manutencao: Partial<ManutencaoOutbox>): ManutencaoOutboxController {
  return new ManutencaoOutboxController(manutencao as ManutencaoOutbox);
}

describe('ManutencaoOutboxController', () => {
  it('listarDeadLetters: repassa a paginação', async () => {
    const listarDeadLetters = vi.fn().mockResolvedValue([]);

    await criarController({ listarDeadLetters }).listarDeadLetters(10, 20);

    expect(listarDeadLetters).toHaveBeenCalledWith(10, 20);
  });

  it('listarDeadLetters: rejeita limit fora de 1..100 e offset negativo', () => {
    const controller = criarController({ listarDeadLetters: vi.fn() });

    expect(() => controller.listarDeadLetters(0, 0)).toThrow(BadRequestException);
    expect(() => controller.listarDeadLetters(101, 0)).toThrow(BadRequestException);
    expect(() => controller.listarDeadLetters(10, -1)).toThrow(BadRequestException);
  });

  it('reenfileirar: rejeita id que não é UUID sem ir ao banco', async () => {
    const reenfileirar = vi.fn();

    await expect(criarController({ reenfileirar }).reenfileirar('nao-e-uuid')).rejects.toThrow(BadRequestException);
    expect(reenfileirar).not.toHaveBeenCalled();
  });

  it('reenfileirar: 404 quando a dead letter não existe', async () => {
    const reenfileirar = vi.fn().mockResolvedValue(false);

    await expect(criarController({ reenfileirar }).reenfileirar(ID_VALIDO)).rejects.toThrow(NotFoundException);
  });

  it('reenfileirar: sucesso quando a dead letter existe', async () => {
    const reenfileirar = vi.fn().mockResolvedValue(true);

    await expect(criarController({ reenfileirar }).reenfileirar(ID_VALIDO)).resolves.toBeUndefined();
  });
});
