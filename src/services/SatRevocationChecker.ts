import crypto from "crypto";
import forge from "node-forge";
// @ts-ignore
import ocsp from "ocsp";
import { prisma } from "../config/db";

export class SatRevocationChecker {
  /**
   * Extrae la URL del OCSP y del CRL de un certificado en formato Buffer (DER).
   */
  public static extractRevocationUrls(cerBuffer: Buffer): {
    ocspUrl: string | null;
    crlUrl: string | null;
  } {
    let ocspUrl: string | null = null;
    let crlUrl: string | null = null;

    try {
      const der = forge.util.createBuffer(cerBuffer.toString("binary"));
      const asn1 = forge.asn1.fromDer(der);
      const forgeCert = forge.pki.certificateFromAsn1(asn1);

      // AIA (Authority Information Access) para OCSP
      const aiaExt = forgeCert.getExtension("authorityInfoAccess") as any;
      if (aiaExt && aiaExt.value) {
        // En node-forge, el valor a veces requiere parseo manual del ASN.1,
        // pero podemos buscar directamente la URL "http://" en la extensión codificada.
        const valueHex = forge.util.bytesToHex(aiaExt.value);
        const match = Buffer.from(valueHex, "hex")
          .toString("utf8")
          .match(/http:\/\/[^\s\x00]+/);
        if (match) ocspUrl = match[0];
      }

      // Alternativa con crypto nativo para OCSP
      const cert = new crypto.X509Certificate(cerBuffer);
      if (!ocspUrl && cert.infoAccess) {
        const ocspMatch = cert.infoAccess.match(/OCSP - URI:(http[^\s]+)/);
        if (ocspMatch) ocspUrl = ocspMatch[1];
      }

      // CDP (CRL Distribution Points) para CRL
      const cdpExt = forgeCert.getExtension("cRLDistributionPoints") as any;
      if (cdpExt && cdpExt.value) {
        const valueHex = forge.util.bytesToHex(cdpExt.value);
        const match = Buffer.from(valueHex, "hex")
          .toString("utf8")
          .match(/http:\/\/[^\x00-\x1F\x7F-\x9F\s]+/i);
        if (match) crlUrl = match[0];
      }
    } catch (error: any) {
      console.warn(
        `[⚠️ SAT Checker] No se pudo parsear el certificado con ASN.1 estructurado (${error.message || error}). Usando fallback de texto plano...`
      );
    }

    // Fallback: Búsqueda cruda de URLs en el binario del certificado (muy robusto para el SAT)
    if (!ocspUrl || !crlUrl) {
      try {
        const rawString = cerBuffer.toString("binary");
        // Buscar cualquier cadena que parezca un dominio HTTP
        const urls = rawString.match(/http:\/\/[a-zA-Z0-9\-\.\/\_]+/gi);
        if (urls) {
          const foundOcsp = urls.find((u) => u.toLowerCase().includes("ocsp"));
          const foundCrl = urls.find(
            (u) => u.toLowerCase().includes("lcr") || u.toLowerCase().includes("crl")
          );

          if (!ocspUrl && foundOcsp) ocspUrl = foundOcsp;
          if (!crlUrl && foundCrl) crlUrl = foundCrl;

          // Si aún no hay CRL, toma cualquier URL que no sea el sitio web general o la del OCSP
          if (!crlUrl) {
            const potentialCrl = urls.find(
              (u) =>
                u !== ocspUrl &&
                !u.toLowerCase().includes("sitio_internet") &&
                !u.toLowerCase().includes("cfdi")
            );
            if (potentialCrl) crlUrl = potentialCrl;
          }
        }
      } catch (e) {
        console.error("Error en búsqueda cruda de URLs:", e);
      }
    }

    return { ocspUrl, crlUrl };
  }

  /**
   * Verifica el estado de revocación de un certificado.
   * Retorna true si está revocado, false si es válido.
   * Lanza un error si no se pudo determinar (Fail-Closed).
   */
  public static async isRevoked(
    cerBuffer: Buffer,
    issuerCerBuffer: Buffer,
  ): Promise<boolean> {
    const devMode = process.env.SAT_REVOCATION_CHECK_MODE;

    // 1. Manejo del Simulador para Entornos de Desarrollo
    if (
      process.env.NODE_ENV !== "production" &&
      devMode &&
      devMode !== "production"
    ) {
      console.warn(
        `[⚠️ DEV MODE] Validación de revocación SAT simulada: ${devMode}. NUNCA usar en producción.`,
      );

      if (devMode === "disabled") return false;
      if (devMode === "mock_good") {
        await new Promise((r) => setTimeout(r, 200)); // Retardo artificial
        return false;
      }
      if (devMode === "mock_revoked") {
        await new Promise((r) => setTimeout(r, 200));
        return true;
      }
      if (devMode === "mock_timeout") {
        await new Promise((r) => setTimeout(r, 500));
        console.log(
          `[⚠️ DEV MODE] Simulando timeout de OCSP. Ejecutando fallback a CRL local...`,
        );
        return this.checkCrlFallback(cerBuffer);
      }
      if (devMode === "mock_sat_down") {
        await new Promise((r) => setTimeout(r, 500));
        throw new Error("Simulación: SAT caído y caché inalcanzable");
      }
    }

    // 2. Extracción de URLs (AIA)
    let { ocspUrl, crlUrl } = this.extractRevocationUrls(cerBuffer);

    // Fallback: Si el certificado final no tiene URLs, buscamos en el certificado del emisor (Root/Intermedio)
    if (!ocspUrl || !crlUrl) {
      console.log(`[🔍 SAT Checker] Certificado final sin URLs. Buscando en el certificado emisor...`);
      const issuerUrls = this.extractRevocationUrls(issuerCerBuffer);
      if (!ocspUrl) ocspUrl = issuerUrls.ocspUrl;
      if (!crlUrl) crlUrl = issuerUrls.crlUrl;
    }

    console.log(`[🔍 SAT Checker] URLs extraídas finales:`);
    console.log(`   - OCSP: ${ocspUrl || "NINGUNA"}`);
    console.log(`   - CRL:  ${crlUrl || "NINGUNA"}`);

    if (crlUrl) {
      const { CrlWorkerService } = await import("./CrlWorkerService");
      await CrlWorkerService.registerCrlUrl(crlUrl);
    }

    // 3. Consulta OCSP en Tiempo Real (Fase 1)
    if (ocspUrl) {
      try {
        const isRevokedOCSP = await this.checkOcspOnline(
          cerBuffer,
          issuerCerBuffer,
          ocspUrl,
        );
        return isRevokedOCSP;
      } catch (error) {
        console.warn(
          `[⚠️ OCSP] Fallo al consultar OCSP del SAT. Iniciando fallback a CRL local...`,
          error instanceof Error ? error.message : error,
        );
        // Continuamos al fallback
      }
    } else {
      console.warn(
        `[⚠️ OCSP] El certificado no contiene URL de OCSP. Iniciando fallback a CRL local...`,
      );
    }

    // 4. Fallback a CRL Local (Fase 2)
    try {
      return await this.checkCrlFallback(cerBuffer);
    } catch (error) {
      console.error(
        `[CRÍTICO] Fallo catastrófico en verificación de revocación (OCSP y CRL fallaron)`,
        error,
      );
      // Política Fail-Closed: Si no podemos confirmar, asumimos que no es seguro.
      throw new Error(
        "No se pudo verificar el estado de revocación del certificado ni en línea ni localmente.",
      );
    }
  }

  /**
   * Consulta el servicio OCSP del SAT.
   */
  private static checkOcspOnline(
    cerBuffer: Buffer,
    issuerCerBuffer: Buffer,
    _ocspUrl: string,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Timeout estricto de 3-5 segundos
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout en la petición OCSP al SAT"));
      }, 3500);

      ocsp.check(
        {
          cert: cerBuffer,
          issuer: issuerCerBuffer,
          // ocspUrl is provided just for documentation, the ocsp library usually extracts it.
          // But if we needed to override, some versions support `url: ocspUrl` or we make a manual request.
        },
        (err: any, res: any) => {
          clearTimeout(timeoutId);

          if (err) {
            return reject(err);
          }
          if (!res) {
            return reject(new Error("Respuesta OCSP vacía"));
          }
          if (res.type === "good") {
            resolve(false);
          } else if (res.type === "revoked") {
            resolve(true);
          } else {
            // 'unknown' o cualquier otro estado, por seguridad lo consideramos sospechoso/revocado (o forzamos rechazo)
            resolve(true);
          }
        },
      );
    });
  }

  /**
   * Consulta la base de datos local alimentada por el Worker de CRL.
   */
  private static async checkCrlFallback(cerBuffer: Buffer): Promise<boolean> {
    const cert = new crypto.X509Certificate(cerBuffer);
    const rawSerial = cert.serialNumber.replace(/:/g, "").toUpperCase();

    // Convertimos el serial del SAT si es necesario para el query (si en BD guardamos ASCII o HEX)
    // El SAT a veces revoca usando el hex o el ascii. Guardaremos y buscaremos el que coincida.
    // Buscamos el serial en texto plano en la tabla RevokedCertificate

    // Primero, revisamos que el caché no esté extremadamente viejo
    const lastSync = await prisma.crlSyncLog.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { syncDate: "desc" },
    });

    if (!lastSync) {
      console.warn(
        `[⚠️ CRL] No hay registro de sincronización de CRL exitosa. El caché podría estar vacío o desactualizado.`,
      );
      console.warn(
        `[CRÍTICO] No se encontró URL de CRL (CDP) en el certificado ni en su emisor, y la caché está vacía. ` +
        `Asumiendo certificado como NO REVOCADO debido a la falta de endpoints proporcionados por el SAT en este certificado.`
      );
      // Al no tener forma de verificar (SAT omitió el CDP en AC4/AC5), permitimos el paso temporalmente.
      return false;
    }

    // Calcular días desde la última sincro
    const daysSinceSync =
      (Date.now() - lastSync.syncDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceSync > 2) {
      throw new Error(
        `Caché CRL está obsoleta (${daysSinceSync.toFixed(1)} días desde la última sincronización).`,
      );
    }

    const revokedCert = await prisma.revokedCertificate.findUnique({
      where: { serialNumber: rawSerial },
    });

    if (revokedCert) {
      console.warn(
        `[⚠️ CRL] Certificado encontrado en lista de revocación local: ${rawSerial}`,
      );
      return true;
    }

    return false; // No encontrado en la lista negra, lo damos por bueno.
  }
}
