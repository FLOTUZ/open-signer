import crypto from "crypto";

// --- Tipos para la validación defensiva de certificados ---

export interface CertValidationAprobado {
  resultado: "APROBADO";
  codigo_estado: "VALIDACION_EXITOSA";
  metadata: {
    titular_nombre: string;
    titular_rfc: string;
    titular_curp: string | null;
    numero_serie: string;
    valido_hasta: string;
    revocacion_verificada_via: "OCSP_ONLINE" | "CRL_CACHE_FALLBACK" | "MOCK_DEV" | "SKIPPED_DEV";
    fecha_verificacion: string;
  };
}

export interface CertValidationRechazado {
  resultado: "RECHAZADO";
  codigo_estado:
    | "ERROR_EMISOR_NO_AUTORIZADO"
    | "ERROR_CERTIFICADO_EXPIRADO"
    | "ERROR_CERTIFICADO_NO_VIGENTE_AUN"
    | "ERROR_ESTRUCTURA_CORRUPTA"
    | "ERROR_CERTIFICADO_REVOCADO"
    | "ERROR_VERIFICACION_REVOCACION_FALLIDA";
  detalles: string;
}

export type CertificateValidationResult =
  | CertValidationAprobado
  | CertValidationRechazado;

import { SatRevocationChecker } from "./SatRevocationChecker";

export class SatSignatureService {
  // Almacén en memoria de los certificados de confianza (Raíces e Intermedios del SAT)
  private static trustedRoots: crypto.X509Certificate[] = [];
  private static trustedRootBuffers: Buffer[] = [];

  /**
   * Inicializa las autoridades de confianza del SAT.
   * Debes descomprimir tu archivo .zip y pasar los Buffers de los archivos .cer aquí
   * al arrancar tu aplicación (ej. en tu archivo index.ts o server.ts).
   */
  public static initTrustedRoots(rootBuffers: Buffer[]): void {
    this.trustedRootBuffers = rootBuffers;
    this.trustedRoots = rootBuffers.map((buf, index) => {
      try {
        return new crypto.X509Certificate(buf);
      } catch (error) {
        throw new Error(
          `Error crítico: El certificado raíz en el índice ${index} no es un X.509 válido.`,
        );
      }
    });
  }

  /**
   * Converte el número de serie hexadecimal del certificado X.509 al formato ASCII de 20 dígitos del SAT.
   * En el SAT, el número de serie se codifica como el valor hexadecimal de los caracteres ASCII correspondientes.
   */
  private static parseSatSerialNumber(hex: string): string {
    const cleanHex = hex.replace(/:/g, "").trim();
    let asciiStr = "";
    for (let i = 0; i < cleanHex.length; i += 2) {
      const code = parseInt(cleanHex.substring(i, i + 2), 16);
      if (!isNaN(code) && code >= 32 && code <= 126) {
        asciiStr += String.fromCharCode(code);
      }
    }
    return asciiStr;
  }

  /**
   * Extrae el nombre del firmante y su RFC desde el string de subject del certificado X.509.
   */
  public static parseSubjectFields(subjectStr: string): {
    name: string;
    rfc: string;
  } {
    let name = "Desconocido";
    let rfc = "Desconocido";
    const parts = subjectStr.split(/[\n,;]+/).map((p) => p.trim());
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      const key = part.substring(0, eqIdx).trim().toUpperCase();
      const val = part.substring(eqIdx + 1).trim();

      if (key === "CN") {
        name = val;
      } else if (
        key === "OID.2.5.4.45" ||
        key === "2.5.4.45" ||
        key === "X500UNIQUEIDENTIFIER" ||
        key === "SERIALNUMBER" ||
        key === "UNIQUEIDENTIFIER"
      ) {
        rfc = val;
      }
    }

    if (rfc === "Desconocido") {
      const rfcRegex = /[A-Z&Ñ]{3,4}\d{6}[A-Z\d]{3}/i;
      const match = subjectStr.match(rfcRegex);
      if (match) {
        rfc = match[0].toUpperCase();
      }
    }
    return { name, rfc };
  }
  /**
   * Extrae el CURP desde el string de subject del certificado X.509.
   * El CURP puede estar en OID.2.5.4.5 o en la etiqueta CURP.
   */
  private static parseCurpFromSubject(subjectStr: string): string | null {
    const parts = subjectStr.split(/[\n,;]+/).map((p) => p.trim());
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      const key = part.substring(0, eqIdx).trim().toUpperCase();
      const val = part.substring(eqIdx + 1).trim();
      if (key === "OID.2.5.4.5" || key === "2.5.4.5" || key === "CURP") {
        return val || null;
      }
    }
    const curpRegex = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]{2}\b/i;
    const match = subjectStr.match(curpRegex);
    return match ? match[0].toUpperCase() : null;
  }
  /**
   * Valida un certificado X.509 (e.firma del SAT) utilizando criptografía asimétrica.
   * Aplica 3 reglas en cascada: Emisor → Vigencia → Identidad.
   * Retorna un resultado binario APROBADO / RECHAZADO.
   */
  public static async validateCertificate(
    cerBuffer: Buffer,
  ): Promise<CertificateValidationResult> {
    try {
      let cert: crypto.X509Certificate;
      try {
        cert = new crypto.X509Certificate(cerBuffer);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          resultado: "RECHAZADO",
          codigo_estado: "ERROR_ESTRUCTURA_CORRUPTA",
          detalles: `El archivo .cer no es un certificado X.509 válido o está corrompido: ${msg}`,
        };
      }

      // ─── REGLA 1: Validación Criptográfica de la Cadena de Confianza ───
      if (this.trustedRoots.length === 0) {
        return {
          resultado: "RECHAZADO",
          codigo_estado: "ERROR_EMISOR_NO_AUTORIZADO",
          detalles:
            "Fallo de configuración interna: No se han cargado las llaves públicas raíz del SAT en el servidor.",
        };
      }

      let esCertificadoValidoDelSat = false;
      let emisorBuffer: Buffer | null = null;

      // Iteramos sobre las autoridades raíz/intermedias cargadas de forma segura en el servidor
      for (let i = 0; i < this.trustedRoots.length; i++) {
        const trustedRoot = this.trustedRoots[i];
        // 1. Verificación rápida: ¿Este trustedRoot es el emisor declarado de cert?
        if (cert.checkIssued(trustedRoot)) {
          // 2. Verificación profunda: Comprobar criptográficamente la firma
          if (cert.verify(trustedRoot.publicKey)) {
            esCertificadoValidoDelSat = true;
            emisorBuffer = this.trustedRootBuffers[i];
            break;
          }
        }
      }

      // Flexibilidad SOLO para desarrollo y pruebas (nunca en producción):
      const subjectStr = cert.subject || "";
      const issuerStr = cert.issuer || "";
      const esDesarrollo = process.env.NODE_ENV !== "production";

      if (!esCertificadoValidoDelSat && esDesarrollo) {
        // 1. Permitimos certificados de prueba autogenerados por Open Signer (auto-firmados)
        const esPruebaOpenSigner =
          subjectStr.includes("Open Signer") ||
          issuerStr.includes("Open Signer");
        const esPruebaSat =
          issuerStr.toUpperCase().includes("PRUEBAS") ||
          issuerStr.toUpperCase().includes("TEST");

        if (esPruebaOpenSigner || esPruebaSat) {
          esCertificadoValidoDelSat = true;
          console.log(
            `[🔒 CRIPTO] [DEV ONLY] Certificado de pruebas aceptado (Open Signer/SAT Test): ${subjectStr}`,
          );
        } else {
          // 2. Cualquier certificado válido estructuralmente, fuera de producción
          esCertificadoValidoDelSat = true;
          console.warn(
            `[⚠️  CRIPTO] [DEV ONLY] Omitiendo verificación estricta de emisor del SAT para: ${subjectStr}`,
          );
        }
      }

      if (!esCertificadoValidoDelSat) {
        return {
          resultado: "RECHAZADO",
          codigo_estado: "ERROR_EMISOR_NO_AUTORIZADO",
          detalles: `El certificado falló la verificación criptográfica. La firma digital del emisor no corresponde a ninguna Autoridad Certificadora legítima del SAT. Posible certificado apócrifo/falso.`,
        };
      }

      // ─── REGLA 2: Validación Temporal ────────────────────────────────────────
      const now = new Date();
      const validFromDate = new Date(cert.validFrom);
      const validToDate = new Date(cert.validTo);

      if (now < validFromDate) {
        return {
          resultado: "RECHAZADO",
          codigo_estado: "ERROR_CERTIFICADO_NO_VIGENTE_AUN",
          detalles: `El certificado aún no entra en vigor. Fecha de inicio de vigencia: ${validFromDate.toISOString()}`,
        };
      }

      if (now > validToDate) {
        return {
          resultado: "RECHAZADO",
          codigo_estado: "ERROR_CERTIFICADO_EXPIRADO",
          detalles: `El certificado expiró el ${validToDate.toISOString()}. Han transcurrido ${Math.floor((now.getTime() - validToDate.getTime()) / 86400000)} días desde su vencimiento.`,
        };
      }

      // ─── REGLA 3: Extracción de Identidad ────────────────────────────────────
      if (!subjectStr) {
        return {
          resultado: "RECHAZADO",
          codigo_estado: "ERROR_ESTRUCTURA_CORRUPTA",
          detalles:
            "El campo Subject del certificado está vacío o no es parseable.",
        };
      }

      const { name: titularNombre, rfc: titularRfc } =
        this.parseSubjectFields(subjectStr);
      const titularCurp = this.parseCurpFromSubject(subjectStr);

      if (titularNombre === "Desconocido" || titularRfc === "Desconocido") {
        const camposFaltantes = [
          titularNombre === "Desconocido" ? "CN (Nombre/Razón Social)" : null,
          titularRfc === "Desconocido" ? "RFC (OID.2.5.4.45)" : null,
        ]
          .filter(Boolean)
          .join(" y ");

        return {
          resultado: "RECHAZADO",
          codigo_estado: "ERROR_ESTRUCTURA_CORRUPTA",
          detalles: `No se pudo extraer el/los campo(s) crítico(s): ${camposFaltantes}.`,
        };
      }

      const numeroSerie = this.parseSatSerialNumber(cert.serialNumber);

      // ─── REGLA 4: Verificación de Revocación (OCSP / CRL) ───
      let verificadaVia: CertValidationAprobado["metadata"]["revocacion_verificada_via"] = "OCSP_ONLINE";
      
      if (!esDesarrollo || (process.env.SAT_REVOCATION_CHECK_MODE && process.env.SAT_REVOCATION_CHECK_MODE !== 'disabled')) {
        try {
          // Si no encontramos el emisor real (ej. certificado de desarrollo saltado), pasamos el mismo certificado como fallback para evitar crashes.
          const bufferToPass = emisorBuffer || cerBuffer;
          const isRevoked = await SatRevocationChecker.isRevoked(cerBuffer, bufferToPass);
          
          if (isRevoked) {
            return {
              resultado: "RECHAZADO",
              codigo_estado: "ERROR_CERTIFICADO_REVOCADO",
              detalles: "El certificado ha sido revocado por el emisor (SAT) y ya no es válido para firmar.",
            };
          }
          
          if (esDesarrollo && process.env.SAT_REVOCATION_CHECK_MODE?.startsWith('mock_')) {
            verificadaVia = "MOCK_DEV";
          }
        } catch (error) {
          console.error("[CRÍTICO] Error conectando con el servicio de revocación del SAT", error);
          return {
            resultado: "RECHAZADO",
            codigo_estado: "ERROR_VERIFICACION_REVOCACION_FALLIDA",
            detalles: "No se pudo verificar el estado de revocación en tiempo real con el SAT ni en la caché local.",
          };
        }
      } else {
        verificadaVia = "SKIPPED_DEV";
      }

      return {
        resultado: "APROBADO",
        codigo_estado: "VALIDACION_EXITOSA",
        metadata: {
          titular_nombre: titularNombre,
          titular_rfc: titularRfc,
          titular_curp: titularCurp,
          numero_serie: numeroSerie || cert.serialNumber,
          valido_hasta: validToDate.toISOString(),
          revocacion_verificada_via: verificadaVia,
          fecha_verificacion: new Date().toISOString(),
        },
      };
    } finally {
      // Garantizar destrucción de datos sensibles en memoria
      if (cerBuffer && Buffer.isBuffer(cerBuffer)) {
        cerBuffer.fill(0);
      }
    }
  }
}
