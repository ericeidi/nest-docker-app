import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { lerEnvelopePubSub } from '../mensageria/envelope-pubsub.js';
import { ProcessadorEventos } from '../mensageria/processador-eventos.service.js';

/**
 * Endpoint de push da assinatura do Pub/Sub. Só existe no modo worker.
 *
 * 204 = processado ou duplicado (o Pub/Sub dá a mensagem por entregue).
 * 4xx/5xx = falha: o Pub/Sub reentrega com backoff e, após o limite, manda para a DLQ.
 *
 * Autenticação: no Cloud Run o serviço é privado e só a service account da assinatura tem
 * roles/run.invoker; o token OIDC é validado pelo Cloud Run antes de chegar aqui.
 */
@Controller('internal/eventos')
export class ConsumidorEventosController {
  private readonly logger = new Logger(ConsumidorEventosController.name);

  constructor(private readonly processadorEventos: ProcessadorEventos) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async receber(@Body() corpoRequisicao: unknown): Promise<void> {
    const evento = lerEnvelopePubSub(corpoRequisicao);
    try {
      await this.processadorEventos.processar(evento);
    } catch (erro) {
      // Só ids e tópico no log: o payload pode conter dados pessoais
      this.logger.error(
        `Falha ao processar idEvento=${evento.idEvento} topico=${evento.topico} tentativa=${evento.tentativa ?? '?'}`,
        erro instanceof Error ? erro.stack : String(erro),
      );
      throw erro;
    }
  }
}
