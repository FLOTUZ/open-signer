# Guía de Uso de la API - Firma Digital SAT MX

Esta API permite a clientes externos firmar digitalmente documentos (PDF, XML, etc.) utilizando su **e.firma del SAT (México)** de forma segura en memoria, sin retención de credenciales.

---

## 1. Autenticación

Todas las solicitudes de negocio requieren autenticación mediante una **API Key** suministrada en las cabeceras HTTP:

*   **Cabecera:** `x-api-key`
*   **Valor:** `opensigner_live_xxxxxxxxxxxxxxxxxxxxxxxx`

> [!NOTE]
> La API Key se genera inicialmente mediante el endpoint de administración y se entrega una única vez.

---

## 2. Endpoint de Firma Digital

### `POST /api/v1/signatures/sign`

Este endpoint recibe el documento original y los certificados de la e.firma, ejecuta la firma digital en memoria, almacena el archivo y devuelve los metadatos correspondientes.

*   **Content-Type:** `multipart/form-data`
*   **Cabeceras:**
    *   `x-api-key: <tu_api_key>`

### Parámetros de la Petición (Form Fields)

| Campo | Tipo | Ubicación | Descripción |
| :--- | :--- | :--- | :--- |
| `documento` | Archivo (Binary) | Files | Archivo original a firmar (ej. `contrato.pdf`). |
| `certificado` | Archivo (Binary) | Files | Certificado público de la e.firma (archivo `.cer`). |
| `llave` | Archivo (Binary) | Files | Llave privada cifrada de la e.firma (archivo `.key`). |
| `password` | Texto | Body | Contraseña de la llave privada. |
| `cadenaOriginal` | Texto | Body | Cadena original generada que se desea firmar (ej. datos de facturación concatenados según reglas del SAT). |

---

## 3. Ejemplos de Integración

### Ejemplo con `cURL`

```bash
curl --location 'http://localhost:3000/api/v1/signatures/sign' \
--header 'x-api-key: opensigner_live_8f0a9b...' \
--form 'documento=@"/ruta/a/mi/contrato.pdf"' \
--form 'certificado=@"/ruta/a/mi/certificado.cer"' \
--form 'llave=@"/ruta/a/mi/llave.key"' \
--form 'password="mi_password_seguro"' \
--form 'cadenaOriginal="||1.1|opensigner|firma|documento|2026-06-23||"'
```

### Ejemplo con JavaScript (`fetch` en Node.js o Navegador)

```javascript
const express = require('express');
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function firmarDocumento() {
  const form = new FormData();
  
  // Cargar archivos como streams o buffers
  form.append('documento', fs.createReadStream('./contrato.pdf'));
  form.append('certificado', fs.createReadStream('./certificado.cer'));
  form.append('llave', fs.createReadStream('./llave.key'));
  
  // Agregar campos de texto
  form.append('password', 'mi_password_seguro');
  form.append('cadenaOriginal', '||1.1|opensigner|firma|documento|2026-06-23||');

  try {
    const response = await fetch('http://localhost:3000/api/v1/signatures/sign', {
      method: 'POST',
      headers: {
        'x-api-key': 'opensigner_live_8f0a9b...',
        ...form.getHeaders() // Requerido en Node.js con la librería form-data
      },
      body: form
    });

    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error al invocar API:', error);
  }
}

firmarDocumento();
```

---

## 4. Respuestas del Servidor

### Respuesta Exitosa (`201 Created`)

```json
{
  "status": "success",
  "message": "Documento firmado digitalmente con éxito.",
  "data": {
    "id": "2c943cb9-a1b4-4cfa-93cb-39871ef3b5cd",
    "s3Url": "https://opensigner-signatures-bucket.s3.us-east-1.amazonaws.com/1719183600000_contrato.pdf",
    "documentHash": "a1f94d93e87d...8f9e0a2b",
    "signatureString": "MIIEuwYJKoZIhvcNAQcCoIIErDCCBKgCAQExDzANBglghkgBZQMEAgEFAD...",
    "serialNumber": "30001000000500003416",
    "certificateDetails": {
      "subject": "CN=Persona Fisica, O=SAT, C=MX",
      "issuer": "CN=AC de Pruebas del SAT, O=SAT, C=MX",
      "validFrom": "Jun 20 12:00:00 2024 GMT",
      "validTo": "Jun 20 12:00:00 2028 GMT"
    },
    "createdAt": "2026-06-23T23:02:00.000Z"
  }
}
```

### Respuesta de Error por Datos Inválidos (`422 Unprocessable Entity`)

Cuando fallan las validaciones defensivas de Zod:

```json
{
  "status": "fail",
  "message": "Error de validación en los datos de la petición.",
  "errors": {
    "body.password": [
      "La contraseña de la llave privada es obligatoria"
    ],
    "files.certificado": [
      "Es obligatorio subir los archivos: documento, certificado (.cer) y llave (.key)"
    ]
  }
}
```

### Respuesta de Error Operacional Criptográfico (`400 Bad Request`)

Ocurre si la contraseña no desencripta la llave o si el certificado expiró:

```json
{
  "status": "fail",
  "message": "Contraseña incorrecta o archivo de llave privada (.key) corrupto: error:06065064:digital envelope routines:EVP_DecryptFinal_ex:bad decrypt"
}
```
