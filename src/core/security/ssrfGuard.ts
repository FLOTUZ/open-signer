import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Valida que una URL sea HTTP/HTTPS y que su host no resuelva a una dirección
 * IP privada, de loopback o de metadatos de nube (p. ej. 169.254.169.254).
 *
 * Se usa antes de hacer peticiones salientes (fetch/OCSP) a URLs de OCSP/CRL
 * extraídas de certificados X.509, que pueden ser enviados por usuarios no
 * autenticados (endpoints públicos de validación/firma). Sin esta validación,
 * un certificado con extensiones AIA/CDP manipuladas podría forzar al
 * servidor a hacer peticiones a la red interna (SSRF).
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`URL inválida: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Esquema de URL no permitido: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") {
    throw new Error(`Host no permitido: ${hostname}`);
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion) {
    if (isPrivateOrReservedIp(hostname, ipVersion)) {
      throw new Error(
        `Dirección IP privada/reservada no permitida: ${hostname}`,
      );
    }
    return;
  }

  // Resolver DNS y validar TODAS las IPs devueltas (evita DNS rebinding hacia
  // rangos privados a través de un hostname público).
  const records = await lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new Error(`No se pudo resolver el host: ${hostname}`);
  }
  for (const { address, family } of records) {
    if (isPrivateOrReservedIp(address, family)) {
      throw new Error(
        `El host "${hostname}" resuelve a una dirección privada/reservada (${address}).`,
      );
    }
  }
}

function isPrivateOrReservedIp(ip: string, family: number): boolean {
  return family === 4 ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "esta" red
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incluye metadatos de nube)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6
    return isPrivateIPv4(lower.substring("::ffff:".length));
  }
  return false;
}
