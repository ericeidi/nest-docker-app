import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ManutencaoOutbox,
  type ResultadoLimpeza,
  type ResumoDeadLetter,
} from '../mensageria/manutencao-outbox.service.js';

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 100;
/** Ids do outbox são UUIDs (v7); validar o formato evita ir ao banco com lixo. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Operação do outbox. Fica no worker, que é privado no Cloud Run: só quem tem
 * roles/run.invoker chama (a service account do Scheduler e o dono do projeto).
 */
@Controller('internal/outbox')
export class ManutencaoOutboxController {
  constructor(private readonly manutencaoOutbox: ManutencaoOutbox) {}

  /** Dead letters do outbox (publicações esgotadas), sem payload. Paginado, mais recentes primeiro. */
  @Get('dead-letters')
  listarDeadLetters(
    @Query('limit', new DefaultValuePipe(LIMITE_PADRAO), ParseIntPipe) limite: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) deslocamento: number,
  ): Promise<ResumoDeadLetter[]> {
    if (limite < 1 || limite > LIMITE_MAXIMO) {
      throw new BadRequestException(`limit precisa estar entre 1 e ${LIMITE_MAXIMO}`);
    }
    if (deslocamento < 0) {
      throw new BadRequestException('offset precisa ser >= 0');
    }
    return this.manutencaoOutbox.listarDeadLetters(limite, deslocamento);
  }

  /** Devolve uma dead letter ao outbox; o relay publica de novo na próxima rodada. */
  @Post('dead-letters/:id/requeue')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reenfileirar(@Param('id') idDeadLetter: string): Promise<void> {
    if (!FORMATO_UUID.test(idDeadLetter)) {
      throw new BadRequestException('id precisa ser um UUID');
    }
    const foiReenfileirada = await this.manutencaoOutbox.reenfileirar(idDeadLetter);
    if (!foiReenfileirada) {
      throw new NotFoundException('Dead letter não encontrada');
    }
  }

  /** Retenção do inbox e das dead letters. Chamado uma vez por dia pelo Cloud Scheduler. */
  @Post('manutencao')
  @HttpCode(HttpStatus.OK)
  limpar(): Promise<ResultadoLimpeza> {
    return this.manutencaoOutbox.limpar();
  }
}
