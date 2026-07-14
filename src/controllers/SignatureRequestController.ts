import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../config/db";
import { AppError } from "../core/errors/AppError";
import { SatSignatureService } from "../services/SatSignatureService";
import { S3StorageService } from "../services/S3StorageService";
import { WebhookDispatcherService } from "../services/WebhookDispatcherService";
import { env } from "../config/env";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Stub para obtener el sello NOM-151 de un PSC (Prestador de Servicios de Certificación).
 * Si PSC_URL no está configurada, se omite sin error (valor null).
 *
 * Cuando se integre un PSC real (Edicom, Finkok, etc.):
 *  1. Configura PSC_URL en el .env
 *  2. Reemplaza este stub con la llamada HTTP real al PSC
 */
async function requestNom151Stamp(
  documentHash: string,
  signatureBase64: string,
): Promise<string | null> {
  const pscUrl = process.env.PSC_URL;

  if (!pscUrl) {
    // PSC no configurado — se omite el sello NOM-151
    return null;
  }

  try {
    const response = await fetch(pscUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentHash, signatureBase64 }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`PSC respondió con HTTP ${response.status}`);
    }

    const data = (await response.json()) as { stamp?: string };
    return data.stamp ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Log pero no fallar — NOM-151 no bloquea la firma
    console.warn(`[⚠️  PSC] No se pudo obtener el sello NOM-151: ${msg}`);
    return null;
  }
}

// ── Controlador ───────────────────────────────────────────────────────────────

export class SignatureRequestController {
  /**
   * POST /api/v1/signatures/request  (requiere API Key)
   *
   * El integrador sube el documento a firmar, la redirectUrl y webhookUrl.
   * El sistema calcula el hash, almacena el documento y crea una SignatureRequest PENDING.
   * Responde con la URL única donde el usuario deberá ir a firmar.
   */
  static async createRequest(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    const docFile = files?.documento?.[0];

    if (!docFile) {
      return next(
        new AppError(
          "El archivo del documento es obligatorio (campo: documento).",
          400,
        ),
      );
    }

    const { redirectUrl, webhookUrl, rfc } = req.body as {
      redirectUrl?: string;
      webhookUrl: string;
      rfc: string;
    };

    try {
      // 1. Calcular hash SHA-256 del documento
      const documentHash = crypto
        .createHash("sha256")
        .update(docFile.buffer)
        .digest("hex");

      // 2. Almacenar el documento en S3 / local
      const documentUrl = await S3StorageService.uploadDocument(
        docFile.originalname,
        docFile.buffer,
        docFile.mimetype,
      );

      // 3. Crear el registro SignatureRequest con TTL de 24 horas
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const clientName = req.apiKey?.name || null;
      const logoUrl = req.apiKey?.logoUrl || null;

      const signatureRequest = await prisma.signatureRequest.create({
        data: {
          documentHash,
          documentName: docFile.originalname,
          documentSize: docFile.size,
          documentUrl,
          redirectUrl: redirectUrl || null,
          webhookUrl,
          requestedRfc: rfc,
          clientId: req.user!.id,
          expiresAt,
          clientName,
          logoUrl,
        },
      });

      // 4. Construir la URL de firma para el usuario final
      const signUrl = `${env.DOMAIN}/firmar/${signatureRequest.id}`;

      res.status(201).json({
        status: "success",
        message: "Solicitud de firma creada correctamente.",
        data: {
          id: signatureRequest.id,
          signUrl,
          documentHash,
          documentName: docFile.originalname,
          expiresAt: expiresAt.toISOString(),
        },
      });
    } catch (error) {
      return next(error);
    } finally {
      // Limpiar el buffer del documento de memoria
      if (docFile?.buffer) docFile.buffer.fill(0);
    }
  }

  /**
   * GET /api/v1/signatures/request/:id/context  (público)
   *
   * El frontend de firma usa este endpoint para mostrarle al usuario
   * qué documento va a firmar, sin exponer datos sensibles.
   */
  static async getRequestContext(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.params;

      const signatureRequest = await prisma.signatureRequest.findUnique({
        where: { id },
        select: {
          id: true,
          documentHash: true,
          documentName: true,
          documentSize: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          clientName: true,
          logoUrl: true,
          requestedRfc: true,
        },
      });

      if (!signatureRequest) {
        throw new AppError(
          "La solicitud de firma no existe o el ID es inválido.",
          404,
        );
      }

      // Verificar si ya expiró
      if (
        signatureRequest.status === "EXPIRED" ||
        new Date() > signatureRequest.expiresAt
      ) {
        throw new AppError(
          "Esta sesión de firma ha expirado (TTL: 24 horas). Solicita un nuevo enlace al emisor.",
          410,
        );
      }

      if (signatureRequest.status !== "PENDING") {
        throw new AppError(
          `Esta solicitud de firma ya fue procesada (estado: ${signatureRequest.status}).`,
          409,
        );
      }

      // Generar URL prefirmada para el logo si existe
      let resolvedLogoUrl: string | null = null;
      if (signatureRequest.logoUrl) {
        try {
          const presigned = await S3StorageService.getPresignedUrl(
            signatureRequest.logoUrl,
            3600,
          );
          resolvedLogoUrl = presigned.url;
        } catch (err) {
          console.error(
            "Error generating presigned URL for request logo:",
            err,
          );
        }
      }

      res.status(200).json({
        status: "success",
        data: {
          ...signatureRequest,
          logoUrl: resolvedLogoUrl,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/signatures/complete  (público — llamado desde el browser del usuario)
   *
   * Recibe la firma generada en el navegador + el .cer público (como Base64).
   * NUNCA recibe la llave privada (.key) ni la contraseña.
   *
   * Flujo:
   *  1. Valida que la SignatureRequest exista y esté PENDING.
   *  2. Decodifica el .cer y lo valida contra la cadena de confianza SAT.
   *  3. Solicita el sello NOM-151 al PSC (si está configurado).
   *  4. Actualiza el registro a SIGNED.
   *  5. Encola el WebhookJob para notificar al integrador.
   *  6. Responde con { status, redirectUrl }.
   */
  static async completeRequest(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { id, signatureBase64, cerBase64 } = req.body as {
      id: string;
      signatureBase64: string;
      cerBase64: string;
    };

    let cerBuffer: Buffer | null = null;

    try {
      // 1. Cargar la solicitud de firma
      const signatureRequest = await prisma.signatureRequest.findUnique({
        where: { id },
      });

      if (!signatureRequest) {
        throw new AppError(
          "La solicitud de firma no existe o el ID es inválido.",
          404,
        );
      }

      if (signatureRequest.status !== "PENDING") {
        throw new AppError(
          `Esta solicitud ya fue procesada (estado: ${signatureRequest.status}).`,
          409,
        );
      }

      if (new Date() > signatureRequest.expiresAt) {
        // Marcar como expirada en BD
        await prisma.signatureRequest.update({
          where: { id },
          data: { status: "EXPIRED" },
        });
        throw new AppError(
          "La sesión de firma ha expirado (TTL: 24 horas). Solicita un nuevo enlace.",
          410,
        );
      }

      // 2. Validar el certificado .cer contra la cadena de confianza del SAT
      cerBuffer = Buffer.from(cerBase64, "base64");
      const certValidation =
        await SatSignatureService.validateCertificate(cerBuffer);

      if (certValidation.resultado === "RECHAZADO") {
        throw new AppError(
          `El certificado fue rechazado: [${certValidation.codigo_estado}] ${certValidation.detalles}`,
          400,
        );
      }

      const { titular_nombre, titular_rfc, numero_serie } =
        certValidation.metadata;

      if (titular_rfc !== signatureRequest.requestedRfc) {
        throw new AppError(
          `El RFC del certificado (${titular_rfc}) no coincide con el RFC solicitado para esta firma (${signatureRequest.requestedRfc}).`,
          400
        );
      }

      // 3. Solicitar sello NOM-151 al PSC (opcional — no bloquea si no está configurado)
      const nom151Stamp = await requestNom151Stamp(
        signatureRequest.documentHash,
        signatureBase64,
      );

      // 4. Actualizar el registro a SIGNED
      const updated = await prisma.signatureRequest.update({
        where: { id },
        data: {
          status: "SIGNED",
          signatureData: signatureBase64,
          nom151Stamp,
          signerName: titular_nombre,
          signerRfc: titular_rfc,
          cerSerialNumber: numero_serie,
        },
      });

      // 4.5. Registrar el documento firmado en la tabla SignedDocument para que aparezca en el historial del cliente
      await prisma.signedDocument.create({
        data: {
          id: updated.id, // Reusamos el mismo ID de la solicitud para consistencia
          clientId: updated.clientId,
          s3Url: updated.documentUrl,
          documentHash: updated.documentHash,
          signatureString: updated.signatureData!,
          signerName: updated.signerName!,
          signerRfc: updated.signerRfc!,
          cadenaOriginal: updated.documentHash,
        },
      });

      // 5. Encolar el webhook para notificar al integrador
      await WebhookDispatcherService.enqueue(updated);

      // 6. Responder al frontend (que hará el redirect)
      res.status(200).json({
        status: "success",
        message: "Documento firmado exitosamente.",
        redirectUrl: signatureRequest.redirectUrl,
        data: {
          signatureRequestId: id,
          signerName: titular_nombre,
          signerRfc: titular_rfc,
          cerSerialNumber: numero_serie,
          nom151Obtained: nom151Stamp !== null,
        },
      });
    } catch (error) {
      return next(error);
    } finally {
      // Limpiar el buffer del certificado de memoria
      if (cerBuffer && Buffer.isBuffer(cerBuffer)) {
        cerBuffer.fill(0);
      }
    }
  }

  /**
   * GET /api/v1/signatures/requests  (requiere API Key)
   *
   * Lista todas las SignatureRequests del cliente autenticado,
   * incluyendo sus WebhookJobs para monitoreo.
   */
  static async listRequests(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "20"))),
      );
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        prisma.signatureRequest.count({ where: { clientId: req.user!.id } }),
        prisma.signatureRequest.findMany({
          where: { clientId: req.user!.id },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            webhookJobs: {
              select: {
                id: true,
                status: true,
                attempts: true,
                lastAttemptAt: true,
                nextRetryAt: true,
                lastResponseCode: true,
                lastResponseBody: true,
              },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
          },
        }),
      ]);

      res.status(200).json({
        status: "success",
        data: items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/signatures/webhooks/retry/:jobId  (requiere API Key)
   *
   * Ejecuta un reintento manual e inmediato de un WebhookJob.
   * Retorna el estado y respuesta de la entrega del webhook.
   */
  static async retryWebhook(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { jobId } = req.params;

      const job = await prisma.webhookJob.findUnique({
        where: { id: jobId },
        include: {
          signatureRequest: {
            select: {
              clientId: true,
            },
          },
        },
      });

      if (!job || job.signatureRequest.clientId !== req.user!.id) {
        throw new AppError(
          "El trabajo de webhook no existe o no pertenece a tu cuenta.",
          404,
        );
      }

      // Ejecutar despacho inmediato del webhook
      const success = await WebhookDispatcherService.dispatch(job);

      // Obtener el job actualizado con las respuestas e intentos más recientes
      const updatedJob = await prisma.webhookJob.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          status: true,
          attempts: true,
          lastAttemptAt: true,
          nextRetryAt: true,
          lastResponseCode: true,
          lastResponseBody: true,
        },
      });

      res.status(200).json({
        status: "success",
        message: success
          ? "El webhook se entregó correctamente."
          : "El intento de webhook falló.",
        data: updatedJob,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/signatures/requests/:id/webhook-url  (requiere API Key)
   *
   * Actualiza la URL del webhook para una SignatureRequest específica.
   * Si hay trabajos de webhook fallidos asociados, los reinicia a PENDING con la nueva URL.
   */
  static async updateWebhookUrl(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.params;
      const { webhookUrl } = req.body as { webhookUrl: string };

      if (!webhookUrl || !webhookUrl.startsWith("http")) {
        throw new AppError(
          "La URL del webhook debe ser una URL HTTP/HTTPS válida.",
          400,
        );
      }

      const signatureRequest = await prisma.signatureRequest.findUnique({
        where: { id },
      });

      if (!signatureRequest || signatureRequest.clientId !== req.user!.id) {
        throw new AppError(
          "La solicitud de firma no existe o no pertenece a tu cuenta.",
          404,
        );
      }

      // 1. Actualizar URL en SignatureRequest
      const updatedRequest = await prisma.signatureRequest.update({
        where: { id },
        data: { webhookUrl },
      });

      // 2. Actualizar y reiniciar WebhookJobs fallidos
      await prisma.webhookJob.updateMany({
        where: {
          signatureRequestId: id,
          status: "FAILED",
        },
        data: {
          url: webhookUrl,
          status: "PENDING",
          attempts: 0,
          nextRetryAt: null,
          lastResponseCode: null,
          lastResponseBody: null,
        },
      });

      res.status(200).json({
        status: "success",
        message:
          "La URL del webhook se ha actualizado y se han reiniciado los envíos fallidos.",
        data: updatedRequest,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/signatures/request/:id/document (público)
   * Deuelve una URL prefirmada temporal para visualizar el documento de la solicitud de firma.
   */
  public static async getRequestDocumentUrl(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.params;

      const request = await prisma.signatureRequest.findUnique({
        where: { id },
        select: { documentUrl: true },
      });

      if (!request) {
        throw new AppError("La solicitud de firma no existe.", 404);
      }

      const presigned = await S3StorageService.getPresignedUrl(
        request.documentUrl,
        300,
      );

      res.status(200).json({
        status: "success",
        url: presigned.url.startsWith("http")
          ? presigned.url
          : `${process.env.API_URL ? process.env.API_URL.replace("/api/v1", "") : "http://localhost:5000"}${presigned.url}`,
      });
    } catch (error) {
      return next(error);
    }
  }
}
