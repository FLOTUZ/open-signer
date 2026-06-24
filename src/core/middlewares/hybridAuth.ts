import { Request, Response, NextFunction } from 'express';
import { tokenAuth } from './tokenAuth';
import { apiKeyAuth } from './apiKeyAuth';

/**
 * Middleware híbrido que permite acceder mediante Token de sesión Bearer (panel web)
 * o mediante API Key (integraciones programáticas).
 */
export const hybridAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  // Si tiene cabecera Authorization (Bearer ...), intenta autenticar por token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return tokenAuth(req, res, next);
  }

  // De lo contrario, si tiene x-api-key, intenta autenticar por API Key
  if (apiKeyHeader) {
    return apiKeyAuth(req, res, next);
  }

  // Si no se proporciona ninguna de las dos cabeceras, lanza error de no autorizado
  res.status(401).json({
    status: 'fail',
    message: 'Acceso denegado. Se requiere Token Bearer o API Key (x-api-key).',
  });
};
