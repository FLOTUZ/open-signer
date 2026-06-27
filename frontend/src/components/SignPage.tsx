import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import * as forge from "node-forge";
import {
  FiAlertTriangle,
  FiFileText,
  FiUploadCloud,
  FiKey,
  FiEye,
  FiEyeOff,
  FiLock,
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiShield,
} from "react-icons/fi";

import { API } from "../api";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface SignRequestContext {
  id: string;
  documentHash: string;
  documentName: string;
  documentSize: number;
  status: string;
  expiresAt: string;
  clientName?: string | null;
  logoUrl?: string | null;
}

type Step = "loading" | "ready" | "signing" | "success" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsArrayBuffer(file);
  });
}

function bufToBinary(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => String.fromCharCode(b))
    .join("");
}

/**
 * Descifra un archivo .key del SAT (PKCS#8 EncryptedPrivateKeyInfo con 3DES)
 * usando node-forge y firma el documentHash con RSA-SHA256.
 *
 * Intenta múltiples variantes de PEM header para compatibilidad con distintos
 * formatos emitidos por el SAT. Firma con forge directamente (RSASSA-PKCS1-v1_5)
 * para evitar problemas de importación de formato PKCS#1 en SubtleCrypto.
 *
 * La clave privada NUNCA sale del navegador.
 */
async function signHashLocally(
  cerBytes: ArrayBuffer,
  keyBytes: ArrayBuffer,
  password: string,
  documentHash: string,
): Promise<{ signatureBase64: string; cerBase64: string }> {
  const keyBinaryStr = bufToBinary(keyBytes);
  const keyBase64 = btoa(keyBinaryStr);

  let privateKeyForge: forge.pki.rsa.PrivateKey | null = null;

  // Intentar múltiples headers de PEM — el SAT puede emitir cualquiera de estos
  const headersToTry = [
    {
      begin: "-----BEGIN ENCRYPTED PRIVATE KEY-----",
      end: "-----END ENCRYPTED PRIVATE KEY-----",
    },
    {
      begin: "-----BEGIN RSA PRIVATE KEY-----",
      end: "-----END RSA PRIVATE KEY-----",
    },
    { begin: "-----BEGIN PRIVATE KEY-----", end: "-----END PRIVATE KEY-----" },
  ];

  let lastError = "";

  for (const { begin, end } of headersToTry) {
    try {
      const lines = keyBase64.match(/.{1,64}/g) ?? [];
      const pem = [begin, ...lines, end].join("\n");
      const key = forge.pki.decryptRsaPrivateKey(pem, password);
      if (key) {
        privateKeyForge = key;
        break;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!privateKeyForge) {
    throw new Error(
      `No se pudo descifrar la llave privada. Verifica la contraseña y el archivo .key.${lastError ? ` Detalle: ${lastError}` : ""}`,
    );
  }

  // Firmar con forge (RSASSA-PKCS1-v1_5 + SHA-256)
  const md = forge.md.sha256.create();
  md.update(documentHash, "utf8");

  const signatureBytes = privateKeyForge.sign(md);
  const signatureBase64 = btoa(signatureBytes);

  // Codificar el .cer en Base64
  const cerBase64 = btoa(bufToBinary(cerBytes));

  // Limpiar referencias en memoria (best-effort)
  try {
    (privateKeyForge as unknown as Record<string, unknown>).d = null;
    (privateKeyForge as unknown as Record<string, unknown>).p = null;
    (privateKeyForge as unknown as Record<string, unknown>).q = null;
  } catch {
    /* silencioso */
  }

  return { signatureBase64, cerBase64 };
}

// ── Componente principal ──────────────────────────────────────────────────────

interface SignPageProps {
  requestId?: string;
}

export default function SignPage({ requestId: propRequestId }: SignPageProps) {
  const { id: paramRequestId } = useParams<{ id: string }>();
  const requestId = propRequestId || paramRequestId || "";
  const [step, setStep] = useState<Step>("loading");
  const [context, setContext] = useState<SignRequestContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [password, setPassword] = useState<string>("");
  const [showPass, setShowPass] = useState(false);

  const [progress, setProgress] = useState<string>("");
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [closeFailed, setCloseFailed] = useState(false);

  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const openPreviewModal = async () => {
    setShowPreviewModal(true);
    if (previewUrl) return;

    setLoadingPreview(true);
    try {
      const res = await fetch(
        `${API}/signatures/request/${requestId}/document`,
      );
      const data = await res.json();
      if (data.status === "success" && data.url) {
        setPreviewUrl(data.url);
      } else {
        console.error("Error al obtener la URL del documento");
      }
    } catch (err) {
      console.error("Error cargando documento:", err);
    } finally {
      setLoadingPreview(false);
    }
  };

  // ── Cargar contexto al montar ──────────────────────────────────────────────
  useEffect(() => {
    if (!requestId) {
      setError("ID de solicitud no encontrado en la URL.");
      setStep("error");
      return;
    }

    fetch(`${API}/signatures/request/${requestId}/context`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") {
          setContext(d.data);
          setStep("ready");
        } else {
          setError(d.message ?? "No se pudo cargar la solicitud de firma.");
          setStep("error");
        }
      })
      .catch(() => {
        setError(
          "No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
        );
        setStep("error");
      });
  }, [requestId]);

  // ── Cuenta regresiva tras firmar ───────────────────────────────────────────
  useEffect(() => {
    if (step !== "success") return;
    if (countdown <= 0) {
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        window.close();
        setCloseFailed(true);
      }
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, countdown, redirectUrl]);

  // ── Proceso de firma ───────────────────────────────────────────────────────
  const handleSign = useCallback(async () => {
    if (!cerFile || !keyFile || !password || !context || step === "signing")
      return;
    setStep("signing");
    setError(null);

    try {
      setProgress("Leyendo archivos desde disco...");
      const [cerBytes, keyBytes] = await Promise.all([
        readFileAsArrayBuffer(cerFile),
        readFileAsArrayBuffer(keyFile),
      ]);

      setProgress(
        "Descifrando llave privada (localmente, nunca sale del navegador)...",
      );
      const { signatureBase64, cerBase64 } = await signHashLocally(
        cerBytes,
        keyBytes,
        password,
        context.documentHash,
      );

      setProgress("Enviando firma al servidor para validación...");
      const res = await fetch(`${API}/signatures/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, signatureBase64, cerBase64 }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.message ?? `Error del servidor: HTTP ${res.status}`,
        );
      }

      setRedirectUrl(data.redirectUrl);
      setStep("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep("ready"); // Volver a "ready" para poder reintentar
    }
  }, [cerFile, keyFile, password, context, requestId, step]);

  // ── Render ────────────────────────────────────────────────────────────────
  const expiresAt = context ? new Date(context.expiresAt) : null;
  const timeLeft = expiresAt
    ? Math.max(0, expiresAt.getTime() - Date.now())
    : 0;
  const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
  const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

  const resolvedLogoUrl = context?.logoUrl
    ? context.logoUrl.startsWith("http")
      ? context.logoUrl
      : `${API.replace("/api/v1", "")}${context.logoUrl}`
    : null;

  return (
    <div className="sign-page-root">
      <div className="sign-page-container">
        {/* Header */}
        <div
          className="sign-page-header"
          style={
            resolvedLogoUrl
              ? {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: "0.5rem",
                  paddingBottom: "1.25rem",
                  borderBottom: "1px solid #e2e8f0",
                  marginBottom: "1.5rem",
                  position: "relative",
                  width: "100%",
                }
              : undefined
          }
        >
          <div
            className="sign-page-logo"
            style={{
              display: "flex",
              flexDirection: resolvedLogoUrl ? "column" : "row",
              alignItems: "center",
              gap: resolvedLogoUrl ? "0.25rem" : "0.6rem",
            }}
          >
            {resolvedLogoUrl ? (
              <img
                src={resolvedLogoUrl}
                alt={context?.clientName || "Logo Cliente"}
                style={{
                  maxHeight: "72px",
                  maxWidth: "180px",
                  objectFit: "contain",
                }}
              />
            ) : (
              <FiShield size={24} style={{ color: "#1976d2" }} />
            )}
          </div>
        </div>

        {/* ── Cargando ── */}
        {step === "loading" && (
          <div className="sign-step-card">
            <div className="sign-spinner" />
            <p className="sign-status-text">Cargando solicitud de firma...</p>
          </div>
        )}

        {/* ── Error al cargar (sin contexto) ── */}
        {step === "error" && !context && (
          <div className="sign-step-card sign-error-card">
            <div className="sign-error-icon-container">
              <FiAlertTriangle size={48} className="sign-error-icon-svg" />
            </div>
            <p className="sign-status-title">No se pudo cargar la solicitud</p>
            <p className="sign-error-detail">{error}</p>
          </div>
        )}

        {/* ── Formulario de firma (ready + signing) ── */}
        {(step === "ready" || step === "signing") && context && (
          <>
            {/* Info del documento */}
            <div className="sign-doc-card">
              <div className="sign-doc-icon">
                <FiFileText size={28} />
              </div>
              <div className="sign-doc-info">
                <p className="sign-doc-name">{context.documentName}</p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginTop: "4px",
                  }}
                >
                  <span className="sign-doc-meta" style={{ margin: 0 }}>
                    {formatBytes(context.documentSize)}
                  </span>
                  <span style={{ color: "#cbd5e1" }}>•</span>
                  <button
                    onClick={openPreviewModal}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "#1976d2",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      textDecoration: "underline",
                    }}
                  >
                    <FiEye size={13} />
                    Ver documento
                  </button>
                </div>
                <p className="sign-doc-hash" style={{ marginTop: "4px" }}>
                  SHA-256: <code>{context.documentHash.substring(0, 24)}…</code>
                </p>
              </div>
              <div className="sign-ttl-badge">
                <FiClock style={{ marginRight: 4, verticalAlign: "middle" }} />
                Expira en {hoursLeft}h {minutesLeft}m
              </div>
            </div>

            {/* Aviso de seguridad */}
            <div className="sign-security-notice">
              <FiShield size={16} />
              <span>
                <strong>
                  Tu llave privada nunca sale de este dispositivo.
                </strong>{" "}
                La firma se realiza completamente en tu navegador.
              </span>
            </div>

            {/* Formulario */}
            <div className="sign-form-card">
              <h2 className="sign-form-title">Firma con tu e.firma</h2>
              <p className="sign-form-subtitle">
                Carga tu certificado .cer, tu llave .key y escribe tu
                contraseña.
              </p>

              <div className="sign-steps-list">
                {/* Paso 1: .cer */}
                <div
                  className={`sign-step-item ${cerFile ? "done" : "pending"}`}
                >
                  <div className="sign-step-number">
                    {cerFile ? <FiCheck size={14} /> : "1"}
                  </div>
                  <div className="sign-step-content">
                    <label htmlFor="cer-file" className="sign-step-label">
                      Certificado (.cer)
                    </label>
                    <div className="sign-file-drop">
                      <input
                        id="cer-file"
                        type="file"
                        accept=".cer"
                        onChange={(e) =>
                          setCerFile(e.target.files?.[0] ?? null)
                        }
                      />
                      {cerFile ? (
                        <span className="sign-file-selected">
                          <FiFileText
                            style={{ marginRight: 6, verticalAlign: "middle" }}
                          />
                          {cerFile.name}
                        </span>
                      ) : (
                        <span className="sign-file-placeholder">
                          <FiUploadCloud
                            style={{ marginRight: 6, verticalAlign: "middle" }}
                          />
                          Arrastra o haz clic para seleccionar
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Paso 2: .key */}
                <div
                  className={`sign-step-item ${keyFile ? "done" : "pending"}`}
                >
                  <div className="sign-step-number">
                    {keyFile ? <FiCheck size={14} /> : "2"}
                  </div>
                  <div className="sign-step-content">
                    <label htmlFor="key-file" className="sign-step-label">
                      Llave privada (.key)
                    </label>
                    <div className="sign-file-drop">
                      <input
                        id="key-file"
                        type="file"
                        accept=".key"
                        onChange={(e) =>
                          setKeyFile(e.target.files?.[0] ?? null)
                        }
                      />
                      {keyFile ? (
                        <span className="sign-file-selected">
                          <FiKey
                            style={{ marginRight: 6, verticalAlign: "middle" }}
                          />
                          {keyFile.name}
                        </span>
                      ) : (
                        <span className="sign-file-placeholder">
                          <FiUploadCloud
                            style={{ marginRight: 6, verticalAlign: "middle" }}
                          />
                          Arrastra o haz clic para seleccionar
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Paso 3: Contraseña */}
                <div
                  className={`sign-step-item ${password ? "done" : "pending"}`}
                >
                  <div className="sign-step-number">
                    {password ? <FiCheck size={14} /> : "3"}
                  </div>
                  <div className="sign-step-content">
                    <label htmlFor="key-password" className="sign-step-label">
                      Contraseña de la llave
                    </label>
                    <div className="sign-password-wrap">
                      <input
                        id="key-password"
                        type={showPass ? "text" : "password"}
                        placeholder="Contraseña del archivo .key"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSign()}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="sign-toggle-pass"
                        onClick={() => setShowPass((v) => !v)}
                      >
                        {showPass ? (
                          <FiEyeOff size={16} />
                        ) : (
                          <FiEye size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Error de firma (visible cuando step vuelve a "ready" con error) */}
              {error && step === "ready" && (
                <div className="sign-error-box">
                  <strong>Error:</strong> {error}
                </div>
              )}

              {/* Progreso durante la firma */}
              {step === "signing" && progress && (
                <p
                  className="sign-status-progress"
                  style={{ textAlign: "center", margin: "0.75rem 0" }}
                >
                  <FiLock style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {progress}
                </p>
              )}

              <button
                className="sign-btn-primary"
                onClick={handleSign}
                disabled={
                  !cerFile || !keyFile || !password || step === "signing"
                }
              >
                {step === "signing" ? (
                  <>
                    <div
                      className="sign-spinner"
                      style={{
                        width: 18,
                        height: 18,
                        margin: 0,
                        borderWidth: 2,
                      }}
                    />
                    Firmando...
                  </>
                ) : (
                  <>
                    <FiShield size={18} />
                    Firmar Documento
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* ── Éxito ── */}
        {step === "success" && (
          <div className="sign-step-card sign-success-card">
            <div className="sign-success-icon-container">
              <FiCheckCircle size={56} className="sign-success-icon-svg" />
            </div>
            <p className="sign-status-title">
              ¡Documento firmado exitosamente!
            </p>
            <p className="sign-status-text">
              {redirectUrl ? (
                <>
                  Serás redirigido automáticamente en{" "}
                  <strong>{countdown}</strong> segundos...
                </>
              ) : closeFailed ? (
                <span style={{ color: "#e11d48", fontWeight: 600 }}>
                  Por seguridad de tu navegador, debes cerrar esta pestaña
                  manualmente.
                </span>
              ) : (
                <>
                  Esta pestaña se cerrará automáticamente en{" "}
                  <strong>{countdown}</strong> segundos...
                </>
              )}
            </p>
            {redirectUrl ? (
              <a href={redirectUrl} className="sign-btn-redirect">
                Continuar ahora →
              </a>
            ) : (
              <button
                onClick={() => {
                  window.close();
                  setCloseFailed(true);
                }}
                className="sign-btn-redirect"
                style={{
                  border: "none",
                  cursor: "pointer",
                  display: "inline-block",
                  fontFamily: "inherit",
                }}
              >
                {closeFailed ? "Entendido" : "Cerrar pestaña ahora"}
              </button>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="sign-page-footer">
          Powered by <strong>Open Signer</strong> · Firma segura.
        </div>
      </div>

      {/* Modal de previsualización de PDF */}
      {showPreviewModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "900px",
              height: "85vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.1rem",
                  color: "#0f172a",
                  fontWeight: 600,
                }}
              >
                Previsualización del Documento
              </h3>
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  borderRadius: "50%",
                  width: "28px",
                  height: "28px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#64748b",
                  fontWeight: "bold",
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body / PDF Viewer */}
            <div
              style={{
                flex: 1,
                backgroundColor: "#f8fafc",
                position: "relative",
              }}
            >
              {loadingPreview ? (
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <div
                    className="sign-spinner"
                    style={{ width: "36px", height: "36px" }}
                  />
                  <span style={{ fontSize: "0.9rem", color: "#64748b" }}>
                    Cargando lector de PDF...
                  </span>
                </div>
              ) : previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="Documento a firmar"
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    color: "#ef4444",
                    textAlign: "center",
                  }}
                >
                  Ocurrió un error al cargar el documento. Por favor, intenta de
                  nuevo.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
