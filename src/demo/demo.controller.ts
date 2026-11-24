import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { DemoService, type TarefaDemoAgendada } from './demo.service.js';

/**
 * Demonstração da mensageria. Só é registrado com DEMO_MENSAGERIA_HABILITADA=true
 * (ver AppModule): é uma rota pública que grava no banco.
 */
@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  /** 202: a tarefa foi aceita e será processada em background pelo worker. */
  @Post('tarefas')
  @HttpCode(HttpStatus.ACCEPTED)
  agendarTarefa(): Promise<TarefaDemoAgendada> {
    return this.demoService.agendarTarefa();
  }
}
