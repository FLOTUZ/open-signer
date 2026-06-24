# Instalación Automatizada de Certificados Raíz del SAT

## ¿Por qué no es 100% automático sin intervención humana?

El SAT no ofrece una API versionada y estable para certificados raíz/intermedios,
y sirve el paquete de descarga por `http://` (sin TLS). Confiar ciegamente en
una descarga automática rompería el propósito de `SatSignatureService`: si una
raíz falsa se inyectara en `/etc/sat-certs`, el sistema aprobaría firmas
apócrifas como legítimas.

Por eso el script automatiza la mecánica (descarga, extracción, permisos) pero
mantiene una verificación de integridad: **trust-on-first-use (TOFU)**.

## Cómo funciona `scripts/install-sat-certs.sh`

```bash
chmod +x scripts/install-sat-certs.sh
sudo ./scripts/install-sat-certs.sh
```

1. Descarga el ZIP oficial de certificados desde el portal del SAT.
2. **Primera corrida en el servidor:** calcula el SHA256 del archivo y pide
   una única confirmación manual (`s/N`) antes de continuar. Guarda ese hash
   en `/etc/sat-certs.sha256`.
3. **Corridas siguientes:** compara automáticamente contra ese hash guardado.
   No pide nada ni requiere editar el script. Si el archivo cambia
   inesperadamente, se detiene con una alerta.
4. Extrae solo los `.cer` (descarta `.key`/`.zip` residuales).
5. Aplica permisos `755`/`644` y los deja en `/etc/sat-certs`.

## Si el SAT rota sus certificados raíz

Es un evento poco frecuente, pero si ocurre el script se detendrá con una
alerta de checksum distinto. Para aceptar el nuevo paquete:

```bash
sudo rm /etc/sat-certs.sha256
sudo ./scripts/install-sat-certs.sh
```

Esto vuelve a pedir la confirmación manual única y guarda el nuevo hash de
referencia.

## Integración con Dokploy / CI-CD

Dokploy despliega desde imágenes ya construidas en GHCR (no desde Git
directamente en el VPS), y los certificados viven en el host, no en la
imagen Docker (ver montaje `:ro` en `docker-compose.yml`). Por eso este
script **no** corre dentro del pipeline de GitHub Actions.

Flujo recomendado para un VPS nuevo administrado por Dokploy:

1. Aprovisionas el VPS y conectas Dokploy.
2. Antes del primer deploy, te conectas por SSH una vez y corres:
   ```bash
   sudo ./scripts/install-sat-certs.sh
   ```
3. A partir de ahí, todos los redeploys vía webhook de Dokploy reutilizan
   `/etc/sat-certs` automáticamente, sin tocar certificados de nuevo.
4. Solo repites el paso 2 si el SAT rota sus certificados raíz.

## Variables de Entorno y Simulador de Revocación

Para controlar el comportamiento de la validación del SAT y las listas de revocación, existen dos variables clave en el `.env`:

### 1. `SAT_CERTS_DIR`
Le indica al backend en qué directorio debe buscar los certificados públicos oficiales del SAT (las llaves Raíz e Intermedias) para construir la "cadena de confianza".
- **En Producción (Docker):** El contenedor mapea la carpeta local hacia `/app/certs/sat`. Por lo tanto, el valor correcto suele ser `/app/certs/sat` (o puede omitirse, ya que el sistema buscará ahí por defecto).

### 2. `SAT_REVOCATION_CHECK_MODE`
Actúa como un "Simulador" para pruebas de revocación (OCSP y CRL). Controla si el sistema consulta al SAT real o si finge el resultado (para desarrollo).
- **En Producción:** Esta variable **DEBE** ser `production` o borrarse del `.env`.
- **Seguridad (Circuit Breaker):** Si por accidente tu entorno dice `NODE_ENV=production` y `SAT_REVOCATION_CHECK_MODE="mock_good"`, el servidor se apagará instantáneamente (`process.exit(1)`) para evitar que se aprueben firmas con certificados falsos.
- **Valores posibles:** `production`, `mock_good`, `mock_revoked`, `mock_timeout`, `mock_sat_down`, `disabled`.

### Extracción Dinámica de URLs (AIA/CDP) y Errores EAI_AGAIN
El SAT no tiene una "única URL maestra" para sus listas de revocación. Opera múltiples autoridades certificadoras, y cada certificado emitido tiene incrustada la URL específica donde debe verificarse.
- **Flujo en este sistema:** `SatRevocationChecker` lee internamente la extensión `cRLDistributionPoints` de cada `.cer` y guarda esa URL en BD para sincronizarla dinámicamente en background (`CrlWorkerService`).
- **Sincronización Manual:** Si usas el botón del Panel de Admin para sincronizar, usa URLs reales como `http://www.sat.gob.mx/crl`. Si intentas sincronizar dominios antiguos o falsos (ej. `ccg.sat.gob.mx`), el contenedor lanzará un error de DNS `getaddrinfo EAI_AGAIN` ya que esos dominios no existen.

## Certificados de prueba (para desarrollo)

El SAT publica certificados ficticios en la misma página de trámites, pensados
para que los desarrolladores integren y prueben el flujo de firma **sin usar
una e.firma real**:

- [Certificados de Prueba (447 KB)](http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Certificados_de_Prueba.zip)
- [Certificados padre con los que se generaron los de prueba (15 KB)](http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Certificados_P.zip) — incluye `.cer`, `.key` y contraseña juntos.

A diferencia de un certificado real (donde nunca tendrías la llave privada y
contraseña a la mano, por la filosofía "cero retención" de este sistema), este
paquete trae todo listo para probar `SatSignatureService.sign()` de extremo a
extremo en desarrollo:

```bash
# Ejemplo de prueba local con los archivos del paquete de prueba
curl -X POST http://localhost:5000/api/v1/signatures/sign \
  -H "x-api-key: TU_API_KEY" \
  -F "cer=@./certs-prueba/certificado.cer" \
  -F "key=@./certs-prueba/llave.key" \
  -F "password=CONTRASEÑA_DEL_PAQUETE" \
  -F "document=@./mi-documento.pdf"
```

> [!WARNING]
> Estos certificados de prueba **no pasarán** la validación de
> `validateCertificate()` contra las raíces de producción (`Cert_Prod.zip`),
> ya que están firmados por una autoridad de prueba distinta. Úsalos solo
> para probar el flujo de `sign()` o para una cadena de confianza de prueba
> separada; no los mezcles con `/etc/sat-certs` de producción.

## TODO: Aplicabilidad de Certificados de Sello Digital (CSD)

El SAT también expide **Certificados de Sello Digital (CSD)**, distintos de
la e.firma: se usan exclusivamente para timbrar/firmar CFDI (facturas
electrónicas), mientras que la e.firma (FIEL) se usa para trámites fiscales
en general.

Este sistema está diseñado hoy en torno a la e.firma. Falta documentar:

- [ ] Si el sistema debe soportar también CSD como tipo de certificado válido
      en `/api/v1/signatures/sign`, o si queda fuera de alcance.
- [ ] Diferencias estructurales entre CSD y e.firma que afecten
      `parseSubjectFields()` / `parseSatSerialNumber()` (campos del Subject
      pueden variar entre ambos tipos).
- [ ] Si la cadena de confianza (`trustedRoots`) de producción ya cubre CSD,
      o si requiere un paquete de certificados raíz distinto.
- [ ] Casos de uso del negocio que justifiquen agregar soporte a CSD.

## Verificación rápida post-instalación

```bash
ls -la /etc/sat-certs
openssl x509 -in /etc/sat-certs/<archivo>.cer -noout -subject -issuer -dates
```

Si `bootstrapCryptoRoots()` en `server.ts` arranca sin lanzar
`[❌ ERROR CRÍTICO] Fallo en la PKI`, los certificados quedaron correctamente
instalados y cargados.

## Integración con el flujo de firma por Webhook (Zero-Trust)

En el nuevo mecanismo de firma por webhook, la cadena de confianza del SAT
se sigue usando exactamente igual, pero **en un momento distinto del flujo**:

| Mecanismo | Cuándo se usa la cadena SAT |
|---|---|
| Firma directa (API Key) | Al recibir `.cer` + `.key` → `SatSignatureService.sign()` valida y firma |
| Firma por webhook (Client-Side) | Al recibir la firma ya generada → `SatSignatureService.validateCertificate()` valida solo el `.cer` |

La diferencia clave: en el flujo de webhook el servidor **nunca recibe la `.key`**.
La firma RSA-SHA256 se calcula en el navegador del usuario con `SubtleCrypto`.
El servidor solo verifica que el `.cer` sea legítimo (emitido por el SAT) y que
no esté expirado, antes de aceptar la firma y notificar al integrador.

**El resultado legal**: el sistema puede demostrar criptográficamente que el
usuario es quien dice ser (por el `.cer` válido), pero no puede demostrar haber
tenido acceso a la llave privada — lo que transfiere la responsabilidad de la
firma completamente al usuario firmante.