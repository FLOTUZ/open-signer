import { Request, Response, NextFunction } from 'express';
import { AnyZodObject } from 'zod';

export const validate = (schema: AnyZodObject) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
            const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
        files: req.files,
      });
      
      // Update request object with validated/formatted schema values
      if (parsed.body !== undefined) {
        req.body = parsed.body;
      }
      if (parsed.query !== undefined) {
        req.query = parsed.query;
      }
      if (parsed.params !== undefined) {
        req.params = parsed.params;
      }
      if (parsed.files !== undefined) {
        req.files = parsed.files as any;
      }
      
      return next();
    } catch (error) {
      return next(error);
    }
  };
};
