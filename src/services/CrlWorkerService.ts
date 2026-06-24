import cron from 'node-cron';
import { prisma } from '../config/db';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export class CrlWorkerService {
  // Almacén de URLs de CRL descubiertas. (En una app real multicapa esto iría a Redis o DB, aquí lo mantenemos en memoria/DB).
  private static knownCrlUrls: Set<string> = new Set();

  /**
   * Añade una URL a la lista de CRLs conocidos para ser procesada por el Worker.
   * También lanza un sync inmediato en background si es la primera vez que se ve y no se ha sincronizado hoy.
   */
  public static async registerCrlUrl(url: string) {
    if (!this.knownCrlUrls.has(url)) {
      this.knownCrlUrls.add(url);
      console.log(`[🔄 CRL] Nueva URL de CRL registrada para sincronización: ${url}`);
      // Lanza sincro en tiempo real para evitar rechazo de la primera firma
      try {
        await this.syncUrl(url);
      } catch (err) {
        console.error(`[❌ CRL] Fallo al sincronizar nueva CRL ${url}:`, err);
      }
    }
  }

  /**
   * Inicializa el Worker que corre cada 12 horas.
   */
  public static start() {
    if (process.env.NODE_ENV !== 'production' && process.env.SAT_REVOCATION_CHECK_MODE === 'disabled') {
      console.log("[🔄 CRL Worker] Deshabilitado por configuración DEV.");
      return;
    }

    console.log("[🔄 CRL Worker] Iniciado. Sincronizará las CRLs registradas cada 12 horas.");
    
    // Ejecutar cada 12 horas (a las 00:00 y 12:00)
    cron.schedule('0 0,12 * * *', async () => {
      console.log("[🔄 CRL Worker] Iniciando tarea programada de sincronización masiva...");
      for (const url of this.knownCrlUrls) {
        try {
          await this.syncUrl(url);
        } catch (error) {
          console.error(`[❌ CRL Worker] Fallo en la sincronización de ${url}:`, error);
        }
      }
      console.log("[🔄 CRL Worker] Tarea programada finalizada.");
    });
  }

  /**
   * Descarga y parsea una URL de CRL específica, y la inserta en la base de datos usando upsert masivo.
   */
  public static async syncUrl(url: string) {
    console.log(`[🔄 CRL Worker] Sincronizando: ${url}`);
    
    const tmpFile = path.join(os.tmpdir(), `sat_crl_${Date.now()}.crl`);
    let recordsCount = 0;

    try {
      // 1. Descargar el archivo CRL con headers para evitar WAF (403 Forbidden)
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*'
        }
      });
      if (!response.ok) {
        throw new Error(`Error HTTP al descargar CRL: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(tmpFile, Buffer.from(arrayBuffer));

      // 2. Parsear el archivo usando OpenSSL para evitar colapsar la memoria de Node.js con listas masivas
      // El SAT puede emitir CRLs gigantes. Extraemos los números de serie usando awk/grep.
      const command = `openssl crl -inform DER -in ${tmpFile} -text -noout | grep "Serial Number:" | awk '{print $3}'`;
      
      const { stdout } = await execPromise(command, { maxBuffer: 1024 * 1024 * 50 }); // 50MB buffer para stdout
      
      const serials = stdout.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      recordsCount = serials.length;

      console.log(`[🔄 CRL Worker] Parseo completado. ${recordsCount} certificados revocados encontrados en ${url}.`);

      // 3. Insertar en la BD en lotes (chunks) para no saturar Prisma/Postgres
      const chunkSize = 10000;
      for (let i = 0; i < serials.length; i += chunkSize) {
        const chunk = serials.slice(i, i + chunkSize);
        
        // Upsert masivo (Postgres soporta INSERT ON CONFLICT)
        // Como Prisma no tiene upsertMany nativo sin conflictos, usamos createMany con skipDuplicates
        await prisma.revokedCertificate.createMany({
          data: chunk.map(serial => ({
            serialNumber: serial,
            revocationDate: new Date(), // Idealmente extraeríamos la fecha exacta de openssl, pero new Date() es un buen aproximado para caché.
          })),
          skipDuplicates: true,
        });
      }

      // 4. Registrar éxito en el Log
      await prisma.crlSyncLog.create({
        data: {
          status: 'SUCCESS',
          recordsCount,
        }
      });

      console.log(`[✅ CRL Worker] Sincronización exitosa guardada en BD. URL: ${url}`);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await prisma.crlSyncLog.create({
        data: {
          status: 'FAILED',
          error: msg,
        }
      });
      throw error;
    } finally {
      // Limpiar archivo temporal
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  }
}
