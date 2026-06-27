import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API, BACKEND_BASE_URL } from "../api";

export default function PublicVerificationPage({ docId: propDocId }: { docId?: string }) {
  const { id: paramDocId } = useParams<{ id: string }>();
  const docId = propDocId || paramDocId || "";
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docId) {
      setError("Falta el identificador del documento.");
      setLoading(false);
      return;
    }
    fetch(`${API}/signatures/verify/${docId.trim()}`)
      .then(async (r) => {
        const json = await r.json();
        if (r.ok && json.status === "success") {
          setData(json.data);
        } else {
          setError(
            json.message || "El documento no existe o el enlace es inválido.",
          );
        }
      })
      .catch(() => setError("Error de conexión con el servidor."))
      .finally(() => setLoading(false));
  }, [docId]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#f5f5f5",
        }}
      >
        <div style={{ fontWeight: 600 }}>Verificando Documento...</div>
      </div>
    );
  }

  const url = data?.s3Url.startsWith("/uploads/")
    ? `${BACKEND_BASE_URL}${data.s3Url}`
    : data?.s3Url;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f5f5f5",
        padding: "1.5rem",
      }}
    >
      <div className="card" style={{ maxWidth: "600px", width: "100%" }}>
        {error ? (
          <div
            className="card-body"
            style={{ textAlign: "center", padding: "3rem 2rem" }}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>❌</div>
            <h2 style={{ fontWeight: 700, marginBottom: "0.5rem" }}>
              Documento No Válido
            </h2>
            <p
              style={{
                color: "#888",
                fontSize: "0.9rem",
                marginBottom: "2rem",
              }}
            >
              {error}
            </p>
            <a
              href="/"
              className="btn btn-black"
              style={{ textDecoration: "none" }}
            >
              Volver al Portal
            </a>
          </div>
        ) : (
          <div>
            <div
              className="card-body"
              style={{
                textAlign: "center",
                borderBottom: "1px solid #e8e8e8",
                padding: "2.5rem 2rem 1.5rem",
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🛡️</div>
              <h2
                style={{
                  fontWeight: 700,
                  color: "#166534",
                  marginBottom: "0.25rem",
                }}
              >
                Documento Verificado
              </h2>
              <p
                style={{
                  color: "#166534",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  background: "#f0fdf4",
                  display: "inline-block",
                  padding: "0.25rem 0.75rem",
                  borderRadius: "20px",
                }}
              >
                ✓ Auténtico y No Alterado
              </p>
              <p
                style={{ color: "#888", fontSize: "0.8rem", marginTop: "1rem" }}
              >
                Este documento ha sido firmado electrónicamente a través de
                Open Signer con certificados válidos.
              </p>
            </div>

            <div className="card-body">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1rem",
                  marginBottom: "1.5rem",
                }}
              >
                <div>
                  <label>Nombre del Firmante</label>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    {data.signerName || "Desconocido"}
                  </div>
                </div>
                <div>
                  <label>RFC del Firmante</label>
                  <div
                    className="mono"
                    style={{ fontWeight: 600, fontSize: "0.9rem" }}
                  >
                    {data.signerRfc || "Desconocido"}
                  </div>
                </div>
                <div>
                  <label>Fecha y Hora de Firma</label>
                  <div style={{ fontSize: "0.85rem" }}>
                    {new Date(data.createdAt).toLocaleString()}
                  </div>
                </div>
                <div>
                  <label>Identificador Unico</label>
                  <div className="mono" style={{ fontSize: "0.85rem" }}>
                    {data.id}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Hash SHA-256 del Documento</label>
                <div
                  className="mono"
                  style={{
                    fontSize: "0.8rem",
                    background: "#fafafa",
                    padding: "0.5rem",
                    border: "1px solid #eee",
                    borderRadius: "4px",
                    wordBreak: "break-all",
                  }}
                >
                  {data.documentHash}
                </div>
              </div>

              <div className="form-group">
                <label>Sello Digital (Firma Electrónica)</label>
                <div
                  className="mono"
                  style={{
                    fontSize: "0.75rem",
                    background: "#fafafa",
                    padding: "0.5rem",
                    border: "1px solid #eee",
                    borderRadius: "4px",
                    wordBreak: "break-all",
                    maxHeight: "100px",
                    overflowY: "auto",
                  }}
                >
                  {data.signatureString}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "2rem" }}>
                <label>Cadena Original</label>
                <div
                  className="mono"
                  style={{
                    fontSize: "0.75rem",
                    background: "#fafafa",
                    padding: "0.5rem",
                    border: "1px solid #eee",
                    borderRadius: "4px",
                    wordBreak: "break-all",
                    maxHeight: "100px",
                    overflowY: "auto",
                  }}
                >
                  {data.cadenaOriginal}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  justifyContent: "center",
                }}
              >
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-black"
                    style={{ textDecoration: "none" }}
                  >
                    Descargar Documento Original
                  </a>
                )}
                <a
                  href="/"
                  className="btn btn-outline"
                  style={{ textDecoration: "none" }}
                >
                  Ir al Portal de Firma
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
