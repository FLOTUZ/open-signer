import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from './AppError';
import { env } from '../../config/env';

interface ErrorResponse {
  status: 'error' | 'fail';
  message: string;
  errors?: Record<string, string[]>;
  stack?: string;
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  const response: ErrorResponse = {
    status: 'error',
    message: 'Ha ocurrido un error inesperado en el servidor.',
  };

  // 1. Zod Validation Error
  if (err instanceof ZodError) {
    statusCode = 422; // Unprocessable Entity
    response.status = 'fail';
    response.message = 'Error de validación en los datos de la petición.';
    
    // Map Zod errors to a flat field -> message array structure
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const field = issue.path.join('.');
      if (!fieldErrors[field]) {
        fieldErrors[field] = [];
      }
      fieldErrors[field].push(issue.message);
    }
    response.errors = fieldErrors;
  } 
  // 2. Custom App Error (Operational)
  else if (err instanceof AppError) {
    statusCode = err.statusCode;
    response.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
    response.message = err.message;
    if (err.details) {
      response.errors = err.details as Record<string, string[]>;
    }
  }
  // 3. Multer Limit/Upload Errors
  else if (err.name === 'MulterError') {
    statusCode = 400;
    response.status = 'fail';
    response.message = `Error en la carga de archivos: ${err.message}`;
  }

  // Log critical errors (500s)
  if (statusCode === 500) {
    console.error('💥 UNHANDLED SYSTEM ERROR:', err);
  } else if (env.NODE_ENV === 'development') {
    console.warn(`⚠️ Client Error [${statusCode}]:`, err.message);
  }

  // Include stack trace only in development
  if (env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};
