import React, { useState } from "react";
import { API } from "../../api";
import type { CertValidationAprobado, CertValidationRechazado, CertValidationResult } from "../../types";
import { useAuth } from "../../context/AuthContext";

export default function ClientValidateCert() {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CertValidationResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setError(null);

    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);

    try {
      const r = await fetch(`${API}/certificates/validate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const d: CertValidationResult = await r.json();
      setResult(d);
    } catch {
      setError("Error de conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  const isAprobado = result?.resultado === "APROBADO";
  const aprobadoData = isAprobado ? (result as CertValidationAprobado) : null;
  const rechazadoData =
    !isAprobado && result ? (result as CertValidationRechazado) : null;

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Validar Certificado e.firma</div>
          <div className="page-count">
            Inspección defensiva de certificados X.509 del SAT
          </div>
        </div>
      </div>
      <div className="main-content">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="grid-2">
          {/* Panel de carga */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">📤 Cargar Certificado</span>
            </div>
            <div className="card-body">
              <form onSubmit={handleSubmit} id="validate-cert-form">
                <div className="form-group">
                  <label>Archivo del certificado (.cer)</label>
                  <div className="file-input-wrap">
                    <input
                      type="file"
                      name="certificado"
                      accept=".cer"
                      required
                      onChange={(e) =>
                        setFileName(e.target.files?.[0]?.name || "")
                      }
                    />
                  </div>
                  {fileName && (
                    <div
                      style={{
                        marginTop: "0.5rem",
                        fontSize: "0.78rem",
                        color: "#555",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                      }}
                    >
                      <span>📎</span> <span className="mono">{fileName}</span>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: "#fafafa",
                    border: "1px solid #eee",
                    borderRadius: "6px",
                    padding: "0.75rem",
                    marginBottom: "1.25rem",
                    fontSize: "0.75rem",
                    color: "#666",
                  }}
                >
                  <strong>¿Qué se valida?</strong>
                  <br />
                  <ul
                    style={{
                      margin: "0.4rem 0 0 1rem",
                      padding: 0,
                      lineHeight: "1.7",
                    }}
                  >
                    <li>
                      ✅ Emisor autorizado por el <strong>SAT</strong>
                    </li>
                    <li>
                      ✅ Vigencia temporal (<em>notBefore</em> /{" "}
                      <em>notAfter</em>)
                    </li>
                    <li>✅ Identidad: CN, RFC y CURP del titular</li>
                  </ul>
                </div>

                <button
                  className="btn btn-black"
                  disabled={busy}
                  style={{ width: "100%" }}
                >
                  {busy ? "Validando..." : "🔍 Validar Certificado"}
                </button>
              </form>
            </div>
          </div>

          {/* Panel de resultado */}
          {result && (
            <div
              className="card"
              style={{
                borderLeft: `4px solid ${isAprobado ? "#16a34a" : "#dc2626"}`,
                animation: "fadeSlideIn 0.35s ease",
              }}
            >
              <div
                className="card-header"
                style={{ background: isAprobado ? "#f0fdf4" : "#fef2f2" }}
              >
                <span
                  className="card-title"
                  style={{ color: isAprobado ? "#15803d" : "#b91c1c" }}
                >
                  {isAprobado
                    ? "✅ Certificado APROBADO"
                    : "❌ Certificado RECHAZADO"}
                </span>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    fontFamily: "monospace",
                    background: isAprobado ? "#dcfce7" : "#fee2e2",
                    color: isAprobado ? "#166534" : "#991b1b",
                    padding: "0.2rem 0.6rem",
                    borderRadius: "20px",
                  }}
                >
                  {result.codigo_estado}
                </span>
              </div>

              <div className="card-body">
                {/* ── APROBADO ── */}
                {aprobadoData && (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "1rem",
                        marginBottom: "1rem",
                      }}
                    >
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Titular / Razón Social</label>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {aprobadoData.metadata.titular_nombre}
                        </div>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>RFC</label>
                        <div
                          className="mono"
                          style={{
                            fontWeight: 700,
                            fontSize: "0.9rem",
                            color: "#1d4ed8",
                          }}
                        >
                          {aprobadoData.metadata.titular_rfc}
                        </div>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>CURP</label>
                        <div className="mono" style={{ fontSize: "0.85rem" }}>
                          {aprobadoData.metadata.titular_curp ?? (
                            <em style={{ color: "#aaa" }}>No disponible</em>
                          )}
                        </div>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Válido hasta</label>
                        <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                          {new Date(
                            aprobadoData.metadata.valido_hasta,
                          ).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Número de Serie del Certificado</label>
                      <div
                        className="mono"
                        style={{
                          fontSize: "0.8rem",
                          background: "#fafafa",
                          padding: "0.4rem 0.6rem",
                          border: "1px solid #eee",
                          borderRadius: "4px",
                          wordBreak: "break-all",
                        }}
                      >
                        {aprobadoData.metadata.numero_serie}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: "0.5rem",
                        padding: "0.75rem 1rem",
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: "6px",
                        fontSize: "0.78rem",
                        color: "#166534",
                      }}
                    >
                      🛡️ <strong>Tres reglas superadas:</strong> emisor SAT
                      confirmado · vigencia activa · identidad extraída
                      correctamente.
                    </div>
                  </>
                )}

                {/* ── RECHAZADO ── */}
                {rechazadoData && (
                  <>
                    <div
                      style={{
                        padding: "0.85rem 1rem",
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: "6px",
                        fontSize: "0.82rem",
                        color: "#7f1d1d",
                        lineHeight: 1.55,
                      }}
                    >
                      <strong>Motivo técnico:</strong>
                      <br />
                      <span
                        style={{ fontFamily: "monospace", fontSize: "0.78rem" }}
                      >
                        {rechazadoData.detalles}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: "1rem",
                        fontSize: "0.75rem",
                        color: "#999",
                      }}
                    >
                      ℹ️ Este resultado queda registrado para auditoría. No se
                      almacena ningún dato del certificado.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
