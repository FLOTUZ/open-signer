import { Router } from 'express';
import { SignatureController } from '../controllers/SignatureController';
import { CertificateController } from '../controllers/CertificateController';
import { AdminController } from '../controllers/AdminController';
import { AuthController } from '../controllers/AuthController';
import { ClientController } from '../controllers/ClientController';
import { DocumentController } from '../controllers/DocumentController';
import { SignatureRequestController } from '../controllers/SignatureRequestController';
import { validate } from '../core/middlewares/validate';
import { apiKeyAuth } from '../core/middlewares/apiKeyAuth';
import { tokenAuth } from '../core/middlewares/tokenAuth';
import { hybridAuth } from '../core/middlewares/hybridAuth';
import { requireRole } from '../core/middlewares/requireRole';
import { upload, singleCerUpload, singleStampedUpload, signatureRequestDocUpload } from '../core/middlewares/upload';
import { Role } from '@prisma/client';
import {
  createUserSchema,
  createApiKeySchema,
  loginSchema,
  changePasswordSchema,
  userIdParamSchema,
  auditLogsQuerySchema,
  listDocumentsQuerySchema,
  documentIdParamSchema,
  createSignatureRequestSchema,
  completeSignatureRequestSchema,
  signatureRequestIdParamSchema,
} from '../core/validation/schemas';

const router = Router();

// ─── AUTENTICACIÓN ────────────────────────────────────────────────────────────
router.post('/auth/login',           validate(loginSchema),          AuthController.login);
router.get( '/auth/me',              tokenAuth,                      AuthController.me);
router.post('/auth/change-password', tokenAuth, validate(changePasswordSchema), AuthController.changePassword);

// ─── ADMINISTRACIÓN (SUPER_ADMIN) ─────────────────────────────────────────────
router.post(
  '/admin/users',
  tokenAuth, requireRole(Role.SUPER_ADMIN), validate(createUserSchema),
  AdminController.createUser
);

router.get(
  '/admin/users',
  tokenAuth, requireRole(Role.SUPER_ADMIN),
  AdminController.getUsers
);

router.post(
  '/admin/users/:userId/reset-password',
  tokenAuth, requireRole(Role.SUPER_ADMIN), validate(userIdParamSchema),
  AdminController.resetUserPassword
);

router.post(
  '/admin/apikeys',
  tokenAuth, requireRole(Role.SUPER_ADMIN), validate(createApiKeySchema),
  AdminController.createApiKey
);

router.get(
  '/admin/audit-logs',
  tokenAuth, requireRole(Role.SUPER_ADMIN), validate(auditLogsQuerySchema),
  AdminController.getAuditLogs
);

router.post(
  '/admin/crl/sync',
  tokenAuth, requireRole(Role.SUPER_ADMIN),
  CertificateController.syncCrl
);

// ─── CLIENTE — Panel web (autenticado por token de sesión) ────────────────────
router.get(   '/clients/apikeys',           tokenAuth, requireRole(Role.CLIENT), ClientController.getMyApiKeys);
router.post(  '/clients/apikeys',           tokenAuth, requireRole(Role.CLIENT), ClientController.createMyApiKey);
router.delete('/clients/apikeys/:keyId',    tokenAuth, requireRole(Role.CLIENT), ClientController.deleteMyApiKey);
router.get(   '/clients/documents',         tokenAuth, requireRole(Role.CLIENT), ClientController.getMyDocuments);
router.post(  '/clients/test-certificates', tokenAuth, ClientController.generateTestCertificates);
router.post(  '/clients/apikeys/:keyId/branding', tokenAuth, requireRole(Role.CLIENT), upload.single('logo'), ClientController.updateApiKeyBranding);

// ─── DOCUMENTOS — URL temporal (API Key) ──────────────────────────────────────
router.get(
  '/documents/local-download',
  DocumentController.serveLocalDocument
);

router.get(
  '/documents/:documentId/download-url',
  hybridAuth, validate(documentIdParamSchema),
  DocumentController.getDocumentDownloadUrl
);

// ─── DOCUMENTOS — Listado programático (API Key) ──────────────────────────────
router.get(
  '/api/documents',
  apiKeyAuth, validate(listDocumentsQuerySchema),
  DocumentController.getDocumentsByApiKey
);

// ─── DOCUMENTOS — Subida de estampado (API Key) ───────────────────────────────
router.post(
  '/documents/:documentId/stamp',
  hybridAuth, singleStampedUpload, validate(documentIdParamSchema),
  DocumentController.uploadStampedDocument
);


// ─── FIRMA VÍA WEBHOOK (flujo Client-Side Crypto) ─────────────────────────────
// 1. El integrador solicita una sesión de firma (requiere API Key)
router.post(
  '/signatures/request',
  apiKeyAuth, signatureRequestDocUpload, validate(createSignatureRequestSchema),
  SignatureRequestController.createRequest
);

// 2. El frontend consulta el contexto de la solicitud (público)
router.get(
  '/signatures/request/:id/context',
  validate(signatureRequestIdParamSchema),
  SignatureRequestController.getRequestContext
);

// 2b. El frontend consulta la URL del documento de la solicitud para previsualizarlo (público)
router.get(
  '/signatures/request/:id/document',
  validate(signatureRequestIdParamSchema),
  SignatureRequestController.getRequestDocumentUrl
);

// 3. El frontend envía la firma generada en el navegador (público)
router.post(
  '/signatures/complete',
  validate(completeSignatureRequestSchema),
  SignatureRequestController.completeRequest
);

// 4. El integrador lista sus solicitudes de firma (requiere API Key)
router.get(
  '/signatures/requests',
  apiKeyAuth,
  SignatureRequestController.listRequests
);

// 5. El integrador reintenta manualmente un webhook (requiere API Key)
router.post(
  '/signatures/webhooks/retry/:jobId',
  apiKeyAuth,
  SignatureRequestController.retryWebhook
);

// 6. El integrador edita la URL del webhook de una solicitud (requiere API Key)
router.patch(
  '/signatures/requests/:id/webhook-url',
  apiKeyAuth,
  SignatureRequestController.updateWebhookUrl
);

// ─── RUTAS PÚBLICAS ───────────────────────────────────────────────────────────
router.post('/certificates/validate',       singleCerUpload,           CertificateController.validateCertificate);
router.get( '/signatures/verify/:documentId',                          SignatureController.verifyDocument);
router.get( '/documentation', (_req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const mdPath = path.join(__dirname, '../../public/documentation.md');
    if (!fs.existsSync(mdPath)) {
      res.status(404).send('Archivo de documentación no encontrado.');
      return;
    }
    const markdown = fs.readFileSync(mdPath, 'utf8');
    
    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Documentation — Open Signer</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css">
  <style>
    body {
      box-sizing: border-box;
      min-width: 200px;
      max-width: 980px;
      margin: 0 auto;
      padding: 45px;
      background-color: #0d1117;
    }
    .markdown-body {
      box-sizing: border-box;
      min-width: 200px;
      max-width: 980px;
      padding: 45px;
      background-color: #0d1117;
      color: #c9d1d9;
    }
    @media (max-width: 767px) {
      body { padding: 15px; }
      .markdown-body { padding: 15px; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body class="markdown-body">
  <div id="content">Cargando documentación...</div>
  <script>
    const markdownText = \`${markdown.replace(/`/g, '\\`').replace(/\${/g, '\\${')}\`;
    document.getElementById('content').innerHTML = marked.parse(markdownText);
  </script>
</body>
</html>
    `);
  } catch (error) {
    res.status(500).send('Error interno al cargar la documentación.');
  }
});

export default router;
