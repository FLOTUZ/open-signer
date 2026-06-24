import { useState, useEffect } from "react";
import { api } from "../../api";
import type { User } from "../../types";
import { useAuth } from "../../context/AuthContext";

export default function AdminClients() {
  const { token } = useAuth();
  const [clients, setClients] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetModal, setResetModal] = useState<{
    userId: string;
    email: string;
  } | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchUsers = () => {
    setLoading(true);
    api("/admin/users", token!)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") setClients(d.data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleReset = async () => {
    if (!resetModal) return;
    setResetting(true);
    const r = await api(
      `/admin/users/${resetModal.userId}/reset-password`,
      token!,
      { method: "POST" },
    );
    const d = await r.json();
    if (r.ok && d.status === "success") {
      setTempPassword(d.data.temporaryPassword);
    } else {
      alert(d.message || "Error al restablecer contraseña");
      setResetModal(null);
    }
    setResetting(false);
  };

  return (
    <>
      {/* Modal de contraseña temporal */}
      {resetModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 440, width: "90%", padding: "2rem" }}
          >
            {!tempPassword ? (
              <>
                <div className="card-title" style={{ marginBottom: "1rem" }}>
                  ⚠️ Invalidar Contraseña
                </div>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "#555",
                    marginBottom: "1.5rem",
                  }}
                >
                  Se generará una contraseña temporal para{" "}
                  <strong>{resetModal.email}</strong>. El usuario deberá
                  cambiarla en su próximo inicio de sesión.
                </p>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    className="btn btn-outline"
                    onClick={() => setResetModal(null)}
                    style={{ flex: 1 }}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-black"
                    onClick={handleReset}
                    disabled={resetting}
                    style={{ flex: 1 }}
                  >
                    {resetting ? "Generando..." : "Confirmar"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="card-title" style={{ marginBottom: "1rem" }}>
                  ✅ Contraseña Temporal Generada
                </div>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "#555",
                    marginBottom: "0.75rem",
                  }}
                >
                  Comparte esta contraseña de forma segura.{" "}
                  <strong>No podrás verla de nuevo.</strong>
                </p>
                <div className="key-box" style={{ marginBottom: "1.25rem" }}>
                  <span className="mono">{tempPassword}</span>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(tempPassword!);
                      setCopied(true);
                    }}
                  >
                    {copied ? "✓ Copiado" : "Copiar"}
                  </button>
                </div>
                <button
                  className="btn btn-black"
                  style={{ width: "100%" }}
                  onClick={() => {
                    setResetModal(null);
                    setTempPassword(null);
                    setCopied(false);
                  }}
                >
                  Cerrar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="main-header">
        <div>
          <div className="page-title">Usuarios</div>
          <div className="page-count">
            {clients.length} usuarios registrados
          </div>
        </div>
      </div>
      <div className="main-content">
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Fecha Registro</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>Cargando...</td>
                  </tr>
                ) : clients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      Sin usuarios
                    </td>
                  </tr>
                ) : (
                  clients.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>
                        {c.name || (
                          <span style={{ color: "#aaa", fontStyle: "italic" }}>
                            Sin nombre
                          </span>
                        )}
                      </td>
                      <td>{c.email}</td>
                      <td>
                        <span
                          className={`badge ${c.role === "SUPER_ADMIN" ? "badge-admin" : "badge-client"}`}
                        >
                          {c.role}
                        </span>
                      </td>
                      <td>
                        {c.mustChangePassword ? (
                          <span className="badge badge-revoked">
                            Cambio pendiente
                          </span>
                        ) : (
                          <span className="badge badge-active">Activo</span>
                        )}
                      </td>
                      <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button
                          className="btn btn-danger-outline btn-sm"
                          onClick={() => {
                            setResetModal({ userId: c.id, email: c.email });
                            setTempPassword(null);
                            setCopied(false);
                          }}
                        >
                          🔑 Invalidar Contraseña
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
