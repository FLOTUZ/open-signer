import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DOMAIN: z.string().default("localhost"),
  PORT: z.coerce.number().default(3000),
  // Sin valor por defecto inseguro: si no se declara explícitamente, se asume
  // "production" (el modo más estricto) para evitar que un despliegue real
  // arranque accidentalmente con las validaciones de desarrollo relajadas.
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("production"),
  DATABASE_URL: z.string().url(),
  // Obligatorio y con longitud mínima: firma los tokens de sesión y las URLs
  // de descarga temporal. Nunca debe depender de un valor de respaldo.
  JWT_SECRET: z
    .string({ required_error: "JWT_SECRET es obligatorio." })
    .min(32, "JWT_SECRET debe tener al menos 32 caracteres aleatorios."),
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // Endpoint S3-compatible (ej. RustFS/MinIO en local). Si no se define, se usa AWS S3 real.
  AWS_S3_ENDPOINT: z.string().optional(),
  // Endpoint público para las presigned URLs que recibe el navegador (ej.
  // http://localhost:9010). Si no se define, se usa AWS_S3_ENDPOINT. Necesario
  // cuando el backend habla con S3-compatible por un hostname interno de Docker
  // (ej. http://rustfs:9000) que el navegador del usuario no puede resolver.
  AWS_S3_PUBLIC_ENDPOINT: z.string().optional(),
  LOCAL_STORAGE_PATH: z.string().default("./uploads"),
  // Credenciales del Super Admin auto-creado en el primer login (DB vacía).
  SUPER_ADMIN_EMAIL: z.string().email().default("admin@opensigner.com"),
  SUPER_ADMIN_PASSWORD: z.string().min(8).default("admin12345"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Error de configuración. Variables de entorno inválidas:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
