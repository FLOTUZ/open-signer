# Microservicio de Firma Electrónica (SAT MX)

Este repositorio contiene la **Iteración 3** de la base del backend y panel frontend del microservicio de firma digital basado en la **e.firma (SAT México)**.

La plataforma se compone de:
1.  **Backend (API-first):** Express + TypeScript + Prisma (RDS Postgres) + AWS S3.
2.  **Frontend (SPA Admin & Client):** React + TypeScript + Vanilla CSS (Avanzado, minimalista y responsivo).

---

## 🆕 Modo de Firma por Webhooks (Client-Side Crypto — Zero Trust)

> **Propósito legal:** En el modelo anterior, el servidor recibía la `.key` y firmaba *en nombre del usuario*, lo que legalmente implica "el sistema firmó por mí". Con el nuevo mecanismo, la llave privada **nunca abandona el navegador del usuario**. El servidor solo recibe la firma ya generada — la responsabilidad recae inequívocamente en el firmante.

### Arquitectura del flujo

```
Integrador                Backend                 Usuario (Navegador)
─────────                 ───────                 ───────────────────
POST /signatures/request  →  Crea SignatureRequest  →
← signUrl  ──────────────────────────────────────── ← Redirige al usuario
                                                     Carga contexto del doc
                                                     Sube .cer + .key + contraseña
                                                     [Descifra .key con node-forge]
                                                     [Firma hash con Web Crypto API]
                                                     POST /signatures/complete →
                          Valida .cer (cadena SAT)
                          Obtiene NOM-151 (PSC opt.)
                          Actualiza → SIGNED
                          Encola WebhookJob
                          ← redirectUrl
                                                     window.location = redirectUrl
Integrador recibe POST webhook ←────────────────────
```

### Endpoints del nuevo mecanismo

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/v1/signatures/request` | API Key | Crea sesión de firma, retorna `signUrl` |
| `GET`  | `/api/v1/signatures/request/:id/context` | Público | El frontend carga el contexto del documento |
| `POST` | `/api/v1/signatures/complete` | Público | Recibe firma + `.cer` (nunca la `.key`) |
| `GET`  | `/api/v1/signatures/requests` | API Key | Lista historial con estado de webhooks |

### Variables de entorno opcionales

```env
# URL del frontend de firma (donde vive la ruta /firmar/:id)
FRONTEND_URL=https://firma.tudominio.com

# URL del PSC para obtener el sello NOM-151 (opcional — si no se configura, nom151Stamp queda null)
PSC_URL=https://api.tu-psc.com/nom151/stamp
```

### Variables de entorno de Firma y Revocación (Seguridad)

```env
# Directorio donde el backend buscará los certificados Raíz e Intermedios oficiales del SAT
# En Producción (Docker), esto suele mapearse a "/app/certs/sat".
# SAT_CERTS_DIR="/app/certs/sat"

# Modo del Simulador de Verificación de Revocación (OCSP/CRL)
# En Producción DEBE ser "production" o no existir. Si pones un mock_ en producción, el servidor crasheará por seguridad.
# Valores de prueba: mock_good, mock_revoked, mock_timeout, mock_sat_down, disabled
SAT_REVOCATION_CHECK_MODE="production"
```

> **Nota sobre Listas de Revocación (CRL):** El sistema extrae *dinámicamente* las URLs de revocación (AIA/CDP) incrustadas dentro de cada archivo `.cer` que los usuarios suben. No existe una "URL maestra" única. Si usas el panel de administración para sincronizar una lista manualmente y el backend arroja un error `EAI_AGAIN` (falla de resolución DNS), significa que el dominio ingresado no existe o fue dado de baja (ej. dominios antiguos como `ccg.sat.gob.mx`). Usa URLs válidas como `http://www.sat.gob.mx/crl` para pruebas manuales.

### Panel de Webhooks en el Dashboard del Cliente

En el dashboard del cliente existe la pestaña **"Webhooks & Firma Segura"** que permite:
- Pegar tu API Key para la sesión actual.
- Crear solicitudes de firma de prueba con cualquier documento.
- Ver el link `/firmar/{id}` generado para compartir con el usuario.
- Monitorear el estado de entrega de los webhooks (PENDING / SUCCESS / FAILED) con información de reintentos.
- Consultar la guía de integración con ejemplos de código.

### Worker de Webhooks (Backoff Exponencial)

El worker corre integrado en el proceso del servidor y revisa los jobs pendientes cada 30 segundos:
- **Intento 1** → Inmediato
- **Intento 2** → Reintento en 1 minuto
- **Intento 3** → Reintento en 5 minutos
- **Intento 4** → Reintento en 1 hora
- **Intento 5+** → `FAILED` definitivo

Las sesiones de firma con status `PENDING` que superen su `expiresAt` (24 horas) se marcan automáticamente como `EXPIRED`.

---



*   **Cero Retención de Credenciales (Memory-only):** Los certificados (`.cer`), llave privada (`.key`) y contraseña de firma se procesan estrictamente en memoria (RAM Buffer) usando las APIs de Node.js `crypto`. Todos los buffers son sobreescritos con ceros (`buffer.fill(0)`) en bloques `finally` inmediatamente después de procesarse la firma digital.
*   **Validación Defensiva (Zod):** Datos de entrada y archivos estructurados validados rigurosamente en la frontera del API. Los errores de validación de Zod se transforman a respuestas HTTP `422` detalladas por campo.
*   **Autenticación Hibrida:**
    *   **Dashboard Frontend:** Autenticación por tokens de sesión firmados con HMAC-SHA256 generados nativamente sin dependencias extras.
    *   **Integración de Sistemas Externos:** Autenticación mediante API Key hasheada en SHA-256 (`x-api-key` en headers).
*   **Auditoría del Sistema (AuditLogs):** Registro automático y asíncrono de todas las llamadas que modifiquen el estado en el sistema.

---

## 2. Requisitos Previos

*   **Node.js** >= 18.0.0
*   **npm** >= 9.0.0
*   **PostgreSQL** (para producción, o un URL PostgreSQL para compilar el cliente de Prisma).

---

## 3. Configuración del Proyecto

### 3.1 Backend Setup

1.  **Instalar dependencias del root (Backend):**
    ```bash
    npm install
    ```
2.  **Configurar Variables de Entorno:**
    Copia el archivo `.env.example` como `.env` y configura el puerto y conexión de base de datos.
    ```bash
    cp .env.example .env
    ```
3.  **Generar Cliente de Prisma y Ejecutar Migraciones:**
    Para que las migraciones y herramientas CLI de Prisma funcionen directamente desde tu terminal host (fuera del contenedor Docker) en entornos Linux usando la cadena de conexión basada en `host.docker.internal` del archivo `.env`, debes mapear ese hostname a tu localhost agregándolo al archivo `/etc/hosts`:
    ```bash
    echo "127.0.0.1 host.docker.internal" | sudo tee -a /etc/hosts
    ```
    Una vez configurado este mapeo, puedes generar el cliente de Prisma y ejecutar las migraciones nativamente:
    ```bash
    npx prisma generate
    npx prisma migrate dev
    ```
4.  **Ejecutar Servidor de Desarrollo:**
    ```bash
    npm run dev
    ```

### 3.2 Frontend Setup

1.  **Navegar a la carpeta frontend:**
    ```bash
    cd frontend
    ```
2.  **Instalar dependencias:**
    ```bash
    npm install
    ```
3.  **Ejecutar Servidor de Desarrollo:**
    ```bash
    npm run dev
    ```
    El panel del frontend estará disponible en `http://localhost:5173`.

### 3.3 Docker Compose (Recomendado)

**CRÍTICO:** Por arquitectura de seguridad, la aplicación abortará su arranque si no encuentra la cadena de confianza pública del SAT. Los certificados no se incluyen en la imagen Docker ni en el repositorio. Deben residir en el host.

1. **Instalar los certificados con el script automatizado (recomendado):**

   El repositorio incluye `scripts/install-sat-certs.sh`, que descarga el paquete oficial de certificados del SAT, lo extrae y lo instala con los permisos correctos en `/etc/sat-certs`. Se ejecuta **una sola vez por servidor**, antes del primer `docker compose up`:

   ```bash
   chmod +x scripts/install-sat-certs.sh
   sudo ./scripts/install-sat-certs.sh
   ```

   En la primera corrida, el script calcula el SHA256 del archivo descargado y te pide una confirmación manual única antes de continuar (el SAT sirve este paquete por `http://`, sin TLS, así que esta verificación es tu única defensa real contra manipulación en tránsito). El hash queda guardado en `/etc/sat-certs.sha256`.

   En corridas futuras (por ejemplo, en un servidor nuevo) el script verifica automáticamente contra ese hash guardado, sin pedirte nada ni requerir que edites el script. Si el SAT llega a rotar sus certificados raíz, el script se detendrá con una alerta; en ese caso, confirma el cambio y borra `/etc/sat-certs.sha256` para registrar el nuevo hash de confianza.

   Ver `docs/sat-certs.md` para más detalle sobre este flujo, su integración con Dokploy, certificados de prueba para desarrollo, y un TODO pendiente sobre soporte a CSD (Certificados de Sello Digital).

2. **Instalación manual (alternativa):**

   Si prefieres no usar el script, puedes instalar los certificados manualmente:

   ```bash
   sudo mkdir -p /etc/sat-certs
   ```

   Sube únicamente los archivos `.cer` (Raíces e Intermedios del SAT, descargables desde el [portal de trámites del SAT](http://omawww.sat.gob.mx/tramitesyservicios/Paginas/certificado_sello_digital.htm)) al directorio `/etc/sat-certs/`. No incluyas archivos `.key` ni `.zip`.

   Bloquea los permisos en el host para evitar manipulación por terceros:
   ```bash
   sudo chmod 755 /etc/sat-certs
   sudo chmod 644 /etc/sat-certs/*.cer
   ```
Para iniciar el Backend y el Frontend en contenedores Docker leyendo la configuración del archivo `.env` y conectándose a tu base de datos externa (tu PostgreSQL local nativo o AWS RDS):

1. Asegúrate de configurar el archivo `.env` en la raíz. Para conectar a una base de datos PostgreSQL nativa en tu máquina local desde los contenedores, usa la dirección especial `host.docker.internal`:
   ```env
   DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/signature_db?schema=public"
   ```
   *Nota: Cuando migres a AWS RDS, simplemente cambia este URL en tu `.env` por la cadena de conexión de tu RDS.*

2. Ejecuta Docker Compose:
   ```bash
   docker compose up --build
   ```

Esto levantará:
*   **Backend:** Disponible en `http://localhost:5000` (conectado a tu base de datos externa).
*   **Frontend (React Nginx):** Disponible en `http://localhost:5001`.

### 3.4 Ejecutar usando GitHub Container Registry (GHCR)

Si prefieres no compilar las imágenes localmente (y por lo tanto no necesitas el código fuente ni Node.js), puedes descargar y ejecutar directamente las imágenes públicas pre-compiladas desde el Container Registry. 

```bash
# Backend
docker run -d --name opensigner-backend -p 5000:5000 \
  --env-file .env \
  -v /etc/sat-certs:/app/certs/sat \
  ghcr.io/flotuz/opensigner-backend:latest

# Frontend
docker run -d --name opensigner-frontend -p 5001:80 \
  ghcr.io/flotuz/opensigner-frontend:latest
```

*(Asegúrate de haber configurado tu archivo `.env` y el directorio de certificados en el host como se menciona en los pasos anteriores).*

---

## 4. Cuenta Inicial (Auto-Seeding)

Para facilitar la primera puesta en marcha:
Si la base de datos de usuarios está vacía, al intentar iniciar sesión en el frontend se auto-creará una cuenta inicial de Super Administrador con las siguientes credenciales:

*   **Correo Electrónico:** `admin@opensigner.com`
*   **Contraseña:** `admin12345`

*¡Inicia sesión con estas credenciales para empezar a crear clientes!*

---

## 5. Documentación y Flujo de Uso

1.  **Login de Super Admin:** Inicia sesión como `admin@opensigner.com` en `http://localhost:5001` y crea una cuenta de cliente (ej. `cliente@opensigner.com`).
2.  **Dashboard del Cliente:** Inicia sesión con la cuenta de cliente creada, haz clic en **Generar Nueva API Key** y guárdala.
3.  **Integración Externa (Firmar):** Utiliza la API Key en el header `x-api-key` enviando una petición HTTP Multipart a `/api/v1/signatures/sign` con tu certificado `.cer`, clave `.key`, clave de firma y el documento.
4.  **Bitácora de Auditoría:** Toda acción mutante quedará registrada para que el Super Admin la monitoree desde su panel.
5.  **Swagger UI:** Toda la especificación OpenAPI de los endpoints está interactiva en `http://localhost:5000/docs`.

---

## 6. Configuración de AWS S3 (Almacenamiento en Producción)

Por defecto el sistema guarda documentos en `./uploads` (fallback local). Para activar S3 en producción, sigue estos pasos.

### 6.1 Crear el Bucket S3

1. Abre la [Consola de AWS → S3](https://s3.console.aws.amazon.com/s3/).
2. Haz clic en **Create bucket**.
3. Configura:
   - **Bucket name:** `opensigner-prod` (elige un nombre único global).
   - **AWS Region:** la misma región que tu servidor de aplicación (ej. `us-east-1` o `sa-east-1`).
   - **Block all public access:** ✅ **Activado** (el bucket debe ser **privado**). Los documentos nunca serán públicos; el acceso se controla mediante presigned URLs temporales (TTL 15 min) generadas por el backend.
   - **Versioning:** Opcional. Recomendado activarlo para tener historial de documentos.
   - **Server-side encryption:** Activar **SSE-S3** o **SSE-KMS** según tu política de seguridad.
4. Haz clic en **Create bucket**.

### 6.2 Crear Usuario IAM con acceso mínimo

> [!CAUTION]
> Nunca uses las credenciales raíz (`root`) de tu cuenta AWS. Crea un usuario IAM con permisos mínimos.

1. Ve a **IAM → Users → Create user**.
2. Nombre: `opensigner` (o el que prefieras).
3. En **Permissions**, selecciona **Attach policies directly** y crea una política inline con el siguiente JSON (reemplaza `TU_BUCKET` con el nombre real):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowUpload",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::TU_BUCKET/*"
    },
    {
      "Sid": "AllowPresignedDownload",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::TU_BUCKET/*"
    }
  ]
}
```

4. Crea el usuario y ve a **Security credentials → Create access key**.
5. Selecciona el caso de uso **Application running outside AWS**.
6. Guarda el `Access Key ID` y el `Secret Access Key` — **se muestran una sola vez**.

### 6.3 Configurar Variables de Entorno

Edita tu `.env` con los datos obtenidos en los pasos anteriores:

```env
AWS_REGION=us-east-1              # Región del bucket
AWS_S3_BUCKET=opensigner
AWS_ACCESS_KEY_ID=AKIA...         # Del paso 6.2
AWS_SECRET_ACCESS_KEY=abc123...   # Del paso 6.2
JWT_SECRET=una-clave-larga-y-aleatoria-para-tokens
```

> [!IMPORTANT]
> El archivo `.env` está en `.gitignore`. **Nunca lo subas a un repositorio.** En producción (EC2, ECS, etc.) inyecta estas variables como variables de entorno del sistema operativo o a través de AWS Secrets Manager.

### 6.4 Comportamiento según configuración

| Variable `AWS_S3_BUCKET` | Almacenamiento | URL de descarga |
|---|---|---|
| **Vacía** (desarrollo) | Sistema de archivos local `./uploads` | Token HMAC interno con TTL 15 min vía `/api/v1/documents/local-download` |
| **Configurada** (producción) | AWS S3 (bucket privado) | Presigned URL nativa de AWS con TTL 15 min |

En ambos casos el endpoint `GET /api/v1/documents/:documentId/download-url` devuelve la URL temporal correcta automáticamente.

### 6.5 Ejecutar migraciones en producción

```bash
# Desde el host (con la URL de RDS en .env):
DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/dbname?schema=public" \
  npx prisma migrate deploy
```

---

## 7. Ejecución de Migraciones de Base de Datos

### Desarrollo local (con Docker + Postgres nativo)

Agrega `host.docker.internal` a `/etc/hosts` para que Prisma pueda alcanzar tu Postgres local desde fuera del contenedor:

```bash
echo "127.0.0.1 host.docker.internal" | sudo tee -a /etc/hosts
```

Ejecuta la migración usando la URL de tu `.env`:

```bash
DATABASE_URL="postgresql://postgres:TU_PASSWORD@localhost:5432/opensigner?schema=public" \
  npx prisma migrate dev
```

### Producción (AWS RDS u otro Postgres)

```bash
DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/dbname?schema=public" \
  npx prisma migrate deploy
```

---

## 8. Despliegue en Dokploy

Dokploy es un gestor de despliegue auto-hospedado basado en Docker. Para este proyecto, el flujo de producción recomendado compila las imágenes Docker mediante **GitHub Actions**, las publica en **GitHub Container Registry (GHCR)** y luego le notifica a **Dokploy** para que redespliegue utilizando las nuevas imágenes.

### 8.1 Registrar las aplicaciones en Dokploy (Usando Docker Registry)

Dado que las imágenes se construyen y suben a GHCR de forma externa, en Dokploy debes registrar el Backend y el Frontend apuntando a tu registro:

#### 1. Registrar el Backend (API) en Dokploy
1. En tu panel de Dokploy, crea una aplicación de tipo **Application**.
2. En la sección de configuración de origen, selecciona **Docker Registry** (en lugar de GitHub/Git).
3. Configura:
   - **Registry**: GitHub Container Registry (`ghcr.io`).
   - **Image**: `ghcr.io/flotuz/opensigner-backend:latest` (o tu usuario si hiciste un fork).
4. En la pestaña **Environment**, define las variables necesarias (`DATABASE_URL`, `JWT_SECRET`, `PORT=5000`, etc.).
5. En la pestaña **Advanced**, en la sección de Volúmenes (Bind Mounts), agrega la ruta de los certificados:
   - **Host Path**: `/etc/sat-certs`
   - **Mount Path**: `/app/certs/sat`
   *(Sin este volumen, el contenedor fallará al arrancar por seguridad).*
6. Asigna tu dominio (ej. `api.tudominio.com`) al puerto expuesto por el contenedor (`5000`).

#### 2. Registrar el Frontend (Nginx SPA) en Dokploy
1. Crea otra aplicación de tipo **Application** en Dokploy.
2. En origen, selecciona **Docker Registry**.
3. Configura:
   - **Registry**: GitHub Container Registry (`ghcr.io`).
   - **Image**: `ghcr.io/TU_USUARIO_DE_GITHUB/opensigner-frontend:latest`
4. Asigna tu dominio público (ej. `firma.tudominio.com`) al puerto `80` (puerto estándar de Nginx que sirve la SPA).

---

## 9. Configuración de CI/CD con GitHub Actions (GHCR + Dokploy)

El repositorio cuenta con un pipeline automatizado en `.github/workflows/deploy.yml` que valida el código, compila las aplicaciones, crea las imágenes Docker, las sube a GHCR y le avisa a Dokploy mediante Webhook.

### Pasos de Configuración:

1. **Obtener el Webhook de despliegue en Dokploy**:
   - En tu panel de Dokploy, ve a cada una de tus aplicaciones creadas (Backend y Frontend).
   - Ve a la pestaña **Deployments** o **Settings** y copia el **Deploy Webhook URL**.
   - Si deseas redesplegar ambas a la vez, puedes usar el webhook de la aplicación principal o crear un webhook multicanal en tu Dokploy.
2. **Configurar Secretos en tu Repositorio de GitHub**:
   - Ve a tu repositorio en GitHub → **Settings** → **Secrets and variables** → **Actions**.
   - Agrega los siguientes secretos:
     - `DOKPLOY_WEBHOOK_URL`: Pega la URL del webhook de Dokploy (para notificar del redespliegue).
     - `VITE_API_URL`: Configura el endpoint de API de producción (ej. `https://api.tudominio.com/api/v1`). Este valor se inyecta como `build-arg` durante la compilación de la imagen de Docker del Frontend para que la SPA consuma el endpoint correcto.
3. **Funcionamiento del Pipeline**:
   - Al hacer `git push` a `main`:
     1. Se validan e instalan las dependencias locales.
     2. Se ejecuta la validación de compilación tanto del backend como del frontend.
     3. GitHub Actions inicia sesión en **GHCR** usando el token nativo `${{ secrets.GITHUB_TOKEN }}`.
     4. Construye y empuja las imágenes `opensigner-backend` e `opensigner-frontend` taggeadas como `latest`.
     5. Realiza un POST al webhook de Dokploy (`DOKPLOY_WEBHOOK_URL`), indicándole al servidor VPS que descargue las nuevas imágenes de GHCR y las redespliegue inmediatamente.