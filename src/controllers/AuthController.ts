import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/db';
import { TokenService } from '../services/TokenService';
import { AppError } from '../core/errors/AppError';
import { Role } from '@prisma/client';

export class AuthController {
  /**
   * Verifica contraseñas encriptadas con PBKDF2.
   */
  private static verifyPassword(password: string, storedHash: string): boolean {
    try {
      const [salt, hash] = storedHash.split(':');
      if (!salt || !hash) {
        return false;
      }
      const calculatedHash = crypto
        .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
        .toString('hex');

      return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(calculatedHash, 'hex')
      );
    } catch {
      return false;
    }
  }

  /**
   * Endpoint de login.
   * Auto-seeding: si la base de datos de usuarios está vacía, crea el Super Admin de forma transparente.
   */
  public static async login(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const { email, password } = req.body;

    try {
      // 1. Auto-seeding en el primer login si no hay usuarios en la DB
      const userCount = await prisma.user.count();
      if (userCount === 0) {
        console.log('🌱 Base de datos vacía. Auto-creando usuario inicial Super Admin...');
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync('admin12345', salt, 10000, 64, 'sha512').toString('hex');
        const passwordHash = `${salt}:${hash}`;

        await prisma.user.create({
          data: {
            email: 'admin@opensigner.com',
            passwordHash,
            role: Role.SUPER_ADMIN,
            mustChangePassword: true,
          },
        });
      }

      // 2. Buscar usuario por email
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new AppError('Credenciales incorrectas (usuario no encontrado o contraseña inválida).', 401);
      }

      // 3. Validar contraseña
      const isPasswordValid = AuthController.verifyPassword(password, user.passwordHash);
      if (!isPasswordValid) {
        throw new AppError('Credenciales incorrectas (usuario no encontrado o contraseña inválida).', 401);
      }

      // 4. Generar token
      const token = TokenService.generateToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.status(200).json({
        status: 'success',
        message: 'Sesión iniciada con éxito.',
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
            createdAt: user.createdAt,
          },
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Obtiene la información del usuario autenticado actual.
   */
  public static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new AppError('No autenticado.', 401);
      }

      // Volver a consultar de DB por si cambió el estado de mustChangePassword
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      if (!dbUser) {
        throw new AppError('Usuario no encontrado.', 404);
      }

      res.status(200).json({
        status: 'success',
        data: {
          id: dbUser.id,
          email: dbUser.email,
          role: dbUser.role,
          mustChangePassword: dbUser.mustChangePassword,
          createdAt: dbUser.createdAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Cambia la contraseña del usuario autenticado.
   */
  public static async changePassword(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const { currentPassword, newPassword } = req.body;

    try {
      const userReq = req.user;
      if (!userReq) {
        throw new AppError('No autenticado.', 401);
      }

      if (!currentPassword || !newPassword) {
        throw new AppError('La contraseña actual y la nueva son obligatorias.', 400);
      }

      if (newPassword.length < 8) {
        throw new AppError('La nueva contraseña debe tener al menos 8 caracteres.', 400);
      }

      // Buscar usuario en la base de datos para obtener el hash de contraseña actual
      const user = await prisma.user.findUnique({ where: { id: userReq.id } });
      if (!user) {
        throw new AppError('Usuario no encontrado.', 404);
      }

      // Validar contraseña actual
      const isPasswordValid = AuthController.verifyPassword(currentPassword, user.passwordHash);
      if (!isPasswordValid) {
        throw new AppError('La contraseña actual es incorrecta.', 400);
      }

      // Generar nuevo hash
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(newPassword, salt, 10000, 64, 'sha512').toString('hex');
      const passwordHash = `${salt}:${hash}`;

      // Actualizar usuario
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      });

      res.status(200).json({
        status: 'success',
        message: 'Contraseña actualizada con éxito.',
      });
    } catch (error) {
      return next(error);
    }
  }
}
