import express from 'express';
import cors from 'cors';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { auditLogger } from './core/middlewares/auditLogger';
import { errorHandler } from './core/errors/errorHandler';
import { swaggerDocument } from './config/swagger';
import signatureRoutes from './routes/signatureRoutes';

const app = express();

// 1. Middlewares Globales
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Middleware de Auditoría de Sistemas (Captura todas las acciones del sistema)
app.use(auditLogger);

// 3. Montar Documentación API de Swagger
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// 4. Los documentos en almacenamiento local (fallback sin S3) NUNCA se sirven
//    como carpeta estática pública: solo son accesibles vía
//    GET /api/v1/documents/local-download?token=... (token HMAC con TTL),
//    que sí verifica autorización antes de entregar el archivo.

// 4b. Servir archivos estáticos públicos
app.use('/public', express.static(path.resolve(__dirname, '../public')));

// 5. Rutas de la API
app.use('/api/v1', signatureRoutes);

// Ruta de estado general (Health Check)
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'success',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// 6. Servir el frontend (SPA) compilado, junto al backend en el mismo contenedor
const frontendDistPath = path.resolve(__dirname, '../frontend-dist');
app.use(express.static(frontendDistPath));
app.get(/.*/, (req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/docs') ||
    req.path.startsWith('/uploads') ||
    req.path.startsWith('/public') ||
    req.path === '/health'
  ) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// 7. Manejador Centralizado de Errores (Zod, AppError, etc.)
app.use(errorHandler);

export default app;
