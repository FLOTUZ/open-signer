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

// 4. Servir archivos locales en desarrollo (fallback local de S3)
app.use('/uploads', express.static(path.resolve(env.LOCAL_STORAGE_PATH)));

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

// 6. Manejador Centralizado de Errores (Zod, AppError, etc.)
app.use(errorHandler);

export default app;
