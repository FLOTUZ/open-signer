import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db';
import { HttpMethod } from '@prisma/client';

function getAuditDescription(req: Request, res: Response, ip: string): string {
  const url = req.originalUrl.split('?')[0];
  const method = req.method.toUpperCase();
  const status = res.statusCode;

  // Autenticación
  if (url === '/api/v1/auth/login' && method === 'POST') {
    return status === 200 || status === 201
      ? `Iniciar sesión — Exitoso (${req.body?.email || 'N/D'})`
      : `Iniciar sesión — Fallido (${req.body?.email || 'N/D'})`;
  }
  if (url === '/api/v1/auth/me' && method === 'GET') {
    return `Perfil del usuario autenticado`;
  }
  if (url === '/api/v1/auth/change-password' && method === 'POST') {
    return `Cambiar contraseña`;
  }

  // Administración
  if (url === '/api/v1/admin/users' && method === 'POST') {
    return `Crear usuario — Email: ${req.body?.email || 'N/D'}, Rol: ${req.body?.role || 'CLIENT'}`;
  }
  if (url === '/api/v1/admin/users' && method === 'GET') {
    return `Listar todos los usuarios`;
  }
  if (url.startsWith('/api/v1/admin/users/') && url.endsWith('/reset-password') && method === 'POST') {
    const parts = url.split('/');
    const userId = parts[5] || 'N/D';
    return `Invalidar contraseña y generar una temporal — Usuario ID: ${userId}`;
  }
  if (url === '/api/v1/admin/apikeys' && method === 'POST') {
    return `Generar API Key para un cliente — Cliente ID: ${req.body?.clientId || 'N/D'}`;
  }
  if (url === '/api/v1/admin/audit-logs' && method === 'GET') {
    return `Bitácora de auditoría`;
  }

  // Cliente (Panel web)
  if (url === '/api/v1/clients/apikeys' && method === 'GET') {
    return `Listar API Keys del cliente`;
  }
  if (url === '/api/v1/clients/apikeys' && method === 'POST') {
    return `Generar API Key por el cliente`;
  }
  if (url.startsWith('/api/v1/clients/apikeys/') && method === 'DELETE') {
    const parts = url.split('/');
    const keyId = parts[5] || 'N/D';
    return `Eliminar API Key del cliente — Key ID: ${keyId}`;
  }
  if (url === '/api/v1/clients/documents' && method === 'GET') {
    return `Listar documentos firmados del cliente`;
  }
  if (url === '/api/v1/clients/test-certificates' && method === 'POST') {
    return `Generar certificados de prueba`;
  }
  if (url.startsWith('/api/v1/clients/apikeys/') && url.endsWith('/branding') && method === 'POST') {
    const parts = url.split('/');
    const keyId = parts[5] || 'N/D';
    const name = req.body?.name || 'N/D';
    const hasFile = !!req.file;
    return status >= 200 && status < 300
      ? `Actualizar branding de API Key — Nombre: "${name}", Logo subido: ${hasFile ? 'Sí' : 'No'} (Key ID: ${keyId})`
      : `Intento fallido de actualizar branding de API Key (HTTP ${status}) — Key ID: ${keyId}`;
  }

  // Documentos
  if (url === '/api/v1/documents/local-download' && method === 'GET') {
    return `Descargar documento local`;
  }
  if (url.startsWith('/api/v1/documents/') && url.endsWith('/download-url') && method === 'GET') {
    const parts = url.split('/');
    const docId = parts[4] || 'N/D';
    return `Obtener URL temporal de descarga — Documento ID: ${docId}`;
  }
  if (url === '/api/v1/api/documents' && method === 'GET') {
    return `Listar documentos firmados del cliente`;
  }
  if (url.startsWith('/api/v1/documents/') && url.endsWith('/stamp') && method === 'POST') {
    const parts = url.split('/');
    const docId = parts[4] || 'N/D';
    return `Subir documento estampado — Documento ID: ${docId}`;
  }

  // Firmas vía Webhook (flujo Client-Side Crypto)
  if (url === '/api/v1/signatures/request' && method === 'POST') {
    const files = req.files as any;
    const docFile = files?.documento?.[0];
    const fileName = docFile?.originalname || 'N/D';
    return status >= 200 && status < 300
      ? `Generar enlace de firma para "${fileName}" — Exitoso`
      : `Generar enlace de firma — Fallido (Estado HTTP: ${status})`;
  }
  if (url.startsWith('/api/v1/signatures/request/') && url.endsWith('/context') && method === 'GET') {
    const parts = url.split('/');
    const requestId = parts[5] || 'N/D';
    if (status === 200) {
      return `Acceso al link de firma — Solicitud ID: ${requestId}`;
    } else if (status === 409) {
      return `Intento de acceso a link de firma ya procesado — Solicitud ID: ${requestId}`;
    } else if (status === 410) {
      return `Intento de acceso a link de firma expirado — Solicitud ID: ${requestId}`;
    } else if (status === 404) {
      return `Intento de acceso a link de firma inexistente o inválido — Solicitud ID: ${requestId}`;
    }
    return `Intento de acceso a link de firma fallido (HTTP ${status}) — Solicitud ID: ${requestId}`;
  }
  if (url.startsWith('/api/v1/signatures/request/') && url.endsWith('/document') && method === 'GET') {
    const parts = url.split('/');
    const requestId = parts[5] || 'N/D';
    return status >= 200 && status < 300
      ? `Obtener documento de firma para previsualización — Solicitud ID: ${requestId}`
      : `Intento de obtener documento para previsualización fallido (HTTP ${status}) — Solicitud ID: ${requestId}`;
  }
  if (url === '/api/v1/signatures/complete' && method === 'POST') {
    const reqId = req.body?.id || 'N/D';
    return status >= 200 && status < 300
      ? `Firma completada exitosamente — Solicitud ID: ${reqId}`
      : `Intento de firma fallido — Solicitud ID: ${reqId} (Estado HTTP: ${status})`;
  }
  if (url === '/api/v1/signatures/requests' && method === 'GET') {
    return `Listar solicitudes de firma del cliente`;
  }
  if (url.startsWith('/api/v1/signatures/webhooks/retry/') && method === 'POST') {
    const parts = url.split('/');
    const jobId = parts[6] || 'N/D';
    return status >= 200 && status < 300
      ? `Solicitud de reintento de webhook exitosa — Job ID: ${jobId}`
      : `Solicitud de reintento de webhook fallida — Job ID: ${jobId} (HTTP ${status})`;
  }
  if (url.startsWith('/api/v1/signatures/requests/') && url.endsWith('/webhook-url') && method === 'PATCH') {
    const parts = url.split('/');
    const requestId = parts[5] || 'N/D';
    const webhookUrl = req.body?.webhookUrl || 'N/D';
    return status >= 200 && status < 300
      ? `Actualizar URL de webhook de la solicitud — Nueva URL: ${webhookUrl} (Solicitud ID: ${requestId})`
      : `Fallo al actualizar URL de webhook — Solicitud ID: ${requestId} (HTTP ${status})`;
  }

  // Rutas Públicas de Validación y Verificación
  if (url === '/api/v1/certificates/validate' && method === 'POST') {
    return status >= 200 && status < 300
      ? `Validar certificado (.cer) de e.firma — Exitoso`
      : `Validar certificado (.cer) de e.firma — Fallido (HTTP ${status})`;
  }
  if (url.startsWith('/api/v1/signatures/verify/') && method === 'GET') {
    const parts = url.split('/');
    const docId = parts[5] || 'N/D';
    return status >= 200 && status < 300
      ? `Consultar verificación pública de documento firmado — Documento ID: ${docId}`
      : `Consulta de verificación pública fallida — Documento ID: ${docId} (HTTP ${status})`;
  }

  // Genérico
  return `Petición HTTP finalizada con estado ${status}. RUTA: ${req.originalUrl}. IP: ${ip}`;
}

export const auditLogger = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Capture request IP
  const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp);

  // Listen to response finish to log the result asynchronously
  res.on('finish', async () => {
    try {
      const methodStr = req.method.toUpperCase();
      let method: HttpMethod | null = null;

      if (methodStr === 'GET') method = HttpMethod.GET;
      else if (methodStr === 'POST') method = HttpMethod.POST;
      else if (methodStr === 'PUT') method = HttpMethod.PUT;
      else if (methodStr === 'DELETE') method = HttpMethod.DELETE;

      // If the HTTP method is not one of the audited methods in the schema, skip it
      if (!method) {
        return;
      }

      const client = req.user;
      const description = getAuditDescription(req, res, ip);

      await prisma.auditLog.create({
        data: {
          method,
          endpoint: req.originalUrl,
          originIp: ip,
          role: client?.role || null,
          username: (client?.name || client?.email) ?? null,
          description,
        },
      });
    } catch (error) {
      // Operational safety: logging failure must not crash the application
      console.error('❌ Fallo al registrar log de auditoría:', error);
    }
  });

  return next();
};
