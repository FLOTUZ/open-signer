import { Request, Response, NextFunction } from 'express';
import { TokenService } from '../../services/TokenService';
import { prisma } from '../../config/db';
import { AppError } from '../errors/AppError';

export const tokenAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Acceso denegado. No se proporcionó el token de sesión Bearer.', 401);
    }

    const token = authHeader.substring(7); // Extraer token tras "Bearer "
    const decoded = TokenService.verifyToken(token);

    if (!decoded) {
      throw new AppError('Sesión expirada o token inválido.', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw new AppError('Usuario no encontrado o dado de baja.', 401);
    }

    // Guardar usuario en el contexto de la petición
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};
