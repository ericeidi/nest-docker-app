import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

const JANELA_RATE_LIMIT_PADRAO_MS = 60000;
const LIMITE_REQUISICOES_PADRAO = 100;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting global: LIMITE requisições por IP a cada JANELA (ms). Armazenamento em memória.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: Number(configService.get<string>('THROTTLE_TTL_MS', String(JANELA_RATE_LIMIT_PADRAO_MS))),
          limit: Number(configService.get<string>('THROTTLE_LIMIT', String(LIMITE_REQUISICOES_PADRAO))),
        },
      ],
    }),
    DatabaseModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
