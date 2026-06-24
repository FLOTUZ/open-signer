import { Request, Response, NextFunction } from 'express';
import { SatSignatureService } from '../services/SatSignatureService';
import { CrlWorkerService } from '../services/CrlWorkerService';
import { AppError } from '../core/errors/AppError';

export class CertificateController {
  /**
   * POST /api/v1/certificates/validate
   *
   * Recibe un archivo .cer (certificado X.509 e.firma SAT) vía multipart/form-data
   * y aplica las tres reglas de validación defensiva en cascada:
   *   1. Autenticidad del emisor (SAT)
   *   2. Vigencia temporal (notBefore / notAfter)
   *   3. Extracción de identidad del Subject (CN, RFC, CURP)
   *
   * Retorna JSON binario: APROBADO (200) o RECHAZADO (422).
   */
  public static async validateCertificate(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const certFile = req.file;

    if (!certFile) {
      return next(
        new AppError(
          'Se requiere el archivo del certificado (.cer) en el campo "certificado".',
          400
        )
      );
    }

    // Clonar el buffer antes de pasarlo al servicio, porque validateCertificate()
    // hace fill(0) en el finally para garantizar cero retención en memoria.
    const cerBuffer = Buffer.from(certFile.buffer);

    try {
      const resultado = await SatSignatureService.validateCertificate(cerBuffer);

      // APROBADO → 200 OK | RECHAZADO → 422 Unprocessable Entity
      const statusCode = resultado.resultado === 'APROBADO' ? 200 : 422;

      res.status(statusCode).json(resultado);
    } catch (error) {
      return next(error);
    } finally {
      // Limpiar el buffer original de multer como capa defensiva adicional
      if (certFile?.buffer && Buffer.isBuffer(certFile.buffer)) {
        certFile.buffer.fill(0);
      }
    }
  }

  /**
   * POST /api/v1/certificates/crl/sync
   *
   * Sincroniza manualmente una lista CRL (para uso del panel de administración).
   * Requiere enviar { "url": "http://..." } en el body.
   */
  public static async syncCrl(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { url } = req.body;

      if (!url || !url.startsWith('http')) {
        throw new AppError('Se requiere una URL válida de CRL.', 400);
      }

      await CrlWorkerService.syncUrl(url);

      res.status(200).json({
        status: 'success',
        message: 'Lista CRL sincronizada exitosamente.',
      });
    } catch (error) {
      return next(error);
    }
  }
}
