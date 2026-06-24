import crypto from "crypto";
import { env } from "../config/env";

export interface TokenPayload {
  userId: string;
  email: string;
  role: "SUPER_ADMIN" | "CLIENT";
  exp: number;
}

export class TokenService {
  // Use a secret key from environment or a fallback for development
  private static readonly SECRET =
    env.AWS_SECRET_ACCESS_KEY ||
    "opensigner-local-fallback-token-secret-key-98765";

  /**
   * Genera un token firmado con HMAC-SHA256 y serializado en base64url.
   */
  public static generateToken(
    payload: Omit<TokenPayload, "exp">,
    expiresInHours = 24,
  ): string {
    const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
    const fullPayload: TokenPayload = { ...payload, exp };

    const serializedPayload = JSON.stringify(fullPayload);
    const payloadBase64 = Buffer.from(serializedPayload).toString("base64url");

    // Firmar la carga útil con HMAC-SHA256
    const signature = crypto
      .createHmac("sha256", this.SECRET)
      .update(payloadBase64)
      .digest("base64url");

    return `${payloadBase64}.${signature}`;
  }

  /**
   * Verifica el token de forma criptográfica y devuelve el payload si es válido y no ha expirado.
   */
  public static verifyToken(token: string): TokenPayload | null {
    try {
      const [payloadBase64, signature] = token.split(".");
      if (!payloadBase64 || !signature) {
        return null;
      }

      // Re-calcular firma para validación
      const expectedSignature = crypto
        .createHmac("sha256", this.SECRET)
        .update(payloadBase64)
        .digest("base64url");

      if (signature !== expectedSignature) {
        return null; // Firma inválida (token manipulado)
      }

      // Decodificar y parsear la carga útil
      const serializedPayload = Buffer.from(
        payloadBase64,
        "base64url",
      ).toString("utf8");
      const payload = JSON.parse(serializedPayload) as TokenPayload;

      // Verificar expiración
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp < nowSeconds) {
        return null; // Token expirado
      }

      return payload;
    } catch {
      return null;
    }
  }
}
