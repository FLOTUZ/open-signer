import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../config/db";
import { AppError } from "../core/errors/AppError";
import { S3StorageService } from "../services/S3StorageService";

export class ClientController {
  /**
   * Obtiene la lista de API Keys del cliente autenticado.
   */
  public static async getMyApiKeys(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const keys = await prisma.apiKey.findMany({
        where: { clientId: req.user!.id },
        select: {
          id: true,
          status: true,
          createdAt: true,
          name: true,
          logoUrl: true,
        },
        orderBy: { createdAt: "desc" },
      });

      // Generar URLs prefirmadas para cada logo si existe
      const keysWithPresigned = await Promise.all(
        keys.map(async (k) => {
          let resolvedLogoUrl = null;
          if (k.logoUrl) {
            try {
              const presigned = await S3StorageService.getPresignedUrl(k.logoUrl, 3600);
              resolvedLogoUrl = presigned.url;
            } catch (err) {
              console.error("Error generating presigned URL for key logo:", err);
            }
          }
          return {
            ...k,
            logoUrl: resolvedLogoUrl || k.logoUrl,
          };
        })
      );

      res.status(200).json({
        status: "success",
        results: keys.length,
        data: keysWithPresigned,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Genera una nueva API Key para el cliente autenticado.
   */
  public static async createMyApiKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clientId = req.user!.id;

      // Generar API Key aleatoria con prefijo identificador
      const rawApiKey = `opensigner-${crypto.randomBytes(24).toString("hex")}`;
      const hashedKey = crypto
        .createHash("sha256")
        .update(rawApiKey)
        .digest("hex");

      const apiKeyRecord = await prisma.apiKey.create({
        data: {
          hash: hashedKey,
          clientId,
          status: "ACTIVE",
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        status: "success",
        message:
          "API Key generada con éxito. Guarde esta clave, no podrá volver a verla.",
        data: {
          id: apiKeyRecord.id,
          apiKey: rawApiKey, // Entregada en texto plano sólo en la creación
          status: apiKeyRecord.status,
          createdAt: apiKeyRecord.createdAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Elimina (revoca) una API Key del cliente autenticado.
   */
  public static async deleteMyApiKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { keyId } = req.params;
      const clientId = req.user!.id;

      // Verificar que la API Key pertenece al cliente autenticado
      const existing = await prisma.apiKey.findFirst({
        where: { id: keyId, clientId },
      });

      if (!existing) {
        throw new AppError(
          "API Key no encontrada o no pertenece a tu cuenta.",
          404,
        );
      }

      await prisma.apiKey.delete({ where: { id: keyId } });

      res.status(200).json({
        status: "success",
        message: "API Key eliminada con éxito.",
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Obtiene la lista de documentos firmados del cliente autenticado.
   */
  public static async getMyDocuments(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const documents = await prisma.signedDocument.findMany({
        where: { clientId: req.user!.id },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({
        status: "success",
        results: documents.length,
        data: documents,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Genera un par de certificado (.cer) y llave privada (.key) de PRUEBA.
   * Usa openssl para crear un X.509 auto-firmado en formato DER (compatible con SatSignatureService).
   */
  public static async generateTestCertificates(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { execSync } = await import("child_process");
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opensigner-test-"));
    const keyPem = path.join(tmpDir, "key.pem");
    const certDer = path.join(tmpDir, "cert.cer");
    const keyDer = path.join(tmpDir, "key.key");
    const testPassword = "12345678a";

    try {
      // 1. Generar llave privada RSA 2048 sin cifrado (PEM temporal)
      execSync(`openssl genrsa -out ${keyPem} 2048`, { stdio: "ignore" });

      // 2. Generar certificado X.509 auto-firmado en formato DER (válido por 365 días)
      execSync(
        `openssl req -new -x509 -key ${keyPem} -out ${certDer} -outform DER -days 365 -subj "/CN=JUAN PEREZ LOPEZ/serialNumber=PELJ800101XYZ/O=Open Signer Test/C=MX"`,
        { stdio: "ignore" },
      );

      // 3. Convertir la llave privada a PKCS#8 DER encriptada con AES-256-CBC
      execSync(
        `openssl pkcs8 -topk8 -inform PEM -in ${keyPem} -outform DER -out ${keyDer} -v2 aes-256-cbc -passout pass:${testPassword}`,
        { stdio: "ignore" },
      );

      // 4. Leer archivos generados y codificar en base64
      const certBuffer = fs.readFileSync(certDer);
      const keyBuffer = fs.readFileSync(keyDer);

      res.status(200).json({
        status: "success",
        message:
          "Certificados de prueba generados. NOTA: Estos NO son válidos para el SAT real.",
        data: {
          certificate: {
            base64: certBuffer.toString("base64"),
            filename: "test_certificate.cer",
          },
          privateKey: {
            base64: keyBuffer.toString("base64"),
            filename: "test_private_key.key",
          },
          password: testPassword,
        },
      });
    } catch (error) {
      return next(error);
    } finally {
      // 5. Limpiar archivos temporales
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  /**
   * Actualiza el branding (nombre descriptivo y/o logo) de una API Key específica.
   */
  public static async updateApiKeyBranding(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { keyId } = req.params;
      const clientId = req.user!.id;
      const name = req.body.name;
      const file = req.file;

      // 1. Verificar propiedad de la API Key
      const existing = await prisma.apiKey.findFirst({
        where: { id: keyId, clientId },
      });

      if (!existing) {
        throw new AppError("API Key no encontrada o no pertenece a tu cuenta.", 404);
      }

      // 2. Preparar los datos a actualizar
      const dataToUpdate: { name?: string; logoUrl?: string } = {};

      if (name !== undefined) {
        dataToUpdate.name = name.trim();
      }

      if (file) {
        const logoUrl = await S3StorageService.uploadFile(
          file.originalname,
          file.buffer,
          "client-logos",
          file.mimetype,
        );
        dataToUpdate.logoUrl = logoUrl;
      }

      if (Object.keys(dataToUpdate).length === 0) {
        throw new AppError("Debes proporcionar al menos un nombre o una imagen de logo para actualizar.", 400);
      }

      // 3. Actualizar en la base de datos
      const updatedApiKey = await prisma.apiKey.update({
        where: { id: keyId },
        data: dataToUpdate,
        select: {
          id: true,
          status: true,
          createdAt: true,
          name: true,
          logoUrl: true,
        },
      });

      // Generar URL prefirmada para el logo si se actualizó/existe
      let resolvedLogoUrl = null;
      if (updatedApiKey.logoUrl) {
        try {
          const presigned = await S3StorageService.getPresignedUrl(updatedApiKey.logoUrl, 3600);
          resolvedLogoUrl = presigned.url;
        } catch (err) {
          console.error("Error generating presigned URL for updated key logo:", err);
        }
      }

      res.status(200).json({
        status: "success",
        message: "Branding de la API Key actualizado con éxito.",
        data: {
          ...updatedApiKey,
          logoUrl: resolvedLogoUrl || updatedApiKey.logoUrl,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
}
