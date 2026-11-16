import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

const PORTA_POSTGRES_PADRAO = 5432;
const TENTATIVAS_CONEXAO = 5;
const INTERVALO_ENTRE_TENTATIVAS_MS = 3000;

/**
 * Conexão com o PostgreSQL via TypeORM.
 * DB_HOST deve ser o nome do serviço no docker-compose (ex.: "postgres"),
 * resolvido pelo DNS interno da rede Docker — nunca "localhost" dentro do container.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.getOrThrow<string>('DB_HOST'),
        port: Number(configService.get<string>('DB_PORT', String(PORTA_POSTGRES_PADRAO))),
        username: configService.getOrThrow<string>('DB_USER'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        // Schema nunca é alterado automaticamente — mudanças só via migration
        synchronize: false,
        retryAttempts: TENTATIVAS_CONEXAO,
        retryDelay: INTERVALO_ENTRE_TENTATIVAS_MS,
        // Opções repassadas ao pool do driver pg
        extra: {
          max: 10,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 10000,
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
