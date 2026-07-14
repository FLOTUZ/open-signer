import { useState, useEffect, useCallback } from "react";
import { API } from "../../api";
import { useAuth } from "../../context/AuthContext";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface WebhookJob {
  id: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  lastResponseCode: number | null;
  lastResponseBody: string | null;
}

interface SignatureRequest {
  id: string;
  documentName: string;
  documentHash: string;
  documentSize: number;
  status: "PENDING" | "SIGNED" | "FAILED" | "EXPIRED";
  redirectUrl: string;
  webhookUrl: string;
  signerName: string | null;
  signerRfc: string | null;
  createdAt: string;
  expiresAt: string;
  webhookJobs: WebhookJob[];
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    PENDING: "badge badge-pending",
    SIGNED: "badge badge-signed",
    FAILED: "badge badge-failed",
    EXPIRED: "badge badge-expired",
  };
  return <span className={map[status] ?? "badge"}>{status}</span>;
}

const FRONTEND_BASE = window.location.origin;
const SESSION_KEY = "wh_api_key";

// ── Componente principal ──────────────────────────────────────────────────────

export default function ClientWebhooks() {
  const { token: _token } = useAuth();
  // ── API Key (persiste en sessionStorage para la sesión actual) ──
  const [apiKey, setApiKey] = useState<string>(
    () => sessionStorage.getItem(SESSION_KEY) ?? "",
  );
  const [apiKeyInput, setApiKeyInput] = useState<string>(
    () => sessionStorage.getItem(SESSION_KEY) ?? "",
  );
  const [apiKeyOk, setApiKeyOk] = useState<boolean>(
    () => !!sessionStorage.getItem(SESSION_KEY),
  );

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    sessionStorage.setItem(SESSION_KEY, trimmed);
    setApiKey(trimmed);
    setApiKeyOk(true);
  };

  const clearApiKey = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setApiKey("");
    setApiKeyInput("");
    setApiKeyOk(false);
    setRequests([]);
  };

  // ── Estado: lista de solicitudes ──
  const [requests, setRequests] = useState<SignatureRequest[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // ── Estado: formulario de prueba de webhook ──
  const [testUrl, setTestUrl] = useState("");
  const [testRedirect, setTestRedirect] = useState("");
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    signUrl?: string;
  } | null>(null);

  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [editingReqId, setEditingReqId] = useState<string | null>(null);
  const [editingUrlValue, setEditingUrlValue] = useState("");
  const [updatingWebhookUrl, setUpdatingWebhookUrl] = useState(false);

  const saveWebhookUrl = async (reqId: string) => {
    if (!apiKey || !editingUrlValue.trim().startsWith("http")) {
      alert(
        "Por favor, introduce una URL válida (ej. https://ejemplo.com/webhook)",
      );
      return;
    }
    setUpdatingWebhookUrl(true);
    try {
      const res = await fetch(
        `${API}/signatures/requests/${reqId}/webhook-url`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({ webhookUrl: editingUrlValue.trim() }),
        },
      );
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setEditingReqId(null);
        loadRequests(); // Refresca las solicitudes y el estado de sus jobs
      } else {
        alert(
          `Error al actualizar la URL: ${data.message || "Error del servidor"}`,
        );
      }
    } catch {
      alert("Error de red al actualizar la URL del webhook.");
    } finally {
      setUpdatingWebhookUrl(false);
    }
  };

  const retryWebhook = async (jobId: string) => {
    if (!apiKey) return;
    setRetryingJobId(jobId);
    try {
      const res = await fetch(`${API}/signatures/webhooks/retry/${jobId}`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        // Actualizar el job en el estado de React
        setRequests((prev) =>
          prev.map((req) => ({
            ...req,
            webhookJobs: req.webhookJobs.map((j) =>
              j.id === jobId ? { ...j, ...data.data } : j,
            ),
          })),
        );
      } else {
        alert(`Error al reintentar: ${data.message || "Error del servidor"}`);
        if (data.data) {
          setRequests((prev) =>
            prev.map((req) => ({
              ...req,
              webhookJobs: req.webhookJobs.map((j) =>
                j.id === jobId ? { ...j, ...data.data } : j,
              ),
            })),
          );
        }
      }
    } catch {
      alert("Error de red al intentar despachar el webhook.");
    } finally {
      setRetryingJobId(null);
    }
  };

  // ── Cargar solicitudes ────────────────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/signatures/requests?page=${page}&limit=10`,
        {
          headers: { "x-api-key": apiKey },
        },
      );
      const data = await res.json();
      if (data.status === "success") {
        setRequests(data.data);
        setPagination(data.pagination);
      }
    } catch {
      // silencioso — mostrar lista vacía
    } finally {
      setLoading(false);
    }
  }, [page, apiKey]);

  useEffect(() => {
    if (apiKeyOk) loadRequests();
  }, [loadRequests, apiKeyOk]);

  // ── Prueba de webhook ─────────────────────────────────────────────────────
  const handleTestWebhook = async () => {
    if (!testUrl || !testFile || !apiKey) return;
    setTesting(true);
    setTestResult(null);

    try {
      const formData = new FormData();
      formData.append("documento", testFile);
      if (testRedirect.trim()) {
        formData.append("redirectUrl", testRedirect.trim());
      }
      formData.append("webhookUrl", testUrl);

      const res = await fetch(`${API}/signatures/request`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.status === "success") {
        setTestResult({
          ok: true,
          message: `✅ Solicitud creada. Comparte el link de firma con el usuario.`,
          signUrl: `${FRONTEND_BASE}/firmar/${data.data.id}`,
        });
        await loadRequests();
      } else {
        setTestResult({
          ok: false,
          message: `❌ Error: ${data.message ?? `HTTP ${res.status}`}`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `❌ Error de red: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="main-content webhook-panel">
      <div
        className="main-header"
        style={{
          padding: 0,
          background: "transparent",
          border: "none",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 className="page-title">Webhooks & Firma Segura</h1>
          <p className="page-count">
            Flujo de firma con criptografía local — la llave privada nunca sale
            del navegador del usuario
          </p>
        </div>
      </div>

      {/* ── API Key ── */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-header">
          <span className="card-title">🔑 Tu API Key</span>
          {apiKeyOk && <span className="badge badge-active">Configurada</span>}
        </div>
        <div className="card-body">
          {!apiKeyOk ? (
            <>
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#666",
                  marginBottom: "0.75rem",
                }}
              >
                Pega tu API Key para usar este panel. La encontrarás en la
                pestaña <strong>API Keys</strong> cuando la generes. Se guardará
                solo durante esta sesión del navegador.
              </p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="wh-api-key-input"
                  type="password"
                  placeholder="Pega tu API Key aquí..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-black"
                  onClick={saveApiKey}
                  disabled={!apiKeyInput.trim()}
                >
                  Guardar
                </button>
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <p style={{ fontSize: "0.8rem", color: "#166534" }}>
                ✅ API Key configurada para esta sesión. Los datos se borrarán
                al cerrar el navegador.
              </p>
              <button
                className="btn btn-danger-outline btn-sm"
                onClick={clearApiKey}
              >
                Cambiar Key
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Panel de prueba / Crear solicitud ── */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-header">
          <span className="card-title">🧪 Crear Solicitud de Firma</span>
          <span style={{ fontSize: "0.72rem", color: "#888" }}>
            Simula el rol del integrador
          </span>
        </div>
        <div className="card-body">
          <p
            style={{
              fontSize: "0.8rem",
              color: "#666",
              marginBottom: "1.25rem",
              lineHeight: "1.6",
            }}
          >
            Sube un documento PDF, indica a dónde redirigir al usuario después
            de firmar y a qué endpoint de tu servidor enviar la notificación
            (webhook). El sistema te devolverá un link único que puedes
            compartir con el usuario para que firme.
          </p>

          <div className="grid-2" style={{ gap: "1rem", marginBottom: "1rem" }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="wh-webhook-url">
                URL del Webhook (servidor a servidor)
              </label>
              <input
                id="wh-webhook-url"
                type="url"
                placeholder="https://tu-servidor.com/webhooks/firma"
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="wh-redirect-url">
                URL de Redirección (para el usuario)
              </label>
              <input
                id="wh-redirect-url"
                type="url"
                placeholder="https://tu-app.com/firma-completada"
                value={testRedirect}
                onChange={(e) => setTestRedirect(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: "1rem" }}>
            <label htmlFor="wh-doc-file">
              Documento a Firmar (PDF, XML, etc.)
            </label>
            <div className="file-input-wrap">
              <input
                id="wh-doc-file"
                type="file"
                accept=".pdf,.xml,.txt"
                onChange={(e) => setTestFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {testFile && (
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#888",
                  marginTop: "0.3rem",
                }}
              >
                📄 {testFile.name} ({formatBytes(testFile.size)})
              </p>
            )}
          </div>

          <button
            className="btn btn-black"
            onClick={handleTestWebhook}
            disabled={!testUrl || !testFile || !apiKey || testing}
          >
            {testing ? "Creando solicitud..." : "Generar Link de Firma →"}
          </button>

          {testResult && (
            <div
              className={`webhook-test-result ${testResult.ok ? "webhook-test-ok" : "webhook-test-fail"}`}
            >
              {testResult.message}
              {testResult.ok && testResult.signUrl && (
                <div style={{ marginTop: "0.75rem" }}>
                  <p
                    style={{
                      marginBottom: "0.35rem",
                      fontFamily: "inherit",
                      fontWeight: 600,
                    }}
                  >
                    🔗 Link para el usuario:
                  </p>
                  <div
                    className="sign-url-box"
                    style={{ background: "#f0fdf4", borderColor: "#bbf7d0" }}
                  >
                    <a
                      href={testResult.signUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sign-url-link"
                    >
                      {testResult.signUrl}
                    </a>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => copyToClipboard(testResult.signUrl!)}
                      title="Copiar al portapapeles"
                    >
                      📋
                    </button>
                    <a
                      href={testResult.signUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline btn-sm"
                    >
                      Abrir
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Guía de integración ── */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-header">
          <span className="card-title">📚 Guía Rápida de Integración</span>
        </div>
        <div className="card-body">
          <div className="code-block">
            <span className="code-comment">
              # Paso 1: Crear solicitud de firma (tu servidor)
            </span>
            {"\n"}
            <span className="code-key">POST</span>{" "}
            <span className="code-string">/api/v1/signatures/request</span>
            {"\n"}
            <span className="code-comment">Headers:</span>{" "}
            <span className="code-string">x-api-key: TU_API_KEY</span>
            {"\n"}
            <span className="code-comment">Body (multipart):</span>
            {"\n"}
            {"  "}
            <span className="code-key">documento</span>:{" "}
            <span className="code-string">[archivo a firmar]</span>
            {"\n"}
            {"  "}
            <span className="code-key">redirectUrl</span>:{" "}
            <span className="code-string">https://tu-app.com/firma-ok</span>
            {"\n"}
            {"  "}
            <span className="code-key">webhookUrl</span>:{" "}
            <span className="code-string">https://tu-servidor.com/webhook</span>
            {"\n"}
            {"  "}
            <span className="code-key">rfc</span>:{" "}
            <span className="code-string">"PEPJ800101XXX" (o el esperado)</span>
            {"\n"}
            {"\n"}
            <span className="code-comment">
              # Respuesta → redirige al usuario a signUrl
            </span>
            {"\n"}
            {"{ "}
            <span className="code-key">signUrl</span>:{" "}
            <span className="code-string">
              "https://firma.tudominio.com/firmar/{"{id}"}"
            </span>
            {" }"}
            {"\n"}
            {"\n"}
            <span className="code-comment">
              # Paso 2: Tu servidor recibe el webhook (firma completada)
            </span>
            {"\n"}
            <span className="code-key">POST</span>{" "}
            <span className="code-string">https://tu-servidor.com/webhook</span>
            {"\n"}
            {"{"}
            {"\n"}
            {"  "}
            <span className="code-key">event</span>:{" "}
            <span className="code-string">"SIGNATURE_COMPLETED"</span>,{"\n"}
            {"  "}
            <span className="code-key">signatureRequestId</span>:{" "}
            <span className="code-string">"uuid"</span>,{"\n"}
            {"  "}
            <span className="code-key">documentHash</span>:{" "}
            <span className="code-string">"sha256..."</span>,{"\n"}
            {"  "}
            <span className="code-key">signatureData</span>:{" "}
            <span className="code-string">"base64..."</span>,{"\n"}
            {"  "}
            <span className="code-key">nom151Stamp</span>:{" "}
            <span className="code-string">null</span>,{"\n"}
            {"  "}
            <span className="code-key">signerName</span>:{" "}
            <span className="code-string">"Juan Pérez"</span>,{"\n"}
            {"  "}
            <span className="code-key">signerRfc</span>:{" "}
            <span className="code-string">"PEPJ800101XXX"</span>
            {"\n"}
            {"}"}
          </div>

          <div
            className="alert alert-success"
            style={{ marginTop: "1rem", fontSize: "0.78rem" }}
          >
            <strong>🔒 Garantía de privacidad:</strong> La llave privada (.key)
            del usuario nunca llega al servidor. La firma RSA-SHA256 se calcula
            100% en el navegador del usuario. Tu servidor solo recibe el
            artefacto de la firma, no las credenciales. Esto confiere{" "}
            <strong>responsabilidad inequívoca al firmante</strong>.
          </div>
        </div>
      </div>

      {/* ── Historial de solicitudes ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            📋 Historial de Solicitudes de Firma
          </span>
          <button
            className="btn btn-outline btn-sm"
            onClick={loadRequests}
            disabled={loading || !apiKey}
          >
            {loading ? "Cargando..." : "↻ Actualizar"}
          </button>
        </div>

        {!apiKey ? (
          <div className="empty-state">
            Configura tu API Key para ver el historial.
          </div>
        ) : loading ? (
          <div className="empty-state">Cargando solicitudes...</div>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            No hay solicitudes de firma aún. Crea una con el formulario de
            arriba.
          </div>
        ) : (
          <div className="card-body" style={{ padding: "0 1.5rem" }}>
            {requests.map((req) => (
              <div key={req.id} className="sig-request-row">
                <div className="sig-request-top">
                  <div>
                    <p className="sig-request-name">📄 {req.documentName}</p>
                    <p className="sig-request-hash">
                      {req.documentHash.substring(0, 32)}…
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    {statusBadge(req.status)}
                    <span style={{ fontSize: "0.72rem", color: "#aaa" }}>
                      {fmtDate(req.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Link de firma (solo si está PENDING) */}
                {req.status === "PENDING" && (
                  <div className="sign-url-box">
                    <a
                      href={`${FRONTEND_BASE}/firmar/${req.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sign-url-link"
                    >
                      {FRONTEND_BASE}/firmar/{req.id}
                    </a>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() =>
                        copyToClipboard(`${FRONTEND_BASE}/firmar/${req.id}`)
                      }
                    >
                      📋 Copiar
                    </button>
                  </div>
                )}

                {/* Datos del firmante (si está SIGNED) */}
                {req.status === "SIGNED" && req.signerName && (
                  <p className="sig-request-meta">
                    ✅ Firmado por: <strong>{req.signerName}</strong> · RFC:{" "}
                    <code>{req.signerRfc}</code>
                  </p>
                )}

                {/* Estado de los webhooks */}
                {req.webhookJobs.length > 0 && (
                  <div
                    style={{
                      marginTop: "1rem",
                      borderTop: "1px dashed #e2e8f0",
                      paddingTop: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "#64748b",
                        marginBottom: "0.5rem",
                      }}
                    >
                      📡 Historial de Envío de Webhooks:
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {req.webhookJobs.map((job) => (
                        <div
                          key={job.id}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                            padding: "0.75rem",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                              }}
                            >
                              <span
                                className={`webhook-job-chip ${job.status.toLowerCase()}`}
                              >
                                {job.status}
                              </span>
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#64748b",
                                  fontWeight: 500,
                                }}
                              >
                                Intento {job.attempts}
                              </span>
                              {job.lastResponseCode && (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    color:
                                      job.status === "SUCCESS"
                                        ? "#16a34a"
                                        : "#dc2626",
                                    background:
                                      job.status === "SUCCESS"
                                        ? "#f0fdf4"
                                        : "#fef2f2",
                                    padding: "0.1rem 0.4rem",
                                    borderRadius: "4px",
                                  }}
                                >
                                  HTTP {job.lastResponseCode}
                                </span>
                              )}
                            </div>

                            <button
                              className="btn btn-outline btn-sm"
                              style={{
                                padding: "0.25rem 0.5rem",
                                fontSize: "0.7rem",
                                height: "auto",
                              }}
                              onClick={() => retryWebhook(job.id)}
                              disabled={retryingJobId === job.id}
                            >
                              {retryingJobId === job.id
                                ? "Enviando..."
                                : "🔁 Reintentar"}
                            </button>
                          </div>

                          <div
                            style={{
                              fontSize: "0.7rem",
                              color: "#64748b",
                              marginTop: "0.35rem",
                            }}
                          >
                            {job.lastAttemptAt && (
                              <span>
                                Último intento: {fmtDate(job.lastAttemptAt)}
                              </span>
                            )}
                            {job.status === "PENDING" && job.nextRetryAt && (
                              <span style={{ marginLeft: "1rem" }}>
                                Próximo reintento programado:{" "}
                                {fmtDate(job.nextRetryAt)}
                              </span>
                            )}
                          </div>

                          {job.lastResponseBody && (
                            <div
                              style={{
                                marginTop: "0.5rem",
                                background: "#0f172a",
                                color: "#38bdf8",
                                padding: "0.5rem",
                                borderRadius: "4px",
                                fontFamily: "monospace",
                                fontSize: "0.68rem",
                                overflowX: "auto",
                                maxHeight: "80px",
                                border: "1px solid #1e293b",
                              }}
                            >
                              <div
                                style={{
                                  color: "#94a3b8",
                                  fontWeight: 600,
                                  marginBottom: "0.25rem",
                                  fontFamily: "inherit",
                                }}
                              >
                                Respuesta del servidor:
                              </div>
                              {job.lastResponseBody}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  className="sig-request-meta"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <span>Webhook destino:</span>
                  {editingReqId === req.id ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                      }}
                    >
                      <input
                        type="text"
                        value={editingUrlValue}
                        onChange={(e) => setEditingUrlValue(e.target.value)}
                        className="input"
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.15rem 0.35rem",
                          width: "250px",
                          borderRadius: "4px",
                          border: "1px solid #ccc",
                          height: "auto",
                        }}
                        disabled={updatingWebhookUrl}
                        placeholder="https://ejemplo.com/webhook"
                      />
                      <button
                        className="btn btn-black btn-sm"
                        style={{
                          padding: "0.15rem 0.5rem",
                          fontSize: "0.7rem",
                          height: "auto",
                        }}
                        onClick={() => saveWebhookUrl(req.id)}
                        disabled={updatingWebhookUrl}
                      >
                        {updatingWebhookUrl ? "..." : "Guardar"}
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{
                          padding: "0.15rem 0.5rem",
                          fontSize: "0.7rem",
                          height: "auto",
                        }}
                        onClick={() => setEditingReqId(null)}
                        disabled={updatingWebhookUrl}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <code style={{ fontSize: "0.68rem" }}>
                        {req.webhookUrl}
                      </code>
                      {req.webhookJobs.some((j) => j.status === "FAILED") && (
                        <button
                          onClick={() => {
                            setEditingReqId(req.id);
                            setEditingUrlValue(req.webhookUrl);
                          }}
                          style={{
                            border: "none",
                            background: "none",
                            color: "#0066cc",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            textDecoration: "underline",
                            padding: 0,
                            marginLeft: "0.25rem",
                          }}
                        >
                          ✏️ Editar URL
                        </button>
                      )}
                    </>
                  )}
                  <span style={{ color: "#aaa" }}>·</span>
                  <span>Expira: {fmtDate(req.expiresAt)}</span>
                </div>
              </div>
            ))}

            {/* Paginación */}
            {pagination && pagination.totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "0.5rem",
                  padding: "1rem 0",
                }}
              >
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  ← Anterior
                </button>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "#888",
                    alignSelf: "center",
                  }}
                >
                  {page} / {pagination.totalPages}
                </span>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    setPage((p) => Math.min(pagination.totalPages, p + 1))
                  }
                  disabled={page === pagination.totalPages}
                >
                  Siguiente →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
