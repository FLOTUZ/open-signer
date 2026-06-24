import { env } from "process";

export const swaggerDocument = {
  openapi: "3.0.0",
  info: {
    title: "Open Signer — Microservicio de Firma Electrónica",
    version: "2.0.0",
    description:
      "API-first para la firma digital de documentos con certificados SAT (e.firma). Incluye autenticación por token Bearer (panel web) y por API Key (integraciones externas).",
  },
  servers: [
    {
      url: `http://${env.DOMAIN}:5000`,
      description: "Servidor Local (Docker)",
    },
  ],

  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Token JWT obtenido en POST /auth/login",
      },
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "API Key generada desde el panel de administración",
      },
    },
    schemas: {
      // ── Entidades ──────────────────────────────────────────────────────────
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", nullable: true, example: "Juan Pérez López" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["SUPER_ADMIN", "CLIENT"] },
          mustChangePassword: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      ApiKeyItem: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          apiKey: {
            type: "string",
            description: "Clave en texto plano — visible UNA sola vez",
          },
          status: { type: "string", enum: ["ACTIVE", "REVOCED"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      SignedDocument: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          documentHash: {
            type: "string",
            description: "SHA-256 del documento original",
          },
          signatureString: {
            type: "string",
            description: "Firma RSA en Base64",
          },
          signerName: { type: "string", nullable: true },
          signerRfc: { type: "string", nullable: true },
          cadenaOriginal: { type: "string", nullable: true },
          stampedS3Url: {
            type: "string",
            nullable: true,
            description: "URL del documento estampado (si fue enviado)",
          },
          verificationUrl: {
            type: "string",
            description: "URL pública de verificación del sello",
          },
          qrCodeUrl: {
            type: "string",
            description: "QR como data-URL base64 (png)",
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AuditLog: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
          endpoint: { type: "string" },
          originIp: { type: "string" },
          role: {
            type: "string",
            nullable: true,
            enum: ["SUPER_ADMIN", "CLIENT"],
          },
          username: {
            type: "string",
            nullable: true,
            description: "Nombre o email del usuario que realizó la acción",
          },
          description: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          total: { type: "integer" },
          page: { type: "integer" },
          limit: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
      // ── Errores ────────────────────────────────────────────────────────────
      ErrorResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "fail" },
          message: { type: "string", example: "Descripción del error" },
          errors: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
      },

      // ── Firma por Webhook (Client-Side Crypto) ─────────────────────────────
      SignatureRequestItem: {
        type: "object",
        properties: {
          id:           { type: "string", format: "uuid" },
          documentHash: { type: "string", description: "SHA-256 del documento original" },
          documentName: { type: "string" },
          documentSize: { type: "integer" },
          status: {
            type: "string",
            enum: ["PENDING", "SIGNED", "FAILED", "EXPIRED"],
          },
          redirectUrl:    { type: "string", format: "uri" },
          webhookUrl:     { type: "string", format: "uri" },
          signatureData:  { type: "string", nullable: true, description: "Firma RSA-SHA256 en Base64" },
          nom151Stamp:    { type: "string", nullable: true, description: "Sello NOM-151 del PSC" },
          signerName:     { type: "string", nullable: true },
          signerRfc:      { type: "string", nullable: true },
          cerSerialNumber: { type: "string", nullable: true },
          expiresAt:      { type: "string", format: "date-time", description: "TTL: 24 horas desde la creación" },
          createdAt:      { type: "string", format: "date-time" },
        },
      },

      WebhookPayload: {
        type: "object",
        description: "Payload enviado al webhookUrl del integrador al completarse la firma",
        properties: {
          event:              { type: "string", enum: ["SIGNATURE_COMPLETED", "SIGNATURE_FAILED"] },
          signatureRequestId: { type: "string", format: "uuid" },
          documentHash:       { type: "string" },
          documentName:       { type: "string" },
          signatureData:      { type: "string", nullable: true },
          signatureString:    { type: "string", nullable: true, description: "Firma en Base64 para compatibilidad" },
          nom151Stamp:        { type: "string", nullable: true },
          signerName:         { type: "string", nullable: true },
          signerRfc:          { type: "string", nullable: true },
          cerSerialNumber:    { type: "string", nullable: true },
          cadenaOriginal:     { type: "string", nullable: true },
          qrCodeUrl:          { type: "string", nullable: true, description: "URL de datos (base64) del QR de verificación" },
          completedAt:        { type: "string", format: "date-time" },
        },
      },

    },
  },

  paths: {
    // ════════════════════════════════════════════════════════════════════════
    // AUTH
    // ════════════════════════════════════════════════════════════════════════
    "/api/v1/auth/login": {
      post: {
        tags: ["Autenticación"],
        summary: "Iniciar sesión",
        description:
          "Devuelve un token Bearer y los datos del usuario. Si la BD está vacía, auto-crea el Super Admin (`admin@opensigner.com` / `admin12345`).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    example: "admin@opensigner.com",
                  },
                  password: { type: "string", example: "admin12345" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Sesión iniciada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "success" },
                    data: {
                      type: "object",
                      properties: {
                        token: { type: "string" },
                        user: { $ref: "#/components/schemas/User" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: "Credenciales inválidas",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          422: {
            description: "Validación de campos fallida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/v1/auth/me": {
      get: {
        tags: ["Autenticación"],
        summary: "Perfil del usuario autenticado",
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "Datos del usuario",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
          401: {
            description: "Token inválido o expirado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/v1/auth/change-password": {
      post: {
        tags: ["Autenticación"],
        summary: "Cambiar contraseña",
        description:
          "Obligatorio en el primer inicio de sesión (`mustChangePassword: true`). Resetea el flag tras el cambio exitoso.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["currentPassword", "newPassword"],
                properties: {
                  currentPassword: { type: "string" },
                  newPassword: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Contraseña actualizada" },
          400: {
            description: "Contraseña actual incorrecta",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          422: {
            description: "Validación fallida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN
    // ════════════════════════════════════════════════════════════════════════
    "/api/v1/admin/users": {
      get: {
        tags: ["Administración"],
        summary: "Listar todos los usuarios",
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: "Lista de usuarios",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    results: { type: "integer" },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Administración"],
        summary: "Crear usuario",
        description:
          "Crea un cliente o admin. El usuario deberá cambiar su contraseña en el primer inicio de sesión (`mustChangePassword: true`).",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  name: { type: "string", example: "María García" },
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                  role: {
                    type: "string",
                    enum: ["SUPER_ADMIN", "CLIENT"],
                    default: "CLIENT",
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Usuario creado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
          409: {
            description: "El email ya existe",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          422: {
            description: "Validación fallida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/users/{userId}/reset-password": {
      post: {
        tags: ["Administración"],
        summary: "Invalidar contraseña y generar una temporal",
        description:
          "Genera una contraseña aleatoria de 12 caracteres y activa `mustChangePassword`. La contraseña temporal se devuelve **una sola vez** en texto plano.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
            description: "UUID del usuario",
          },
        ],
        responses: {
          200: {
            description: "Contraseña restablecida",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "success" },
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        userId: { type: "string", format: "uuid" },
                        email: { type: "string" },
                        temporaryPassword: {
                          type: "string",
                          description:
                            "Contraseña temporal — visible UNA sola vez",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: "Usuario no encontrado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/apikeys": {
      post: {
        tags: ["Administración"],
        summary: "Generar API Key para un cliente",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["clientId"],
                properties: { clientId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
        responses: {
          201: {
            description: "API Key generada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: { $ref: "#/components/schemas/ApiKeyItem" },
                  },
                },
              },
            },
          },
          404: {
            description: "Cliente no encontrado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/v1/admin/audit-logs": {
      get: {
        tags: ["Administración"],
        summary: "Bitácora de auditoría",
        description:
          "Devuelve los registros de auditoría con paginación y filtros.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, maximum: 100 },
          },
          {
            name: "role",
            in: "query",
            schema: { type: "string", enum: ["SUPER_ADMIN", "CLIENT"] },
          },
          {
            name: "method",
            in: "query",
            schema: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
          },
          {
            name: "search",
            in: "query",
            schema: { type: "string" },
            description: "Busca en username y endpoint",
          },
        ],
        responses: {
          200: {
            description: "Bitácora paginada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AuditLog" },
                    },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
        },
      },
    },



    "/api/v1/signatures/verify/{documentId}": {
      get: {
        tags: ["Firma (API Key)"],
        summary: "Verificar autenticidad de un documento firmado",
        description:
          "Endpoint público. Devuelve los metadatos del sello digital para auditoría.",
        parameters: [
          {
            name: "documentId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          200: {
            description: "Documento verificado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: { $ref: "#/components/schemas/SignedDocument" },
                  },
                },
              },
            },
          },
          404: {
            description: "Documento no encontrado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // DOCUMENTOS (API Key)
    // ════════════════════════════════════════════════════════════════════════
    "/api/v1/api/documents": {
      get: {
        tags: ["Documentos (API Key)"],
        summary: "Listar documentos firmados del cliente",
        description:
          "Retorna todos los documentos firmados asociados a la API Key del cliente, con paginación.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, maximum: 100 },
          },
        ],
        responses: {
          200: {
            description: "Lista de documentos paginada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/SignedDocument" },
                    },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          401: {
            description: "API Key inválida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/v1/documents/{documentId}/download-url": {
      get: {
        tags: ["Documentos (API Key)"],
        summary: "Obtener URL temporal de descarga",
        description:
          "Genera una URL de acceso temporal (15 minutos) para el documento firmado. Con S3 real: presigned URL de AWS. En desarrollo local: token HMAC interno.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: "documentId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          200: {
            description: "URL temporal generada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        documentId: { type: "string", format: "uuid" },
                        url: {
                          type: "string",
                          description: "URL temporal (expira en 15 min)",
                        },
                        expiresAt: { type: "string", format: "date-time" },
                        note: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: "API Key inválida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          404: {
            description: "Documento no encontrado o sin permisos",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/v1/documents/{documentId}/stamp": {
      post: {
        tags: ["Documentos (API Key)"],
        summary: "Subir documento estampado",
        description:
          "Almacena una copia del documento firmado/estampado (con sello visual). El archivo debe enviarse en el campo `stamped` del formulario multipart.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: "documentId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["stamped"],
                properties: {
                  stamped: {
                    type: "string",
                    format: "binary",
                    description:
                      "Documento estampado (PDF, imagen, etc.) — máx. 20 MB",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Documento estampado almacenado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        id: { type: "string", format: "uuid" },
                        stampedS3Url: { type: "string" },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Archivo "stamped" no enviado',
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          401: {
            description: "API Key inválida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          404: {
            description: "Documento no encontrado o sin permisos",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // VALIDACIÓN DE CERTIFICADOS (Público)
    // ════════════════════════════════════════════════════════════════════════
    "/api/v1/certificates/validate": {
      post: {
        tags: ["Certificados"],
        summary: "Validar certificado e.firma SAT",
        description:
          "Aplica 3 reglas de validación en cascada: (1) emisor SAT, (2) vigencia temporal, (3) estructura del subject. Sin autenticación requerida.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["certificado"],
                properties: {
                  certificado: {
                    type: "string",
                    format: "binary",
                    description: "Archivo .cer del SAT — máx. 1 MB",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Resultado de validación (APROBADO o RECHAZADO)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    resultado: {
                      type: "string",
                      enum: ["APROBADO", "RECHAZADO"],
                    },
                    codigo_estado: {
                      type: "string",
                      example: "CERTIFICADO_VALIDO",
                    },
                    metadata: {
                      type: "object",
                      nullable: true,
                      properties: {
                        nombre: { type: "string" },
                        rfc: { type: "string" },
                        curp: { type: "string", nullable: true },
                        noSerie: { type: "string" },
                        validoDesde: { type: "string" },
                        validoHasta: { type: "string" },
                        emisor: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Archivo no enviado o no es .cer",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // FIRMA POR WEBHOOK — Client-Side Crypto (Zero-Trust)
    // ════════════════════════════════════════════════════════════════════════
    "/api/v1/signatures/request": {
      post: {
        tags: ["Firma por Webhook"],
        summary: "Crear solicitud de firma (integrador)",
        description:
          "El integrador sube el documento, indica `redirectUrl` y `webhookUrl`. El sistema calcula el hash SHA-256, almacena el documento y retorna una `signUrl` única con TTL de 24 horas. El integrador redirige al usuario a esa URL para que firme localmente en su navegador.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["documento", "redirectUrl", "webhookUrl"],
                properties: {
                  documento: {
                    type: "string",
                    format: "binary",
                    description: "Archivo a firmar (PDF, XML, etc.) — máx. 20 MB",
                  },
                  redirectUrl: {
                    type: "string",
                    format: "uri",
                    description: "URL a donde redirigir al usuario tras firmar exitosamente",
                    example: "https://tu-app.com/firma-completada",
                  },
                  webhookUrl: {
                    type: "string",
                    format: "uri",
                    description: "URL de tu servidor donde se enviará la notificación (server-to-server)",
                    example: "https://tu-servidor.com/webhooks/firma",
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Solicitud creada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status:  { type: "string", example: "success" },
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        id:           { type: "string", format: "uuid" },
                        signUrl:      { type: "string", description: "URL para que el usuario firme" },
                        documentHash: { type: "string" },
                        documentName: { type: "string" },
                        expiresAt:    { type: "string", format: "date-time", description: "Expira en 24h" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: "Archivo faltante o URLs inválidas", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          401: { description: "API Key inválida", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },

    "/api/v1/signatures/request/{id}/context": {
      get: {
        tags: ["Firma por Webhook"],
        summary: "Obtener contexto de la solicitud (público)",
        description:
          "El frontend de firma usa este endpoint para mostrarle al usuario qué documento va a firmar. No requiere autenticación. Retorna error 410 si la sesión de firma expiró.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
            description: "UUID de la solicitud de firma",
          },
        ],
        responses: {
          200: {
            description: "Contexto de la solicitud",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        id:           { type: "string", format: "uuid" },
                        documentHash: { type: "string" },
                        documentName: { type: "string" },
                        documentSize: { type: "integer" },
                        status:       { type: "string", enum: ["PENDING"] },
                        expiresAt:    { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: "Solicitud no encontrada" },
          409: { description: "La solicitud ya fue procesada" },
          410: { description: "La sesión de firma ha expirado (TTL: 24 horas)" },
        },
      },
    },

    "/api/v1/signatures/complete": {
      post: {
        tags: ["Firma por Webhook"],
        summary: "Completar firma (llamado desde el navegador del usuario)",
        description:
          "El frontend de firma envía la firma RSA-SHA256 generada **localmente en el navegador** junto con el certificado `.cer` público (en Base64). **La llave privada nunca se envía al servidor.** El backend valida el certificado contra la cadena de confianza del SAT, solicita el sello NOM-151 (si PSC_URL está configurado) y encola la notificación webhook al integrador.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "signatureBase64", "cerBase64"],
                properties: {
                  id: {
                    type: "string",
                    format: "uuid",
                    description: "UUID de la SignatureRequest",
                  },
                  signatureBase64: {
                    type: "string",
                    description: "Firma RSA-SHA256 del documentHash, codificada en Base64. Generada con Web Crypto API en el navegador del usuario.",
                  },
                  cerBase64: {
                    type: "string",
                    description: "Certificado .cer público del usuario, codificado en Base64.",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Firma completada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status:      { type: "string", example: "success" },
                    message:     { type: "string" },
                    redirectUrl: { type: "string", format: "uri" },
                    data: {
                      type: "object",
                      properties: {
                        signatureRequestId: { type: "string", format: "uuid" },
                        signerName:         { type: "string" },
                        signerRfc:          { type: "string" },
                        cerSerialNumber:    { type: "string" },
                        nom151Obtained:     { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: "Certificado inválido o rechazado por la cadena SAT" },
          404: { description: "Solicitud no encontrada" },
          409: { description: "La solicitud ya fue procesada" },
          410: { description: "La sesión de firma ha expirado" },
        },
      },
    },

    "/api/v1/signatures/requests": {
      get: {
        tags: ["Firma por Webhook"],
        summary: "Listar solicitudes de firma del cliente (API Key)",
        description: "Retorna el historial de SignatureRequests del cliente autenticado, incluyendo el estado de los WebhookJobs para monitoreo.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "page",  in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: {
          200: {
            description: "Lista paginada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status:     { type: "string" },
                    data:       { type: "array", items: { $ref: "#/components/schemas/SignatureRequestItem" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          401: { description: "API Key inválida" },
        },
      },
    },
  },
};

