import { useState, useEffect, useCallback } from "react";
import { api, API } from "../../api";
import type { ApiKeyItem } from "../../types";
import { FiEdit3, FiUploadCloud, FiImage, FiX } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";

export default function ClientApiKeys() {
  const { token } = useAuth();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);

  const [editingKey, setEditingKey] = useState<ApiKeyItem | null>(null);
  const [brandingName, setBrandingName] = useState("");
  const [brandingLogo, setBrandingLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const getResolvedLogoUrl = (url: string | null | undefined) => {
    if (!url) return "";
    if (url.startsWith("http") || url.startsWith("data:")) return url;
    return `${API.replace("/api/v1", "")}${url}`;
  };

  const load = useCallback(() => {
    setLoading(true);
    api("/clients/apikeys", token!)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") setKeys(d.data);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  const generate = async () => {
    setMsg(null);
    setRawKey(null);
    setCopied(false);
    const r = await api("/clients/apikeys", token!, { method: "POST" });
    const d = await r.json();
    if (r.ok) {
      setRawKey(d.data.apiKey);
      setMsg({ type: "success", text: "API Key generada." });
      load();
    } else setMsg({ type: "error", text: d.message });
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar esta API Key?")) return;
    const r = await api(`/clients/apikeys/${id}`, token!, { method: "DELETE" });
    const d = await r.json();
    if (r.ok) {
      setMsg({ type: "success", text: "API Key eliminada." });
      load();
    } else setMsg({ type: "error", text: d.message });
  };

  const copy = () => {
    if (rawKey) {
      navigator.clipboard.writeText(rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startEditBranding = (k: ApiKeyItem) => {
    setEditingKey(k);
    setBrandingName(k.name || "");
    setBrandingLogo(null);
    setLogoPreview(k.logoUrl || null);
    setMsg(null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setMsg({ type: "error", text: "Solo se permiten imágenes (PNG, JPG, SVG)." });
      return;
    }
    setBrandingLogo(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const saveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;

    setSaving(true);
    setMsg(null);

    const fd = new FormData();
    fd.append("name", brandingName);
    if (brandingLogo) {
      fd.append("logo", brandingLogo);
    }

    try {
      const r = await fetch(`${API}/clients/apikeys/${editingKey.id}/branding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const d = await r.json();

      if (r.ok && d.status === "success") {
        setMsg({ type: "success", text: "Branding de API Key actualizado correctamente." });
        setEditingKey(null);
        setBrandingLogo(null);
        setLogoPreview(null);
        load();
      } else {
        setMsg({ type: "error", text: d.message || "Error al actualizar branding." });
      }
    } catch {
      setMsg({ type: "error", text: "Error de conexión con el servidor." });
    } finally {
      setSaving(false);
    }
  };

  const curlExample = rawKey
    ? `curl -X POST ${API}/signatures/sign \\
  -H "x-api-key: ${rawKey}" \\
  -F "documento=@mi_documento.pdf" \\
  -F "certificado=@mi_certificado.cer" \\
  -F "llave=@mi_llave.key" \\
  -F "password=mi_contraseña" \\
  -F "cadenaOriginal=||4.0|AAA010101AAA|..."`
    : "";

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">API Keys</div>
          <div className="page-count">
            Llaves de integración para firma programática
          </div>
        </div>
        <button className="btn btn-black" onClick={generate}>
          + Generar API Key
        </button>
      </div>
      <div className="main-content">
        {msg && (
          <div
            className={`alert ${msg.type === "success" ? "alert-success" : "alert-error"}`}
          >
            {msg.text}
          </div>
        )}
        {rawKey && (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="card-header">
              <span className="card-title">
                ⚠️ Guarda tu API Key — solo se muestra una vez
              </span>
            </div>
            <div className="card-body">
              <div className="key-box">
                <span>{rawKey}</span>
                <button className="btn btn-outline btn-sm" onClick={copy}>
                  {copied ? "✓ Copiado" : "Copiar"}
                </button>
              </div>
              <label style={{ marginBottom: "0.25rem" }}>
                Ejemplo de petición HTTP:
              </label>
              <div className="code-block">{curlExample}</div>
            </div>
          </div>
        )}
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Branding (Proyecto)</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5}>Cargando...</td>
                  </tr>
                ) : keys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      Sin API Keys. Genera una para empezar.
                    </td>
                  </tr>
                ) : (
                  keys.map((k) => (
                    <tr key={k.id}>
                      <td className="mono truncate" title={k.id} style={{ maxWidth: "160px" }}>
                        {k.id}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          {k.logoUrl ? (
                            <img
                              src={getResolvedLogoUrl(k.logoUrl)}
                              alt="Logo"
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "4px",
                                objectFit: "contain",
                                background: "#f8fafc",
                                border: "1px solid #e2e8f0",
                                padding: "2px"
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "4px",
                                background: "#f1f5f9",
                                border: "1px dashed #cbd5e1",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#94a3b8",
                                fontSize: "10px"
                              }}
                            >
                              <FiImage />
                            </div>
                          )}
                          <span style={{ fontWeight: 500, color: k.name ? "#1e293b" : "#94a3b8" }}>
                            {k.name || "Sin nombre configurado"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${k.status === "ACTIVE" ? "badge-active" : "badge-revoked"}`}
                        >
                          {k.status === "ACTIVE" ? "Activa" : "Revocada"}
                        </span>
                      </td>
                      <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "8px" }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => startEditBranding(k)}
                            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          >
                            <FiEdit3 size={13} />
                            Configurar
                          </button>
                          <button
                            className="btn btn-danger-outline btn-sm"
                            onClick={() => remove(k.id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal para configurar branding de la API Key */}
      {editingKey && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "500px",
              margin: "1.5rem",
              background: "#ffffff",
              borderRadius: "12px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1rem 1.5rem",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#0f172a" }}>
                Branding de API Key
              </h3>
              <button
                onClick={() => setEditingKey(null)}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "#64748b",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "4px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={saveBranding} style={{ padding: "1.5rem" }}>
              <div style={{ marginBottom: "1.25rem" }}>
                <label
                  htmlFor="brandingName"
                  style={{
                    display: "block",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "#334155",
                    marginBottom: "0.5rem",
                  }}
                >
                  Nombre descriptivo del proyecto
                </label>
                <input
                  type="text"
                  id="brandingName"
                  value={brandingName}
                  onChange={(e) => setBrandingName(e.target.value)}
                  placeholder="Ej. App Móvil de Clientes, Portal Web"
                  className="input-field"
                  required
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "#334155",
                    marginBottom: "0.5rem",
                  }}
                >
                  Logo del proyecto (Sustituye en SignPage)
                </label>

                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  style={{
                    border: dragActive ? "2px dashed #3b82f6" : "2px dashed #cbd5e1",
                    borderRadius: "8px",
                    background: dragActive ? "#eff6ff" : "#f8fafc",
                    padding: "1.5rem",
                    textAlign: "center",
                    cursor: "pointer",
                    position: "relative",
                    transition: "all 0.2s ease",
                  }}
                >
                  {logoPreview ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          width: "80px",
                          height: "80px",
                          borderRadius: "6px",
                          border: "1px solid #e2e8f0",
                          background: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          padding: "4px",
                          marginBottom: "0.75rem",
                        }}
                      >
                        <img
                          src={getResolvedLogoUrl(logoPreview)}
                          alt="Previsualización"
                          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBrandingLogo(null);
                          setLogoPreview(null);
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                      >
                        <FiX size={12} />
                        Quitar Logo
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        color: "#64748b",
                      }}
                    >
                      <FiUploadCloud size={28} style={{ marginBottom: "0.5rem", color: "#94a3b8" }} />
                      <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                        Arrastra una imagen aquí o
                      </span>
                      <label
                        htmlFor="logoFile"
                        style={{
                          fontSize: "0.875rem",
                          color: "#3b82f6",
                          textDecoration: "underline",
                          cursor: "pointer",
                          fontWeight: 500,
                          marginTop: "0.25rem",
                        }}
                      >
                        selecciona un archivo
                      </label>
                      <input
                        type="file"
                        id="logoFile"
                        accept="image/*"
                        onChange={handleFileChange}
                        style={{ display: "none" }}
                      />
                      <span style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.5rem" }}>
                        PNG, JPG o SVG (Recomendado 120x120px)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "10px",
                  borderTop: "1px solid #f1f5f9",
                  paddingTop: "1rem",
                }}
              >
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingKey(null)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-black" disabled={saving}>
                  {saving ? "Guardando..." : "Guardar Branding"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
