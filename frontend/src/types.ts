export interface User {
  id: string;
  name?: string | null;
  email: string;
  role: "SUPER_ADMIN" | "CLIENT";
  mustChangePassword?: boolean;
  createdAt: string;
}

export interface ApiKeyItem {
  id: string;
  status: string;
  createdAt: string;
  name?: string | null;
  logoUrl?: string | null;
}

export interface DocItem {
  id: string;
  s3Url: string;
  stampedS3Url?: string | null;
  documentHash: string;
  signatureString: string;
  signerName?: string;
  signerRfc?: string;
  cadenaOriginal?: string;
  createdAt: string;
}

export interface AuditItem {
  id: string;
  method: string;
  endpoint: string;
  originIp: string;
  role: string | null;
  username: string | null;
  description: string;
  timestamp: string;
}

export interface CertValidationAprobado {
  resultado: "APROBADO";
  codigo_estado: "VALIDACION_EXITOSA";
  metadata: {
    titular_nombre: string;
    titular_rfc: string;
    titular_curp: string | null;
    numero_serie: string;
    valido_hasta: string;
  };
}

export interface CertValidationRechazado {
  resultado: "RECHAZADO";
  codigo_estado: string;
  detalles: string;
}

export type CertValidationResult = CertValidationAprobado | CertValidationRechazado;
