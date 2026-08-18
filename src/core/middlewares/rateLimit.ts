import rateLimit from 'express-rate-limit';

/**
 * Límite estricto para endpoints de autenticación (login, cambio de contraseña).
 * Mitiga fuerza bruta y credential stuffing contra cuentas de usuario.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Demasiados intentos. Intenta de nuevo en unos minutos.',
  },
});

/**
 * Límite para endpoints públicos del flujo de firma (validación de certificado,
 * completar firma). Son rutas sin autenticación por diseño, por lo que necesitan
 * su propio control de abuso.
 */
export const publicSignatureRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.',
  },
});
