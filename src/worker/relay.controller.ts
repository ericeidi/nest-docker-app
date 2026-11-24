import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { DisparadorRelay, type ResumoDrenagem } from '../mensageria/disparador-relay.service.js';

/**
 * Rede de segurança do outbox: o Cloud Scheduler chama a cada minuto e o relay publica o que
 * ficou pendente (publicação após commit que falhou, API que caiu logo depois do commit).
 *
 * Fica no worker, e não na API, porque o worker é privado no Cloud Run: só quem tem
 * roles/run.invoker (a service account do Scheduler) consegue chamar.
 */
@Controller('internal/outbox')
export class RelayController {
  constructor(private readonly disparadorRelay: DisparadorRelay) {}

  @Post('relay')
  @HttpCode(HttpStatus.OK)
  drenar(): Promise<ResumoDrenagem> {
    return this.disparadorRelay.drenar();
  }
}
