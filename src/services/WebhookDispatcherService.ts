import { prisma } from '../config/db';
import { SignatureRequest, WebhookJob } from '@prisma/client';
import QRCode from 'qrcode';
import { env } from '../config/env';

/**
 * Estrategia de backoff exponencial para reintentos de webhooks.
 *
 * Intento 1 → esperar 1 minuto
 * Intento 2 → esperar 5 minutos
 * Intento 3 → esperar 1 hora
 * Intento 4+ → marcar como FAILED (sin más reintentos)
 */
const RETRY_DELAYS_MS = [
  1 * 60 * 1000,      // Intento 1 → esperar 1 min
  5 * 60 * 1000,      // Intento 2 → esperar 5 min
  15 * 60 * 1000,     // Intento 3 → esperar 15 min
  30 * 60 * 1000,     // Intento 4 → esperar 30 min
  1 * 60 * 60 * 1000,    // Intento 5 → esperar 1 hora
  2 * 60 * 60 * 1000,    // Intento 6 → esperar 2 horas
  4 * 60 * 60 * 1000,    // Intento 7 → esperar 4 horas
  8 * 60 * 60 * 1000,    // Intento 8 → esperar 8 horas
  12 * 60 * 60 * 1000,   // Intento 9 → esperar 12 horas
];

export const MAX_WEBHOOK_ATTEMPTS = 10; // 10 intentos máximo (1 inicial + 9 reintentos)

export interface WebhookPayload {
  event: 'SIGNATURE_COMPLETED' | 'SIGNATURE_FAILED';
  signatureRequestId: string;
  documentHash: string;
  documentName: string;
  signatureData: string | null;
  signatureString: string | null;
  nom151Stamp: string | null;
  signerName: string | null;
  signerRfc: string | null;
  cerSerialNumber: string | null;
  cadenaOriginal: string | null;
  qrCodeUrl: string | null;
  completedAt: string;
}

export class WebhookDispatcherService {
  /**
   * Encola un nuevo WebhookJob para que el worker lo despache.
   * Se llama después de completar o fallar una SignatureRequest.
   */
  static async enqueue(signatureRequest: SignatureRequest): Promise<void> {
    // Generar enlace de verificación y código QR en base64
    const baseDomain = process.env.FRONTEND_URL || `http://${env.DOMAIN || 'localhost'}:5001`;
    const verificationUrl = `${baseDomain}/verify/${signatureRequest.id}`;
    let qrCodeUrl: string | null = null;
    
    try {
      qrCodeUrl = await QRCode.toDataURL(verificationUrl);
    } catch (err) {
      console.error(`[📬 WEBHOOK] No se pudo generar el QR para ${signatureRequest.id}:`, err);
    }

    const payload: WebhookPayload = {
      event: signatureRequest.status === 'SIGNED'
        ? 'SIGNATURE_COMPLETED'
        : 'SIGNATURE_FAILED',
      signatureRequestId: signatureRequest.id,
      documentHash:        signatureRequest.documentHash,
      documentName:        signatureRequest.documentName,
      signatureData:       signatureRequest.signatureData,
      signatureString:     signatureRequest.signatureData,
      nom151Stamp:         signatureRequest.nom151Stamp,
      signerName:          signatureRequest.signerName,
      signerRfc:           signatureRequest.signerRfc,
      cerSerialNumber:     signatureRequest.cerSerialNumber,
      cadenaOriginal:      signatureRequest.documentHash, // En flujo webhook se firma el hash directamente
      qrCodeUrl,
      completedAt:         new Date().toISOString(),
    };

    await prisma.webhookJob.create({
      data: {
        signatureRequestId: signatureRequest.id,
        url:                signatureRequest.webhookUrl,
        payload:            JSON.stringify(payload),
        // Despachar inmediatamente (nextRetryAt = null significa "ya")
        nextRetryAt:        null,
      },
    });

    await prisma.auditLog.create({
      data: {
        method: 'POST',
        endpoint: `/services/WebhookDispatcherService/enqueue`,
        originIp: '127.0.0.1',
        role: null,
        username: 'Sistema (WebhookDispatcherService)',
        description: `Webhook encolado para SignatureRequest (ID: ${signatureRequest.id}) — Destino URL: ${signatureRequest.webhookUrl}`,
      }
    }).catch(err => console.error("Error creating webhook enqueue auditLog:", err));

    console.log(`[📬 WEBHOOK] Job encolado para SignatureRequest ${signatureRequest.id}`);
  }

  /**
   * Despacha un único WebhookJob: hace el POST HTTP y actualiza el estado en BD.
   * Retorna true si fue exitoso, false si falló.
   */
  static async dispatch(job: WebhookJob): Promise<boolean> {
    const attempt = job.attempts + 1;
    console.log(`[📬 WEBHOOK] Intento #${attempt} para job ${job.id} → ${job.url}`);

    let responseCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const response = await fetch(job.url, {
        method:  'POST',
        headers: {
          'Content-Type':       'application/json',
          'X-Webhook-Source':   'Open-Signer',
          'X-Webhook-Event':    'signature',
          'X-Webhook-Attempt':  String(attempt),
        },
        body:    job.payload,
        signal:  AbortSignal.timeout(15_000), // 15 segundos máximo
      });

      responseCode = response.status;
      responseBody = await response.text().catch(() => '');
      // Considerar exitoso cualquier 2xx
      success = response.ok;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      responseBody = `Error de red: ${msg}`;
      console.error(`[📬 WEBHOOK] Error de red en job ${job.id}: ${msg}`);
    }

    if (success) {
      await prisma.webhookJob.update({
        where: { id: job.id },
        data: {
          status:           'SUCCESS',
          attempts:         attempt,
          lastAttemptAt:    new Date(),
          lastResponseCode: responseCode,
          lastResponseBody: responseBody?.substring(0, 500) ?? null,
          nextRetryAt:      null,
        },
      });

      await prisma.auditLog.create({
        data: {
          method: 'POST',
          endpoint: `/services/WebhookDispatcherService/dispatch`,
          originIp: '127.0.0.1',
          role: null,
          username: 'Sistema (WebhookWorker)',
          description: `Envío exitoso de webhook — Intento #${attempt} (Job ID: ${job.id}, HTTP: ${responseCode}, URL: ${job.url}, Solicitud ID: ${job.signatureRequestId})`,
        }
      }).catch(err => console.error("Error creating webhook dispatch success auditLog:", err));

      console.log(`[✅ WEBHOOK] Job ${job.id} entregado exitosamente (HTTP ${responseCode})`);
      return true;
    }

    // Falló — calcular próximo reintento
    const nextDelayMs = RETRY_DELAYS_MS[attempt - 1]; // undefined si ya superó todos los reintentos
    const hasFinallyFailed = !nextDelayMs;

    await prisma.webhookJob.update({
      where: { id: job.id },
      data: {
        status:           hasFinallyFailed ? 'FAILED' : 'PENDING',
        attempts:         attempt,
        lastAttemptAt:    new Date(),
        lastResponseCode: responseCode,
        lastResponseBody: responseBody?.substring(0, 500) ?? null,
        nextRetryAt:      hasFinallyFailed
          ? null
          : new Date(Date.now() + nextDelayMs),
      },
    });

    if (hasFinallyFailed) {
      await prisma.auditLog.create({
        data: {
          method: 'POST',
          endpoint: `/services/WebhookDispatcherService/dispatch`,
          originIp: '127.0.0.1',
          role: null,
          username: 'Sistema (WebhookWorker)',
          description: `Envío de webhook fallido definitivamente — Reintentos agotados tras ${attempt} intentos (Job ID: ${job.id}, URL: ${job.url}, Solicitud ID: ${job.signatureRequestId})`,
        }
      }).catch(err => console.error("Error creating webhook dispatch fail auditLog:", err));

      console.error(`[❌ WEBHOOK] Job ${job.id} FALLIDO definitivamente tras ${attempt} intentos.`);
    } else {
      await prisma.auditLog.create({
        data: {
          method: 'POST',
          endpoint: `/services/WebhookDispatcherService/dispatch`,
          originIp: '127.0.0.1',
          role: null,
          username: 'Sistema (WebhookWorker)',
          description: `Intento de envío de webhook fallido — Intento #${attempt}/${MAX_WEBHOOK_ATTEMPTS} (Job ID: ${job.id}, HTTP: ${responseCode || 'Red/Timeout'}, Reintento programado, URL: ${job.url}, Solicitud ID: ${job.signatureRequestId})`,
        }
      }).catch(err => console.error("Error creating webhook dispatch retry auditLog:", err));

      const nextIn = nextDelayMs / 1000;
      console.warn(`[⚠️  WEBHOOK] Job ${job.id} falló (intento ${attempt}). Reintento en ${nextIn}s`);
    }

    return false;
  }

  /**
   * Procesa todos los WebhookJobs pendientes cuyo nextRetryAt ya venció.
   * Llamado periódicamente por el WebhookWorker.
   */
  static async processPendingJobs(): Promise<void> {
    const now = new Date();

    const pendingJobs = await prisma.webhookJob.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } },
        ],
      },
      take: 50, // Máximo 50 por ciclo para no saturar
    });

    if (pendingJobs.length > 0) {
      console.log(`[📬 WEBHOOK] Procesando ${pendingJobs.length} job(s) pendientes...`);
    }

    for (const job of pendingJobs) {
      await this.dispatch(job);
    }
  }
}
