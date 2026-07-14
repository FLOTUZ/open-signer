import { z } from 'zod';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Valida que un campo multipart/form-data contenga al menos un archivo con buffer */
const uploadedFileSchema = z.any().refine(
  (files) => Array.isArray(files) && files.length > 0 && files[0].buffer && files[0].buffer.length > 0,
  { message: 'El archivo es obligatorio y debe cargarse correctamente.' }
);

/** Valida paginación en query params */
const paginationSchema = z.object({
  page:  z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  body: z.object({
    email:    z.string({ required_error: 'El correo electrónico es obligatorio' }).email('Formato de correo electrónico inválido'),
    password: z.string({ required_error: 'La contraseña es obligatoria' }).min(1, 'La contraseña no puede estar vacía'),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string({ required_error: 'La contraseña actual es obligatoria' }).min(1),
    newPassword:     z.string({ required_error: 'La nueva contraseña es obligatoria' }).min(8, 'La nueva contraseña debe tener al menos 8 caracteres'),
  }),
});

// ─── Admin ────────────────────────────────────────────────────────────────────

export const createUserSchema = z.object({
  body: z.object({
    name:     z.string().min(1, 'El nombre no puede estar vacío').optional(),
    email:    z.string({ required_error: 'El correo electrónico es obligatorio' }).email('Formato de correo electrónico inválido'),
    password: z.string({ required_error: 'La contraseña es obligatoria' }).min(8, 'La contraseña debe tener al menos 8 caracteres'),
    role:     z.enum(['SUPER_ADMIN', 'CLIENT']).optional(),
  }),
});

export const createApiKeySchema = z.object({
  body: z.object({
    clientId: z.string({ required_error: 'El ID del cliente es obligatorio' }).uuid('El ID de cliente debe ser un UUID válido'),
  }),
});

/** Parámetro de ruta para resetear contraseña */
export const userIdParamSchema = z.object({
  params: z.object({
    userId: z.string({ required_error: 'El ID del usuario es obligatorio' }).uuid('El ID de usuario debe ser un UUID válido'),
  }),
});

/** Query params para la bitácora de auditoría */
export const auditLogsQuerySchema = z.object({
  query: paginationSchema.extend({
    role:   z.enum(['SUPER_ADMIN', 'CLIENT']).optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    search: z.string().optional(),
  }),
});

// ─── Firma ────────────────────────────────────────────────────────────────────

export const signDocumentSchema = z.object({
  body: z.object({
    password:       z.string({ required_error: 'La contraseña de la llave privada es obligatoria' }).min(1, 'La contraseña no puede estar vacía'),
    cadenaOriginal: z.string({ required_error: 'La cadena original a firmar es obligatoria' }).min(1, 'La cadena original no puede estar vacía'),
  }),
  files: z.object({
    documento:   uploadedFileSchema,
    certificado: uploadedFileSchema,
    llave:       uploadedFileSchema,
  }, { required_error: 'Es obligatorio subir los archivos: documento, certificado (.cer) y llave (.key)' }),
});

// ─── Documentos (API Key) ─────────────────────────────────────────────────────

/** Query params para listado paginado de documentos */
export const listDocumentsQuerySchema = z.object({
  query: paginationSchema,
});

/** Parámetro de ruta para operaciones sobre un documento específico */
export const documentIdParamSchema = z.object({
  params: z.object({
    documentId: z.string({ required_error: 'El ID del documento es obligatorio' }).uuid('El ID del documento debe ser un UUID válido'),
  }),
});

// ─── Firma por Webhook (flujo Client-Side Crypto) ─────────────────────────────

/** POST /api/v1/signatures/request — El integrador solicita una sesión de firma */
export const createSignatureRequestSchema = z.object({
  body: z.object({
    redirectUrl: z
      .preprocess((val) => (val === '' ? undefined : val), z.string().url('redirectUrl debe ser una URL válida'))
      .optional()
      .nullable(),
    webhookUrl: z
      .string({ required_error: 'webhookUrl es obligatorio' })
      .url('webhookUrl debe ser una URL válida'),
    rfc: z
      .string({ required_error: 'El RFC del firmante es obligatorio' })
      .min(12, 'El RFC debe tener al menos 12 caracteres')
      .max(13, 'El RFC no puede tener más de 13 caracteres')
      .toUpperCase(),
  }),
  // La validación del archivo se hace en el controlador (docFile null check)
  // para dar un mensaje de error más descriptivo
  files: z.any().optional(),
});

/** POST /api/signatures/complete — El frontend envía la firma generada en el browser */
export const completeSignatureRequestSchema = z.object({
  body: z.object({
    id: z
      .string({ required_error: 'El id de la solicitud es obligatorio' })
      .uuid('El id debe ser un UUID válido'),
    signatureBase64: z
      .string({ required_error: 'signatureBase64 es obligatorio' })
      .min(10, 'La firma en Base64 parece inválida'),
    cerBase64: z
      .string({ required_error: 'cerBase64 es obligatorio' })
      .min(10, 'El certificado en Base64 parece inválido'),
  }),
});

/** Parámetro de ruta para consultar el contexto de una solicitud de firma */
export const signatureRequestIdParamSchema = z.object({
  params: z.object({
    id: z.string({ required_error: 'El id de la solicitud es obligatorio' }).uuid('El id debe ser un UUID válido'),
  }),
});

