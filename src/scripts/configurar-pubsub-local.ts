import { PubSub } from '@google-cloud/pubsub';

/**
 * Cria no EMULADOR do Pub/Sub os mesmos recursos que o Terraform cria no GCP:
 * tópico de eventos, tópico DLQ, assinatura push para o worker e assinatura pull da DLQ.
 * Idempotente: recurso que já existe é mantido.
 *
 *   node dist/scripts/configurar-pubsub-local.js   (serviço pubsub-setup do docker compose)
 *
 * Recusa rodar sem PUBSUB_EMULATOR_HOST, para nunca criar nada num projeto GCP real.
 */

const CODIGO_GRPC_JA_EXISTE = 6;

const MAXIMO_TENTATIVAS_ENTREGA = 5;
const BACKOFF_MINIMO_SEGUNDOS = 10;
const BACKOFF_MAXIMO_SEGUNDOS = 600;
const PRAZO_ACK_SEGUNDOS = 60;

function lerVariavelObrigatoria(nomeVariavel: string): string {
  const valorVariavel = process.env[nomeVariavel];
  if (!valorVariavel) {
    throw new Error(`Variável obrigatória ausente: ${nomeVariavel}`);
  }
  return valorVariavel;
}

async function ignorarSeJaExiste(descricaoRecurso: string, criarRecurso: () => Promise<unknown>): Promise<void> {
  try {
    await criarRecurso();
    console.log(`Criado: ${descricaoRecurso}`);
  } catch (erro) {
    if ((erro as { code?: number }).code === CODIGO_GRPC_JA_EXISTE) {
      console.log(`Já existe: ${descricaoRecurso}`);
      return;
    }
    throw erro;
  }
}

async function configurarPubSubLocal(): Promise<void> {
  lerVariavelObrigatoria('PUBSUB_EMULATOR_HOST');
  const projetoId = lerVariavelObrigatoria('PUBSUB_PROJETO_ID');
  const nomeTopicoEventos = lerVariavelObrigatoria('PUBSUB_TOPICO_EVENTOS');
  const urlPushWorker = lerVariavelObrigatoria('PUBSUB_URL_PUSH_WORKER');
  const nomeTopicoDlq = `${nomeTopicoEventos}-dlq`;

  const clientePubSub = new PubSub({ projectId: projetoId });
  try {
    await ignorarSeJaExiste(`tópico ${nomeTopicoEventos}`, () => clientePubSub.createTopic(nomeTopicoEventos));
    await ignorarSeJaExiste(`tópico ${nomeTopicoDlq}`, () => clientePubSub.createTopic(nomeTopicoDlq));

    await ignorarSeJaExiste(`assinatura push ${nomeTopicoEventos}-worker`, () =>
      clientePubSub.topic(nomeTopicoEventos).createSubscription(`${nomeTopicoEventos}-worker`, {
        pushConfig: { pushEndpoint: urlPushWorker },
        ackDeadlineSeconds: PRAZO_ACK_SEGUNDOS,
        retryPolicy: {
          minimumBackoff: { seconds: BACKOFF_MINIMO_SEGUNDOS },
          maximumBackoff: { seconds: BACKOFF_MAXIMO_SEGUNDOS },
        },
        deadLetterPolicy: {
          deadLetterTopic: `projects/${projetoId}/topics/${nomeTopicoDlq}`,
          maxDeliveryAttempts: MAXIMO_TENTATIVAS_ENTREGA,
        },
      }),
    );

    // Pull: as mensagens mortas ficam guardadas para inspeção e replay
    await ignorarSeJaExiste(`assinatura ${nomeTopicoDlq}-inspecao`, () =>
      clientePubSub.topic(nomeTopicoDlq).createSubscription(`${nomeTopicoDlq}-inspecao`),
    );
  } finally {
    await clientePubSub.close();
  }
}

await configurarPubSubLocal();
