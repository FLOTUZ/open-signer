import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../config/db";
import { AppError } from "../core/errors/AppError";
import { Role } from "@prisma/client";

export class AdminController {
  /**
   * Crea un nuevo usuario cliente en el sistema.
   */
  public static async createUser(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { name, email, password, role } = req.body;

    try {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new AppError("El correo electrónico ya está registrado.", 409);
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto
        .pbkdf2Sync(password, salt, 10000, 64, "sha512")
        .toString("hex");
      const passwordHash = `${salt}:${hash}`;

      const userRole = role === "SUPER_ADMIN" ? Role.SUPER_ADMIN : Role.CLIENT;

      const user = await prisma.user.create({
        data: {
          name: name ?? null,
          email,
          passwordHash,
          role: userRole,
          mustChangePassword: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          mustChangePassword: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        status: "success",
        message: "Usuario creado con éxito.",
        data: user,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Genera una nueva API Key para un cliente específico.
   */
  public static async createApiKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { clientId } = req.body;

    try {
      const user = await prisma.user.findUnique({ where: { id: clientId } });
      if (!user) {
        throw new AppError("El usuario cliente especificado no existe.", 404);
      }

      const rawApiKey = `opensigner-${crypto.randomBytes(24).toString("hex")}`;
      const hashedKey = crypto
        .createHash("sha256")
        .update(rawApiKey)
        .digest("hex");

      const apiKeyRecord = await prisma.apiKey.create({
        data: {
          hash: hashedKey,
          clientId,
          status: "ACTIVE",
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        status: "success",
        message:
          "API Key generada con éxito. Guarde esta clave, no podrá volver a verla.",
        data: {
          id: apiKeyRecord.id,
          apiKey: rawApiKey,
          status: apiKeyRecord.status,
          createdAt: apiKeyRecord.createdAt,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Invalida la contraseña de un usuario y genera una nueva temporal.
   * La contraseña temporal se devuelve en texto plano UNA SOLA VEZ.
   */
  public static async resetUserPassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { userId } = req.params;

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new AppError("El usuario especificado no existe.", 404);
      }

      // Generar contraseña temporal aleatoria de 12 caracteres (alfanumérica)
      const tempPassword = crypto
        .randomBytes(9)
        .toString("base64url")
        .slice(0, 12);

      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto
        .pbkdf2Sync(tempPassword, salt, 10000, 64, "sha512")
        .toString("hex");
      const passwordHash = `${salt}:${hash}`;

      await prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: true,
        },
      });

      res.status(200).json({
        status: "success",
        message: `Contraseña restablecida para ${user.email}. Comparte esta contraseña temporal de forma segura. El usuario deberá cambiarla en su próximo ingreso.`,
        data: {
          userId: user.id,
          email: user.email,
          temporaryPassword: tempPassword,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Obtiene la bitácora de auditoría con paginación y filtros.
   */
  public static async getAuditLogs(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)),
      );
      const skip = (page - 1) * limit;

      const roleFilter = req.query.role as string | undefined;
      const methodFilter = req.query.method as string | undefined;
      const search = req.query.search as string | undefined;

      // Build dynamic where clause
      const where: Record<string, unknown> = {};

      if (roleFilter && ["SUPER_ADMIN", "CLIENT"].includes(roleFilter)) {
        where.role = roleFilter as Role;
      }

      if (
        methodFilter &&
        ["GET", "POST", "PUT", "DELETE"].includes(methodFilter)
      ) {
        where.method = methodFilter;
      }

      if (search && search.trim()) {
        where.OR = [
          { username: { contains: search.trim(), mode: "insensitive" } },
          { endpoint: { contains: search.trim(), mode: "insensitive" } },
          { description: { contains: search.trim(), mode: "insensitive" } },
        ];
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: "desc" },
          skip,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.status(200).json({
        status: "success",
        data: logs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Obtiene la lista de todos los usuarios registrados.
   */
  public static async getUsers(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          mustChangePassword: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({
        status: "success",
        results: users.length,
        data: users,
      });
    } catch (error) {
      return next(error);
    }
  }
}
