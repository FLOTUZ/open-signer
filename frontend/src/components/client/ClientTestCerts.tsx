import { useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";

export default function ClientTestCerts() {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{
    certificate: { base64: string; filename: string };
    privateKey: { base64: string; filename: string };
    password: string;
  } | null>(null);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    setData(null);
    try {
      const r = await api("/clients/test-certificates", token!, {
        method: "POST",
      });
      const d = await r.json();
      if (r.ok) {
        setData(d.data);
        setMsg({ type: "success", text: "Certificados de prueba generados." });
      } else setMsg({ type: "error", text: d.message });
    } catch {
      setMsg({ type: "error", text: "Error de conexión." });
    } finally {
      setBusy(false);
    }
  };

  const download = (base64: string, filename: string) => {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Certificados de Prueba</div>
          <div className="page-count">
            Genera un par .cer / .key auto-firmados para pruebas locales
          </div>
        </div>
      </div>
      <div className="main-content">
        {msg && (
          <div
            className={`alert ${msg.type === "success" ? "alert-success" : "alert-error"}`}
          >
            {msg.text}
          </div>
        )}
        <div className="card card-compact">
          <div className="card-body">
            <p
              style={{
                color: "#888",
                fontSize: "0.85rem",
                marginBottom: "1rem",
              }}
            >
              Estos certificados son auto-firmados y{" "}
              <strong>NO son válidos</strong> para el SAT real. Úsalos para
              probar la integración de firma.
            </p>
            <button
              className="btn btn-black"
              onClick={generate}
              disabled={busy}
            >
              {busy ? "Generando..." : "Generar Certificados"}
            </button>
            {data && (
              <div style={{ marginTop: "1.5rem" }}>
                <div className="form-group">
                  <label>Contraseña de la llave privada</label>
                  <div className="key-box">
                    <span>{data.password}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    className="btn btn-outline"
                    onClick={() =>
                      download(
                        data.certificate.base64,
                        data.certificate.filename,
                      )
                    }
                  >
                    ⬇ Descargar {data.certificate.filename}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() =>
                      download(data.privateKey.base64, data.privateKey.filename)
                    }
                  >
                    ⬇ Descargar {data.privateKey.filename}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
