/** Tópico do job de demonstração da mensageria. */
export const TOPICO_TAREFA_DEMO_CRIADA = 'demo.tarefa-criada';

/** Payload do evento: só ids e datas, nunca dados pessoais. */
export interface PayloadTarefaDemoCriada {
  tarefaId: string;
  criadaEm: string;
}
