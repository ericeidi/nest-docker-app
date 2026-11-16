import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

const TIMEOUT_PING_BANCO_MS = 3000;

@Controller('health')
export class HealthController {
  constructor(
    private readonly servicoHealthCheck: HealthCheckService,
    private readonly indicadorBanco: TypeOrmHealthIndicator,
  ) {}

  /**
   * Liveness: a aplicação está de pé. Usado pelo HEALTHCHECK do Docker.
   * Não consulta o banco — queda do Postgres não deve marcar a API como quebrada.
   */
  @Get()
  @HealthCheck()
  verificarAplicacao() {
    return this.servicoHealthCheck.check([]);
  }

  /**
   * Readiness: a aplicação alcança o PostgreSQL (executa SELECT 1).
   * Retorna 503 com o motivo da falha quando o banco não responde.
   */
  @Get('db')
  @HealthCheck()
  verificarBanco() {
    return this.servicoHealthCheck.check([
      () => this.indicadorBanco.pingCheck('postgres').withTimeout(TIMEOUT_PING_BANCO_MS),
    ]);
  }
}
