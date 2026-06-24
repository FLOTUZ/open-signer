import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import { prisma } from "../config/db";

const HMAC_SECRET = () => env.JWT_SECRET;

export class S3StorageService {
  private static s3Client: S3Client | null = null;

  private static getS3Client(): S3Client {
    if (!this.s3Client) {
      const config: {
        region?: string;
        credentials?: { accessKeyId: string; secretAccessKey: string };
      } = {};

      if (env.AWS_REGION) {
        config.region = env.AWS_REGION;
      }

      if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
        config.credentials = {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        };
      }

      this.s3Client = new S3Client(config);
    }
    return this.s3Client;
  }

  public static extractKey(url: string): string {
    if (url.startsWith("/uploads/")) {
      return url.replace("/uploads/", "");
    }
    // Para URLs de S3: https://bucket.s3.region.amazonaws.com/key (key puede tener slashes)
    try {
      const parsed = new URL(url);
      // Quitar el primer slash
      return parsed.pathname.substring(1);
    } catch {
      const parts = url.split("/");
      return parts.slice(3).join("/");
    }
  }

  /**
   * Genera una URL temporal para acceder a un documento.
   * - Si S3 está configurado: genera una presigned URL real (expiración configurable).
   * - Si es local: genera un token HMAC con TTL para el endpoint de descarga interno.
   */
  public static async getPresignedUrl(
    s3UrlOrLocalPath: string,
    expiresInSeconds = 900,
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const key = this.extractKey(s3UrlOrLocalPath);

    const isLocal =
      s3UrlOrLocalPath.startsWith("/uploads/") || !env.AWS_S3_BUCKET;

    if (!isLocal) {
      // Modo S3 real: presigned URL nativa de AWS
      const client = this.getS3Client();
      const command = new GetObjectCommand({
        Bucket: env.AWS_S3_BUCKET,
        Key: key,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
      });
      return { url, expiresAt };
    }

    // Modo local: token HMAC temporal firmado internamente
    const secret = HMAC_SECRET();
    if (!secret) {
      throw new Error("JWT_SECRET no está configurado");
    }
    const payload = Buffer.from(
      JSON.stringify({ key, exp: Math.floor(expiresAt.getTime() / 1000) }),
    ).toString("base64url");
    const sig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    const token = `${payload}.${sig}`;
    const url = `/api/v1/documents/local-download?token=${token}`;

    return { url, expiresAt };
  }

  /**
   * Verifica y decodifica un token de descarga local.
   * Devuelve el key del archivo si el token es válido, null si no.
   */
  public static verifyLocalDownloadToken(token: string): string | null {
    try {
      const secret = HMAC_SECRET();
      if (!secret) {
        throw new Error("JWT_SECRET no está configurado");
      }
      const [payload, sig] = token.split(".");
      if (!payload || !sig) return null;

      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("base64url");
      if (sig !== expectedSig) return null;

      const data = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as { key: string; exp: number };
      if (Math.floor(Date.now() / 1000) > data.exp) return null;

      return data.key;
    } catch {
      return null;
    }
  }

  /**
   * Sube un documento al almacenamiento.
   * Si no están configuradas las variables de AWS, realiza un fallback a almacenamiento local.
   */
  public static async uploadDocument(
    fileName: string,
    content: Buffer | string,
    contentType = "application/pdf",
  ): Promise<string> {
    const cleanFileName = `${Date.now()}_${fileName.replace(/\s+/g, "_")}`;
    let resultUrl = "";
    let isS3 = false;

    if (env.AWS_S3_BUCKET) {
      try {
        const client = this.getS3Client();
        const command = new PutObjectCommand({
          Bucket: env.AWS_S3_BUCKET,
          Key: cleanFileName,
          Body: content,
          ContentType: contentType,
        });

        await client.send(command);

        const region = env.AWS_REGION || "us-east-1";
        resultUrl = `https://${env.AWS_S3_BUCKET}.s3.${region}.amazonaws.com/${cleanFileName}`;
        isS3 = true;
      } catch (error) {
        console.error(
          "❌ Error al subir a S3, intentando fallback local...",
          error,
        );
        if (env.NODE_ENV !== "production") {
          resultUrl = await this.uploadLocal(cleanFileName, content);
        } else {
          throw error;
        }
      }
    } else {
      resultUrl = await this.uploadLocal(cleanFileName, content);
    }

    // Registrar auditoría de subida de archivo
    const destination = isS3
      ? `AWS S3 (Bucket: ${env.AWS_S3_BUCKET})`
      : `Almacenamiento Local (Fallback)`;
    await prisma.auditLog
      .create({
        data: {
          method: "POST",
          endpoint: "/services/S3StorageService/uploadDocument",
          originIp: "127.0.0.1",
          role: null,
          username: "Sistema (S3StorageService)",
          description: `Subida de documento exitosa — Archivo original: "${fileName}", Guardado como: "${cleanFileName}" en ${destination}. URL: ${resultUrl}`,
        },
      })
      .catch((err) =>
        console.error("Error creating uploadDocument auditLog:", err),
      );

    return resultUrl;
  }

  private static async uploadLocal(
    fileName: string,
    content: Buffer | string,
  ): Promise<string> {
    const uploadDir = path.resolve(env.LOCAL_STORAGE_PATH);
    await fs.mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, content);
    return `/uploads/${fileName}`;
  }

  /**
   * Sube un archivo a una carpeta específica en el almacenamiento (S3 o fallback local).
   */
  public static async uploadFile(
    fileName: string,
    content: Buffer | string,
    folder: string,
    contentType = "application/octet-stream",
  ): Promise<string> {
    const cleanFileName = `${Date.now()}_${fileName.replace(/\s+/g, "_")}`;
    const key = `${folder}/${cleanFileName}`;
    let resultUrl = "";
    let isS3 = false;

    if (env.AWS_S3_BUCKET) {
      try {
        const client = this.getS3Client();
        const command = new PutObjectCommand({
          Bucket: env.AWS_S3_BUCKET,
          Key: key,
          Body: content,
          ContentType: contentType,
        });

        await client.send(command);

        const region = env.AWS_REGION || "us-east-1";
        resultUrl = `https://${env.AWS_S3_BUCKET}.s3.${region}.amazonaws.com/${key}`;
        isS3 = true;
      } catch (error) {
        console.error(
          `❌ Error al subir a S3 (${key}), intentando fallback local...`,
          error,
        );
        if (env.NODE_ENV !== "production") {
          resultUrl = await this.uploadLocalFile(key, content);
        } else {
          throw error;
        }
      }
    } else {
      resultUrl = await this.uploadLocalFile(key, content);
    }

    // Registrar auditoría de subida de archivo
    const destination = isS3
      ? `AWS S3 (Bucket: ${env.AWS_S3_BUCKET})`
      : `Almacenamiento Local (Fallback)`;
    await prisma.auditLog
      .create({
        data: {
          method: "POST",
          endpoint: `/services/S3StorageService/uploadFile/${folder}`,
          originIp: "127.0.0.1",
          role: null,
          username: "Sistema (S3StorageService)",
          description: `Subida de archivo exitosa — Carpeta: "${folder}", Archivo original: "${fileName}", Guardado como: "${cleanFileName}" en ${destination}. URL: ${resultUrl}`,
        },
      })
      .catch((err) =>
        console.error("Error creating uploadFile auditLog:", err),
      );

    return resultUrl;
  }

  private static async uploadLocalFile(
    key: string,
    content: Buffer | string,
  ): Promise<string> {
    const uploadDir = path.resolve(env.LOCAL_STORAGE_PATH);
    const fullPath = path.join(uploadDir, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    return `/uploads/${key}`;
  }
}
