import { Module } from '@nestjs/common';
import { MensageriaModule } from '../mensageria/mensageria.module.js';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';

/** Lado da API da demonstração: POST /demo/tarefas. */
@Module({
  imports: [MensageriaModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoProdutorModule {}
