import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '../errors/AppError';

export const requireRole = (role: Role) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || req.user.role !== role) {
      return next(new AppError('Acceso denegado. Permisos insuficientes.', 403));
    }
    return next();
  };
};
