import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/db";
import fs from "fs";
import path from "path";
import { SatSignatureService } from "./services/SatSignatureService";
import { startWebhookWorker } from "./services/WebhookWorker";
import { CrlWorkerService } from "./services/CrlWorkerService";

// ─── BLOQUEO DE ARRANQUE: Inicialización Criptográfica ───
function bootstrapCryptoRoots() {
  const certsDir = process.env.SAT_CERTS_DIR || "/app/certs/sat";
  const envMode = process.env.NODE_ENV;
  const satMode = process.env.SAT_REVOCATION_CHECK_MODE;

  // 0. Guardia Rígida contra Errores Humanos
  if (envMode === "production" && satMode && satMode !== "production") {
    console.error(
      `[❌ ERROR CRÍTICO] Intentando arrancar en PRODUCCIÓN con simulación de revocación SAT activa (${satMode}). ESTO ES UN RIESGO DE SEGURIDAD.`,
    );
    process.exit(1);
  }

  try {
    if (!fs.existsSync(certsDir)) {
      throw new Error(
        `El directorio de certificados no existe en la ruta: ${certsDir}`,
      );
    }

    const files = fs.readdirSync(certsDir);
    const cerFiles = files.filter(
      (file) =>
        file.toLowerCase().endsWith(".cer") ||
        file.toLowerCase().endsWith(".crt"),
    );

    if (cerFiles.length === 0) {
      throw new Error(`No se encontraron archivos .cer o .crt en ${certsDir}.`);
    }

    const rootBuffers = cerFiles.map((file) =>
      fs.readFileSync(path.join(certsDir, file)),
    );
    SatSignatureService.initTrustedRoots(rootBuffers);

    console.log(
      `[🔒 CRIPTO] Cadena de confianza inicializada: ${rootBuffers.length} certificados SAT cargados.`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[❌ ERROR CRÍTICO] Fallo en la PKI: ${msg}`);
    // Si la seguridad falla al arrancar, la aplicación debe morir. Sin excepciones.
    process.exit(1);
  }
}

// Ejecutar la validación criptográfica ANTES de abrir el puerto
bootstrapCryptoRoots();

const server = app.listen(env.PORT, () => {
  const baseUrl = `${env.DOMAIN}`;

  console.log(`🚀 Servidor ejecutándose en ${baseUrl}`);
  console.log(`📄 Documentación API disponible en ${baseUrl}/docs`);
  // Iniciar el worker de webhooks integrado en el proceso principal
  startWebhookWorker();

  // Iniciar el worker de sincronización de CRL (Listas de Revocación)
  CrlWorkerService.start();
});

const gracefulShutdown = async (signal: string) => {
  console.log(
    `\n⚠️ Recibido ${signal}. Cerrando el servidor de forma ordenada...`,
  );

  server.close(async () => {
    console.log("💤 Servidor HTTP cerrado.");
    try {
      await prisma.$disconnect();
      console.log("🔌 Conexión a base de datos (Prisma) cerrada.");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error al desconectar base de datos:", error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("💥 Forzando apagado del sistema.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  console.error("💥 UNCAUGHT EXCEPTION! Apagando...", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 UNHANDLED REJECTION! Apagando...", reason);
  process.exit(1);
});
