import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../../config/db';
import { AppError } from '../errors/AppError';

export const apiKeyAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKeyHeader = req.headers['x-api-key'];

    if (!apiKeyHeader) {
      throw new AppError('Acceso denegado. No se proporcionó la API Key (x-api-key en headers).', 401);
    }

    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;

    // Hash the incoming API Key to match the database stored SHA-256 hash
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

    const keyRecord = await prisma.apiKey.findUnique({
      where: { hash: hashedKey },
      include: { client: true },
    });

    if (!keyRecord || keyRecord.status !== 'ACTIVE') {
      throw new AppError('API Key inválida o revocada.', 401);
    }

    // Attach user (client) and apiKey to the request object
    req.user = keyRecord.client;
    req.apiKey = keyRecord;
    return next();
  } catch (error) {
    return next(error);
  }
};
