import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { api, BACKEND_BASE_URL } from "../../api";
import type { DocItem } from "../../types";
import { useAuth } from "../../context/AuthContext";

export default function ClientDocuments() {
  const { token } = useAuth();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<DocItem | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const handleDownload = async (docId: string) => {
    try {
      const r = await api(`/documents/${docId}/download-url`, token!);
      const d = await r.json();
      if (r.ok && d.status === "success" && d.data.url) {
        const downloadUrl = d.data.url.startsWith("/api/")
          ? `${BACKEND_BASE_URL}${d.data.url}`
          : d.data.url;
        window.open(downloadUrl, "_blank");
      } else {
        alert(d.message || "Error al obtener la URL de descarga.");
      }
    } catch (err) {
      alert("Error de conexión al obtener la URL de descarga.");
    }
  };

  const handleDownloadStamped = async (docId: string) => {
    try {
      const r = await api(`/documents/${docId}/download-url?type=stamped`, token!);
      const d = await r.json();
      if (r.ok && d.status === "success" && d.data.url) {
        const downloadUrl = d.data.url.startsWith("/api/")
          ? `${BACKEND_BASE_URL}${d.data.url}`
          : d.data.url;
        window.open(downloadUrl, "_blank");
      } else {
        alert(d.message || "Error al obtener la URL de descarga del estampado.");
      }
    } catch (err) {
      alert("Error de conexión al obtener la URL de descarga del estampado.");
    }
  };

  useEffect(() => {
    if (selectedDoc) {
      QRCode.toDataURL(`${window.location.origin}/verify/${selectedDoc.id}`)
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error("Error generating QR code", err));
    } else {
      setQrDataUrl("");
    }
  }, [selectedDoc]);

  useEffect(() => {
    api("/clients/documents", token!)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") setDocs(d.data);
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Documentos Firmados</div>
          <div className="page-count">{docs.length} documentos firmados</div>
        </div>
      </div>
      <div className="main-content">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: selectedDoc ? "1fr 360px" : "1fr",
            gap: "1.5rem",
            transition: "all 0.3s ease",
          }}
        >
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Firmante / ID</th>
                    <th>RFC</th>
                    <th>Fecha de Firma</th>
                    <th>Hash Documento</th>
                    <th>Estampado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6}>Cargando...</td>
                    </tr>
                  ) : docs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        Sin documentos firmados aún.
                      </td>
                    </tr>
                  ) : (
                    docs.map((d) => {
                      return (
                        <tr
                          key={d.id}
                          style={{
                            cursor: "pointer",
                            background:
                              selectedDoc?.id === d.id ? "#fafafa" : "",
                          }}
                          onClick={() => setSelectedDoc(d)}
                        >
                          <td>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                              }}
                            >
                              <span style={{ fontSize: "1.25rem" }}>📄</span>
                              <div>
                                <div style={{ fontWeight: 600 }}>
                                  {d.signerName || "Desconocido"}
                                </div>
                                <div
                                  style={{ fontSize: "0.75rem", color: "#888" }}
                                  className="mono"
                                >
                                  {d.id.substring(0, 8)}...
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="mono">
                            {d.signerRfc || "Desconocido"}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {new Date(d.createdAt).toLocaleString()}
                          </td>
                          <td className="mono truncate" title={d.documentHash}>
                            {d.documentHash}
                          </td>
                          <td>
                            {d.stampedS3Url ? (
                              <button
                                className="btn btn-outline btn-sm"
                                style={{
                                  borderColor: "#16a34a",
                                  color: "#16a34a",
                                  fontWeight: 500,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownloadStamped(d.id);
                                }}
                              >
                                📥 Descargar Estampado
                              </button>
                            ) : (
                              <span style={{ color: "#aaa", fontSize: "0.85rem" }}>— No subido</span>
                            )}
                          </td>
                          <td>
                            <div
                              style={{ display: "flex", gap: "0.4rem" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => setSelectedDoc(d)}
                              >
                                Ver Sello
                              </button>
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => handleDownload(d.id)}
                              >
                                Descargar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedDoc && (
            <div
              className="card"
              style={{
                display: "flex",
                flexDirection: "column",
                height: "fit-content",
              }}
            >
              <div
                className="card-header"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="card-title">Detalles del Sello Digital</span>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setSelectedDoc(null)}
                >
                  ✕ Cerrar
                </button>
              </div>
              <div className="card-body" style={{ fontSize: "0.8rem" }}>
                <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
                  <img
                    src={qrDataUrl}
                    alt="QR Code"
                    style={{
                      border: "1px solid #eee",
                      padding: "0.5rem",
                      background: "#fff",
                    }}
                  />
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#888",
                      marginTop: "0.5rem",
                    }}
                  >
                    Escanear QR para verificar autenticidad
                  </div>
                </div>
                <div className="form-group">
                  <label>Firmante</label>
                  <div>{selectedDoc.signerName || "Desconocido"}</div>
                </div>
                <div className="form-group">
                  <label>RFC</label>
                  <div className="mono">
                    {selectedDoc.signerRfc || "Desconocido"}
                  </div>
                </div>
                <div className="form-group">
                  <label>Fecha y Hora Exacta</label>
                  <div>{new Date(selectedDoc.createdAt).toLocaleString()}</div>
                </div>
                <div className="form-group">
                  <label>Sello Digital (Firma en Base64)</label>
                  <div
                    className="mono"
                    style={{
                      wordBreak: "break-all",
                      maxHeight: "80px",
                      overflowY: "auto",
                      background: "#fafafa",
                      padding: "0.4rem",
                      border: "1px solid #eee",
                      borderRadius: "4px",
                    }}
                  >
                    {selectedDoc.signatureString}
                  </div>
                </div>
                <div className="form-group">
                  <label>Cadena Original</label>
                  <div
                    className="mono"
                    style={{
                      wordBreak: "break-all",
                      maxHeight: "80px",
                      overflowY: "auto",
                      background: "#fafafa",
                      padding: "0.4rem",
                      border: "1px solid #eee",
                      borderRadius: "4px",
                    }}
                  >
                    {selectedDoc.cadenaOriginal || "—"}
                  </div>
                </div>
                <div className="form-group">
                  <label>Hash SHA-256</label>
                  <div className="mono" style={{ wordBreak: "break-all" }}>
                    {selectedDoc.documentHash}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
