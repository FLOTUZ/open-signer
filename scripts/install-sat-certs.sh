#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-sat-certs.sh
# Instala los certificados del SAT en /etc/sat-certs (producción) y
# /etc/sat-certs-test (pruebas) de forma reproducible. Pensado para correr
# UNA VEZ por host (VPS) antes del primer `docker compose up`, y de nuevo
# solo si el SAT rota sus certificados.
#
# Uso:
#   sudo ./install-sat-certs.sh             # instala producción + pruebas
#   sudo ./install-sat-certs.sh --prod-only # solo cadena de confianza de producción
#   sudo ./install-sat-certs.sh --test-only # solo CSD de pruebas
#
# Qué hace por cada paquete:
#   1. Descarga el ZIP oficial del SAT correspondiente
#   2. La PRIMERA vez, calcula su SHA256 y lo guarda como hash de referencia
#      (pidiendo una confirmación manual única de que confías en el archivo)
#   3. En corridas posteriores, compara automáticamente contra ese hash
#      guardado y se detiene si no coincide — sin que tengas que editar nada
#   4. Extrae los .cer/.key relevantes (descarta .zip residuales)
#   5. Aplica permisos correctos y los deja en su directorio destino
#
# Paquetes:
#   - Producción (Cert_Prod.zip): cadena de confianza (raíz + intermedias)
#     usada por SatSignatureService para validar certificados reales.
#     Solo contiene archivos públicos .cer → permisos 644.
#   - Pruebas (Certificados_P.zip): CSD de prueba con .cer, .key (CIFRADA)
#     y contraseña, firmados por una cadena de pruebas del SAT (NO la cadena
#     de producción). Útil para probar el flujo de validación end-to-end sin
#     arriesgar certificados reales. El .key, aunque es de prueba, sigue
#     siendo una llave privada: se instala con permisos 600 y la contraseña
#     se guarda aparte, también con permisos 600.
#
# Nota de seguridad: el SAT sirve estos archivos por http:// (sin TLS), así
# que la confirmación manual en la primera corrida es tu única defensa real
# contra manipulación en tránsito. Si el hash cambia en una corrida futura
# sin que tú lo esperaras, trátalo como una alerta seria y no la ignores.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

# ─── Paquete de PRODUCCIÓN: cadena de confianza (raíz + intermedias) ───
PROD_ZIP_URL="http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Cert_Prod.zip"
PROD_CERTS_DIR="${SAT_CERTS_HOST_DIR:-$PROJECT_ROOT/certs/sat}"
PROD_HASH_FILE="${SAT_CERTS_HASH_FILE:-$PROJECT_ROOT/certs/sat-certs.sha256}"

# ─── Paquete de PRUEBAS: CSD de prueba (.cer + .key cifrada + contraseña) ───
TEST_ZIP_URL="http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Certificados_P.zip"
TEST_CERTS_DIR="${SAT_CERTS_TEST_HOST_DIR:-$PROJECT_ROOT/certs/sat-test}"
TEST_HASH_FILE="${SAT_CERTS_TEST_HASH_FILE:-$PROJECT_ROOT/certs/sat-certs-test.sha256}"

INSTALL_PROD=true
INSTALL_TEST=true

for arg in "$@"; do
  case "$arg" in
    --prod-only) INSTALL_TEST=false ;;
    --test-only) INSTALL_PROD=false ;;
    *)
      echo "❌ Argumento no reconocido: $arg (usa --prod-only o --test-only)" >&2
      exit 1
      ;;
  esac
done

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "🔐 Instalador de certificados del SAT"
echo "─────────────────────────────────────────"

# Requiere root solo si alguno de los destinos activos vive bajo /etc
if { [[ "$INSTALL_PROD" == true && "$PROD_CERTS_DIR" == /etc/* ]] || \
     [[ "$INSTALL_TEST" == true && "$TEST_CERTS_DIR" == /etc/* ]]; } && \
   [[ "$EUID" -ne 0 ]]; then
  echo "❌ Este script debe ejecutarse con sudo/root (necesita escribir en /etc)." >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────
# download_and_verify <url> <zip_dest> <hash_file> <etiqueta>
# Descarga el ZIP, calcula su SHA256 y lo compara/guarda contra hash_file.
# Aborta el script si la verificación falla o el usuario no confirma.
# ─────────────────────────────────────────────────────────────────────────
download_and_verify() {
  local url="$1"
  local zip_dest="$2"
  local hash_file="$3"
  local label="$4"

  echo "→ [$label] Descargando paquete..."
  if ! curl -fsSL "$url" -o "$zip_dest"; then
    echo "❌ [$label] No se pudo descargar el paquete automáticamente."
    echo "   Descárgalo manualmente desde el portal de trámites del SAT y"
    echo "   colócalo en: $zip_dest"
    echo "   Luego vuelve a ejecutar este script."
    exit 1
  fi

  echo "→ [$label] Verificando integridad (SHA256)..."
  local actual_sha256
  actual_sha256="$(sha256sum "$zip_dest" | awk '{print $1}')"

  if [[ ! -f "$hash_file" ]]; then
    echo "⚠️  [$label] Primera instalación: no hay un hash de referencia previo."
    echo "    Hash calculado del archivo descargado: $actual_sha256"
    echo ""
    echo "    Este valor se guardará en $hash_file y se usará para verificar"
    echo "    automáticamente todas las corridas futuras de este script."
    echo "    Si quieres confirmar el origen del archivo antes de confiar en él"
    echo "    (recomendado, ya que el SAT sirve este archivo por http:// sin TLS),"
    echo "    revisa ahora el contenido del ZIP descargado en:"
    echo "      $zip_dest"
    read -rp "    ¿Confías en este archivo y deseas continuar? (s/N): " confirm
    if [[ ! "$confirm" =~ ^[sS]$ ]]; then
      echo "❌ [$label] Instalación cancelada por el usuario."
      exit 1
    fi
    mkdir -p "$(dirname "$hash_file")"
    echo "$actual_sha256" > "$hash_file"
    chmod 644 "$hash_file"
    echo "✅ [$label] Hash guardado en $hash_file para verificaciones futuras."
  else
    local expected_sha256
    expected_sha256="$(cat "$hash_file")"
    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
      echo "❌ [$label] ALERTA: El checksum del archivo descargado NO coincide"
      echo "   con el guardado en $hash_file."
      echo "   Esperado: $expected_sha256"
      echo "   Obtenido: $actual_sha256"
      echo "   Esto puede significar que el SAT actualizó sus certificados, o que"
      echo "   el archivo fue alterado en tránsito. NO continúes sin verificar"
      echo "   manualmente el origen de este archivo."
      echo ""
      echo "   Si confirmas que el cambio es legítimo (ej. el SAT rotó sus"
      echo "   certificados), borra $hash_file y vuelve a correr este script"
      echo "   para registrar el nuevo hash de confianza."
      exit 1
    fi
    echo "✅ [$label] Checksum verificado correctamente contra $hash_file."
  fi
}

# ─────────────────────────────────────────────────────────────────────────
# Paquete de PRODUCCIÓN
# ─────────────────────────────────────────────────────────────────────────
if [[ "$INSTALL_PROD" == true ]]; then
  echo ""
  echo "═══ Cadena de confianza de PRODUCCIÓN ═══"

  PROD_ZIP="$TMP_DIR/Cert_Prod.zip"
  download_and_verify "$PROD_ZIP_URL" "$PROD_ZIP" "$PROD_HASH_FILE" "PRODUCCIÓN"

  echo "→ [PRODUCCIÓN] Extrayendo archivos .cer..."
  mkdir -p "$TMP_DIR/extracted-prod"
  unzip -q "$PROD_ZIP" -d "$TMP_DIR/extracted-prod"

  PROD_CER_FILES=$(find "$TMP_DIR/extracted-prod" -iname "*.cer" -o -iname "*.crt")
  if [[ -z "$PROD_CER_FILES" ]]; then
    echo "❌ [PRODUCCIÓN] El ZIP no contenía archivos .cer o .crt. Verifica el paquete manualmente." >&2
    exit 1
  fi

  echo "→ [PRODUCCIÓN] Instalando en $PROD_CERTS_DIR..."
  mkdir -p "$PROD_CERTS_DIR"
  find "$TMP_DIR/extracted-prod" \( -iname "*.cer" -o -iname "*.crt" \) -exec cp {} "$PROD_CERTS_DIR/" \;

  chmod 755 "$PROD_CERTS_DIR"
  chmod 644 "$PROD_CERTS_DIR"/*.cer "$PROD_CERTS_DIR"/*.crt 2>/dev/null || true

  echo "✅ [PRODUCCIÓN] Certificados instalados en $PROD_CERTS_DIR:"
  ls -la "$PROD_CERTS_DIR"
fi

# ─────────────────────────────────────────────────────────────────────────
# Paquete de PRUEBAS (CSD de prueba: .cer + .key cifrada + contraseña)
# ─────────────────────────────────────────────────────────────────────────
if [[ "$INSTALL_TEST" == true ]]; then
  echo ""
  echo "═══ CSD de PRUEBAS ═══"

  TEST_ZIP="$TMP_DIR/Certificados_P.zip"
  download_and_verify "$TEST_ZIP_URL" "$TEST_ZIP" "$TEST_HASH_FILE" "PRUEBAS"

  echo "→ [PRUEBAS] Extrayendo archivos .cer/.key..."
  mkdir -p "$TMP_DIR/extracted-test"
  unzip -q "$TEST_ZIP" -d "$TMP_DIR/extracted-test"

  TEST_CER_FILES=$(find "$TMP_DIR/extracted-test" -iname "*.cer" -o -iname "*.crt")
  if [[ -z "$TEST_CER_FILES" ]]; then
    echo "❌ [PRUEBAS] El ZIP no contenía archivos .cer o .crt. Verifica el paquete manualmente." >&2
    exit 1
  fi

  echo "→ [PRUEBAS] Instalando en $TEST_CERTS_DIR..."
  mkdir -p "$TEST_CERTS_DIR"
  find "$TMP_DIR/extracted-test" \( -iname "*.cer" -o -iname "*.crt" \) -exec cp {} "$TEST_CERTS_DIR/" \;

  # Guardamos la ruta del primer .cer o .crt de prueba instalado: es el CSD que
  # usaremos más abajo para la verificación criptográfica automática.
  TEST_CSD_CER="$(echo "$TEST_CER_FILES" | head -n1)"
  TEST_CSD_CER_INSTALLED="$TEST_CERTS_DIR/$(basename "$TEST_CSD_CER")"
  chmod 755 "$TEST_CERTS_DIR"
  chmod 644 "$TEST_CERTS_DIR"/*.cer "$TEST_CERTS_DIR"/*.crt 2>/dev/null || true

  # El .key es una llave privada cifrada (de prueba, pero llave privada al fin):
  # permisos restrictivos, nunca 644 como los .cer públicos.
  TEST_KEY_FILES=$(find "$TMP_DIR/extracted-test" -iname "*.key")
  if [[ -n "$TEST_KEY_FILES" ]]; then
    find "$TMP_DIR/extracted-test" -iname "*.key" -exec cp {} "$TEST_CERTS_DIR/" \;
    chmod 600 "$TEST_CERTS_DIR"/*.key
    echo "🔑 [PRUEBAS] Llave(s) privada(s) .key instaladas con permisos 600."
  else
    echo "⚠️  [PRUEBAS] El ZIP no contenía archivos .key (revisa el paquete manualmente)."
  fi

  # La contraseña suele venir en un .txt/readme dentro del ZIP; la buscamos
  # y la dejamos aparte, también con permisos restrictivos, para no
  # mezclarla con los .cer de libre distribución.
  TEST_PASS_FILES=$(find "$TMP_DIR/extracted-test" -iname "*.txt" -o -iname "*pass*" -o -iname "*contrasen*")
  if [[ -n "$TEST_PASS_FILES" ]]; then
    mkdir -p "$TEST_CERTS_DIR/readme"
    cp $TEST_PASS_FILES "$TEST_CERTS_DIR/readme/" 2>/dev/null || true
    chmod 700 "$TEST_CERTS_DIR/readme"
    chmod 600 "$TEST_CERTS_DIR/readme"/* 2>/dev/null || true
    echo "📄 [PRUEBAS] Archivo(s) con la contraseña copiados a $TEST_CERTS_DIR/readme (permisos 600)."
  fi

  echo "✅ [PRUEBAS] Certificados instalados en $TEST_CERTS_DIR:"
  ls -la "$TEST_CERTS_DIR"

  # ───────────────────────────────────────────────────────────────────────
  # Verificación criptográfica automática: confirma que el CSD de prueba
  # recién instalado encadena correctamente contra las CAs de prueba que
  # también acabamos de instalar, usando la MISMA lógica que
  # SatSignatureService (checkIssued + verify), sin depender de un test
  # runner externo. Esto es lo que antes había que correr a mano con
  # diagnostico2.ts; ahora corre solo, una vez por instalación.
  # ───────────────────────────────────────────────────────────────────────
  if command -v node >/dev/null 2>&1 && [[ -n "${TEST_CSD_CER_INSTALLED:-}" ]]; then
    NODE_BIN="node"
  elif [[ -n "${TEST_CSD_CER_INSTALLED:-}" ]]; then
    # Bajo sudo, el PATH del usuario normal (incluyendo nvm) no siempre se
    # hereda. Buscamos en las ubicaciones más comunes antes de rendirnos.
    NODE_BIN=""
    for candidate in \
      "$(command -v node 2>/dev/null)" \
      /usr/local/bin/node \
      /usr/bin/node \
      "$HOME/.nvm/versions/node"/*/bin/node \
      "/home/${SUDO_USER:-}/.nvm/versions/node"/*/bin/node
    do
      if [[ -n "$candidate" && -x "$candidate" ]]; then
        NODE_BIN="$candidate"
        break
      fi
    done
  fi

  if [[ -n "${NODE_BIN:-}" ]] && [[ -n "${TEST_CSD_CER_INSTALLED:-}" ]]; then
    echo ""
    echo "→ [PRUEBAS] Verificando criptográficamente el CSD de prueba contra la cadena instalada..."

    VERIFY_RESULT=$(TEST_CERTS_DIR="$TEST_CERTS_DIR" TEST_CSD_CER="$TEST_CSD_CER_INSTALLED" "$NODE_BIN" --input-type=commonjs -e '
      const crypto = require("crypto");
      const fs = require("fs");
      const path = require("path");

      const certsDir = process.env.TEST_CERTS_DIR;
      const targetPath = process.env.TEST_CSD_CER;

      const files = fs.readdirSync(certsDir).filter(f => f.toLowerCase().endsWith(".cer") || f.toLowerCase().endsWith(".crt"));
      const roots = files
        .map(f => {
          try {
            return { file: f, cert: new crypto.X509Certificate(fs.readFileSync(path.join(certsDir, f))) };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      let target;
      try {
        target = new crypto.X509Certificate(fs.readFileSync(targetPath));
      } catch (e) {
        console.log("FAIL: el .cer de prueba no es un X.509 válido: " + e.message);
        process.exit(1);
      }

      for (const { file, cert } of roots) {
        if (cert.subject === target.subject && cert.serialNumber === target.serialNumber) continue; // no comparar contra sí mismo
        if (!target.checkIssued(cert)) continue;
        try {
          if (target.verify(cert.publicKey)) {
            console.log("OK: emitido y firmado por " + file);
            process.exit(0);
          }
        } catch (e) {
          console.log("FAIL: checkIssued coincidió con " + file + " pero verify() lanzó: " + e.message);
          process.exit(1);
        }
      }
      console.log("FAIL: ninguna CA de la cadena de pruebas instalada emitió/firmó este CSD.");
      process.exit(1);
    ' 2>&1) && VERIFY_STATUS=0 || VERIFY_STATUS=1

    echo "   $VERIFY_RESULT"

    if [[ "$VERIFY_STATUS" -eq 0 ]]; then
      echo "✅ [PRUEBAS] Verificación criptográfica exitosa: la cadena de pruebas es consistente."
    else
      echo "⚠️  [PRUEBAS] La verificación criptográfica automática NO pasó."
      echo "    Esto no detiene la instalación (los certificados ya quedaron copiados),"
      echo "    pero antes de confiar en este entorno de pruebas, revisa manualmente"
      echo "    con diagnostico2.ts cuál CA debería emitir este CSD."
    fi
  elif [[ -z "${TEST_CSD_CER_INSTALLED:-}" ]]; then
    echo "⚠️  [PRUEBAS] No se identificó un .cer de CSD para verificar (revisa el contenido del ZIP)."
  else
    echo "⚠️  [PRUEBAS] No se encontró Node.js (ni en PATH ni en ubicaciones comunes de nvm)."
    echo "    Si usas nvm con tu usuario normal, corre el script con:"
    echo "      sudo env PATH=\"\$PATH\" ./install-sat-certs.sh"
    echo "    o verifica manualmente más tarde con diagnostico2.ts."
  fi
fi

echo ""
echo "Listo. Ahora puedes ejecutar: docker compose up --build"