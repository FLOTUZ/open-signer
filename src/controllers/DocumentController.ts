import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../config/db';
import { AppError } from '../core/errors/AppError';
import { S3StorageService } from '../services/S3StorageService';
import { env } from '../config/env';

export class DocumentController {
  /**
   * Genera una URL temporal para descargar un documento firmado.
   * Autenticado mediante API Key.
   * La URL expira en 15 minutos.
   */
  public static async getDocumentDownloadUrl(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { documentId } = req.params;
      const clientId = req.user!.id;
      const type = req.query.type as string;

      const doc = await prisma.signedDocument.findFirst({
        where: { id: documentId, clientId },
      });

      if (!doc) {
        throw new AppError('Documento no encontrado o no pertenece a tu cuenta.', 404);
      }

      const fileUrl = (type === 'stamped' && doc.stampedS3Url) ? doc.stampedS3Url : doc.s3Url;
      const { url, expiresAt } = await S3StorageService.getPresignedUrl(fileUrl, 900);

      res.status(200).json({
        status: 'success',
        data: {
          documentId: doc.id,
          url,
          expiresAt,
          note: 'Esta URL expira en 15 minutos. Genera una nueva URL cuando necesites acceder al documento.',
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Sirve un archivo local usando un token temporal firmado internamente.
   * Solo se usa cuando NO hay S3 configurado (entorno de desarrollo).
   */
  public static async serveLocalDocument(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const token = req.query.token as string;

      if (!token) {
        throw new AppError('Token de descarga requerido.', 400);
      }

      const key = S3StorageService.verifyLocalDownloadToken(token);
      if (!key) {
        throw new AppError('Token inválido o expirado. Genera una nueva URL de descarga.', 401);
      }

      const filePath = path.resolve(env.LOCAL_STORAGE_PATH, key);

      try {
        await fs.access(filePath);
      } catch {
        throw new AppError('El archivo no existe en el servidor.', 404);
      }

      res.download(filePath, key);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Lista todos los documentos firmados del cliente autenticado.
   * Autenticado mediante API Key (uso programático externo).
   */
  public static async getDocumentsByApiKey(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const clientId = req.user!.id;

      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
      const skip = (page - 1) * limit;

      const [documents, total] = await Promise.all([
        prisma.signedDocument.findMany({
          where: { clientId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            documentHash: true,
            signatureString: true,
            signerName: true,
            signerRfc: true,
            cadenaOriginal: true,
            stampedS3Url: true,
            createdAt: true,
          },
        }),
        prisma.signedDocument.count({ where: { clientId } }),
      ]);

      res.status(200).json({
        status: 'success',
        data: documents,
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
   * Recibe y almacena el documento "estampado" (copia sellada) del cliente.
   * Autenticado mediante API Key.
   * El campo `stamped` en el formulario multipart debe contener el archivo.
   */
  public static async uploadStampedDocument(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const file = req.file;

    try {
      const { documentId } = req.params;
      const clientId = req.user!.id;

      if (!file) {
        throw new AppError('Es obligatorio enviar el archivo estampado en el campo "stamped".', 400);
      }

      const doc = await prisma.signedDocument.findFirst({
        where: { id: documentId, clientId },
      });

      if (!doc) {
        throw new AppError('Documento no encontrado o no pertenece a tu cuenta.', 404);
      }

      const stampedS3Url = await S3StorageService.uploadDocument(
        `stamped_${file.originalname}`,
        file.buffer,
        file.mimetype
      );

      const updated = await prisma.signedDocument.update({
        where: { id: documentId },
        data: { stampedS3Url },
        select: {
          id: true,
          stampedS3Url: true,
          createdAt: true,
        },
      });

      res.status(200).json({
        status: 'success',
        message: 'Documento estampado almacenado correctamente.',
        data: updated,
      });
    } catch (error) {
      return next(error);
    } finally {
      if (file?.buffer) file.buffer.fill(0);
    }
  }
}
