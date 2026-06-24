import { WebhookDispatcherService } from './WebhookDispatcherService';
import { prisma } from '../config/db';

/**
 * Worker independiente de despacho de webhooks.
 *
 * Corre en un intervalo y procesa todos los WebhookJobs pendientes
 * cuyo nextRetryAt ya venció. Implementa backoff exponencial delegando
 * la lógica a WebhookDispatcherService.dispatch().
 *
 * Puede integrarse en el proceso principal (server.ts) o ejecutarse
 * como proceso separado:
 *   ts-node src/services/WebhookWorker.ts
 */

const POLL_INTERVAL_MS = 30 * 1000; // Revisar cada 30 segundos

/**
 * Limpia automáticamente las SignatureRequests PENDING que superaron su expiresAt.
 */
async function expireStaleRequests(): Promise<void> {
  const { count } = await prisma.signatureRequest.updateMany({
    where: {
      status:    'PENDING',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  });

  if (count > 0) {
    console.log(`[⏰ WORKER] ${count} solicitud(es) de firma marcadas como EXPIRED.`);
  }
}

async function runCycle(): Promise<void> {
  try {
    await expireStaleRequests();
    await WebhookDispatcherService.processPendingJobs();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[❌ WORKER] Error en ciclo de procesamiento: ${msg}`);
  }
}

export function startWebhookWorker(): void {
  console.log(`[🔄 WORKER] Worker de webhooks iniciado (intervalo: ${POLL_INTERVAL_MS / 1000}s)`);

  // Ejecutar inmediatamente al arrancar
  runCycle();

  // Luego en intervalos regulares
  const interval = setInterval(runCycle, POLL_INTERVAL_MS);

  // Limpiar al apagar
  process.on('SIGTERM', () => clearInterval(interval));
  process.on('SIGINT',  () => clearInterval(interval));
}

// Si se ejecuta directamente como script independiente
if (require.main === module) {
  startWebhookWorker();
}
