import { Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import { S3StorageService } from '../services/S3StorageService';
import { prisma } from '../config/db';
import { AppError } from '../core/errors/AppError';
import { env } from '../config/env';

export class SignatureController {


  /**
   * Endpoint público para validar/verificar un documento firmado por su ID.
   */
  public static async verifyDocument(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { documentId } = req.params;

      let docData: {
        id: string;
        s3Url: string;
        documentHash: string;
        signatureString: string;
        signerName: string;
        signerRfc: string;
        cadenaOriginal: string;
        clientEmail: string;
        createdAt: Date;
      } | null = null;

      // 1. Intentar buscar en SignedDocument (Flujo Clásico)
      const signedDocument = await prisma.signedDocument.findUnique({
        where: { id: documentId },
        include: {
          client: {
            select: {
              email: true,
            },
          },
        },
      });

      if (signedDocument) {
        docData = {
          id: signedDocument.id,
          s3Url: signedDocument.s3Url,
          documentHash: signedDocument.documentHash,
          signatureString: signedDocument.signatureString,
          signerName: signedDocument.signerName || 'Desconocido',
          signerRfc: signedDocument.signerRfc || 'Desconocido',
          cadenaOriginal: signedDocument.cadenaOriginal || signedDocument.documentHash,
          clientEmail: signedDocument.client.email,
          createdAt: signedDocument.createdAt,
        };
      } else {
        // 2. Intentar buscar en SignatureRequest (Flujo Webhook / Client-Side)
        const signatureRequest = await prisma.signatureRequest.findFirst({
          where: {
            id: documentId,
            status: 'SIGNED',
          },
          include: {
            client: {
              select: {
                email: true,
              },
            },
          },
        });

        if (signatureRequest) {
          docData = {
            id: signatureRequest.id,
            s3Url: signatureRequest.documentUrl,
            documentHash: signatureRequest.documentHash,
            signatureString: signatureRequest.signatureData || '',
            signerName: signatureRequest.signerName || 'Desconocido',
            signerRfc: signatureRequest.signerRfc || 'Desconocido',
            cadenaOriginal: signatureRequest.documentHash, // En flujo webhook se firma el hash directamente
            clientEmail: signatureRequest.client.email,
            createdAt: signatureRequest.createdAt,
          };
        }
      }

      if (!docData) {
        throw new AppError('El documento de firma digital no existe o el ID es inválido.', 404);
      }

      // Obtener el dominio del backend o usar localhost:5001 para el frontend de verificación
      const baseDomain = process.env.FRONTEND_URL || `http://${env.DOMAIN || 'localhost'}:5001`;
      const verificationUrl = `${baseDomain}/verify/${docData.id}`;
      const qrCodeUrl = await QRCode.toDataURL(verificationUrl);
      
      const { url: tempUrl } = await S3StorageService.getPresignedUrl(docData.s3Url, 900);

      res.status(200).json({
        status: 'success',
        data: {
          id: docData.id,
          s3Url: tempUrl,
          documentHash: docData.documentHash,
          signatureString: docData.signatureString,
          signerName: docData.signerName,
          signerRfc: docData.signerRfc,
          cadenaOriginal: docData.cadenaOriginal,
          verificationUrl,
          qrCodeUrl,
          clientEmail: docData.clientEmail,
          createdAt: docData.createdAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
}
