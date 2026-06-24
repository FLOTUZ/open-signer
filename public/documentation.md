# Documentación del API — OpenSigner

Esta documentación técnica detalla todos los recursos y endpoints expuestos para las **Integraciones del Microservicio de Firma Electrónica (e.firma SAT MX)**.

---

## 1. Esquema de Autenticación

El microservicio utiliza dos esquemas de autenticación según el canal de interacción:

### A. Autenticación por Panel Web (JWT Bearer Token)
Se utiliza para las operaciones del panel web del cliente.
*   **Header:** `Authorization: Bearer <TOKEN>`
*   **Origen:** Obtenido a través del endpoint `/api/v1/auth/login`.

### B. Autenticación de Integración Externa (API Key)
Se utiliza para realizar firmas, listar documentos y obtener descargas desde sistemas externos.
*   **Header:** `x-api-key: <API_KEY>`
*   **Origen:** Generada por el cliente desde su panel web.

---

## 2. Modelos de Datos (Schemas)

### SignedDocument
```json
{
  "id": "String (UUID)",
  "documentHash": "String (SHA-256 del documento original)",
  "signatureString": "String (Firma RSA en Base64)",
  "signerName": "String | null",
  "signerRfc": "String | null",
  "cadenaOriginal": "String | null",
  "stampedS3Url": "String | null (URL del documento estampado)",
  "verificationUrl": "String (URL pública de verificación del sello)",
  "qrCodeUrl": "String (QR en formato Data-URL base64 png)",
  "createdAt": "String (ISO Date-Time)"
}
```

---

## 3. Endpoints de la API

### ✍️ Firma Digital (API Key)

#### `POST /api/v1/signatures/sign`
Firma un documento mediante la e.firma del SAT (certificado `.cer` y llave privada `.key`).
*   **Autenticación:** API Key (`x-api-key` en headers).
*   **Request Body (`multipart/form-data`):**
    - `documento` (Archivo binario, máx. 20 MB)
    - `certificado` (Archivo `.cer` binario de la e.firma)
    - `llave` (Archivo `.key` privado binario de la e.firma)
    - `password` (Contraseña de la llave privada)
    - `cadenaOriginal` (Cadena de datos original a firmar)
*   **Responses:**
    *   **201 Created:** Objeto `SignedDocument` que contiene el hash del documento, la firma digital y los metadatos del firmante (Nombre y RFC).
    *   **400 Bad Request:** Contraseña de llave incorrecta o estructura de certificados inválida.

#### `GET /api/v1/signatures/verify/{documentId}`
Endpoint público para verificar el estado de una firma y ver los metadatos del sello digital.
*   **Autenticación:** Ninguna (Público).
*   **Path Params:** `documentId` (UUID).
*   **Responses:**
    *   **200 OK:** Metadatos de la firma del documento (`SignedDocument`).

---

### 📂 Gestión de Documentos (API Key)

#### `GET /api/v1/api/documents`
Lista los documentos firmados correspondientes al cliente dueño de la API Key.
*   **Autenticación:** API Key (`x-api-key` en headers).
*   **Query Params:**
    - `page` (default `1`)
    - `limit` (default `20`)
*   **Responses:**
    *   **200 OK:** Lista paginada de documentos firmados.

#### `GET /api/v1/documents/{documentId}/download-url`
Genera una URL temporal con vencimiento de 15 minutos para la descarga de un documento.
*   **Autenticación:** API Key (`x-api-key` en headers).
*   **Path Params:** `documentId` (UUID).
*   **Query Params:**
    - `type` (Opcional): Si se define como `stamped` (`?type=stamped`), el endpoint generará la URL temporal del **documento estampado** (con sello visual) en lugar de la del documento original.
*   **Responses:**
    *   **200 OK:**
        ```json
        {
          "status": "success",
          "data": {
            "documentId": "uuid",
            "url": "https://bucket.s3.aws.com/...",
            "expiresAt": "date-time"
          }
        }
        ```

#### `POST /api/v1/documents/{documentId}/stamp`
Almacena opcionalmente la versión "estampada" del documento firmado (usualmente un PDF que contiene la representación gráfica de la firma o sello).
*   **Autenticación:** API Key (`x-api-key` en headers).
*   **Path Params:** `documentId` (UUID).
*   **Request Body (`multipart/form-data`):**
    - `stamped` (Archivo estampado binario, máx. 20 MB)
*   **Responses:**
    *   **200 OK:** Documento estampado guardado exitosamente en S3 o almacenamiento local.

---

### 🔍 Validación de Certificados (Público)

#### `POST /api/v1/certificates/validate`
Valida un certificado `.cer` del SAT sin firmar ningún documento. Comprueba:
1. Emisor oficial del SAT.
2. Vigencia temporal actual.
3. Estructura y datos del Subject (RFC, Nombre, CURP).
*   **Autenticación:** Ninguna (Público).
*   **Request Body (`multipart/form-data`):**
    - `certificado` (Archivo `.cer` del SAT, máx. 1 MB)
*   **Responses:**
    *   **200 OK (Aprobado):**
        ```json
        {
          "resultado": "APROBADO",
          "codigo_estado": "CERTIFICADO_VALIDO",
          "metadata": {
            "nombre": "Juan Pérez López",
            "rfc": "PELJ800101XYZ",
            "curp": "PELJ800101HDFXXY01",
            "noSerie": "00001000000500001234",
            "validoDesde": "2024-01-01T00:00:00.000Z",
            "validoHasta": "2028-01-01T00:00:00.000Z",
            "emisor": "C=MX, O=Servicio de Administracion Tributaria..."
          }
        }
        ```
    *   **200 OK (Rechazado):**
        ```json
        {
          "resultado": "RECHAZADO",
          "codigo_estado": "CADUCADO | EMISOR_NO_SOPORTADO | ESTRUCTURA_INVALIDA"
        }
        ```
