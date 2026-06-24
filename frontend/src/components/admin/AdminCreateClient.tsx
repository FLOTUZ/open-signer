import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../api.ts";
import { useAuth } from "../../context/AuthContext";

const generatePassword = () => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
  let pwd = "";
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
};

export default function AdminCreateClient() {
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"CLIENT" | "SUPER_ADMIN">("CLIENT");
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Estados para el modal de éxito
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdEmail, setCreatedEmail] = useState("");
  const [createdPassword, setCreatedPassword] = useState("");
  const [createdRole, setCreatedRole] = useState<"CLIENT" | "SUPER_ADMIN">("CLIENT");
  const [modalCopied, setModalCopied] = useState(false);

  const handleModalCopy = () => {
    navigator.clipboard.writeText(createdPassword);
    setModalCopied(true);
    setTimeout(() => setModalCopied(false), 2000);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const generated = generatePassword();
    const r = await api("/admin/users", token!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || undefined,
        email,
        password: generated,
        role: role,
      }),
    });
    const d = await r.json();
    if (r.ok) {
      setCreatedEmail(email);
      setCreatedPassword(generated);
      setCreatedRole(role);
      setShowSuccessModal(true);
      
      setName("");
      setEmail("");
      setRole("CLIENT");
    } else {
      setMsg({ type: "error", text: d.message });
    }
    setBusy(false);
  };

  return (
    <>
      {/* Modal de éxito con contraseña generada lista para copiar */}
      {showSuccessModal && (
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
            <div className="card-title" style={{ marginBottom: "1rem" }}>
              ✅ {createdRole === "SUPER_ADMIN" ? "Administrador" : "Cliente"} Registrado
            </div>
            <p
              style={{
                fontSize: "0.875rem",
                color: "#555",
                marginBottom: "0.75rem",
              }}
            >
              El {createdRole === "SUPER_ADMIN" ? "administrador" : "cliente"} <strong>{createdEmail}</strong> ha sido creado exitosamente.
              Comparte la siguiente contraseña inicial. <strong>No podrás verla de nuevo.</strong>
            </p>
            <div className="key-box" style={{ marginBottom: "1.25rem" }}>
              <span className="mono">{createdPassword}</span>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleModalCopy}
              >
                {modalCopied ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
            <button
              className="btn btn-black w-full"
              onClick={() => setShowSuccessModal(false)}
            >
              Entendido / Cerrar
            </button>
          </div>
        </div>
      )}

      <div className="main-header">
        <div className="page-title">Registrar {role === "SUPER_ADMIN" ? "Administrador" : "Cliente"}</div>
      </div>
      <div className="main-content">
        <div className="card card-compact">
          <div className="card-body">
            {msg && (
              <div
                className={`alert ${msg.type === "success" ? "alert-success" : "alert-error"}`}
              >
                {msg.text}
              </div>
            )}
            <form onSubmit={submit}>
              <div className="form-group">
                <label>Nombre completo</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Juan Pérez López"
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  required
                />
              </div>
              <div className="form-group">
                <label>Rol de Usuario</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "CLIENT" | "SUPER_ADMIN")}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    fontSize: "0.875rem",
                    background: "#fff",
                  }}
                >
                  <option value="CLIENT">Cliente (Integrador)</option>
                  <option value="SUPER_ADMIN">Administrador (Super Admin)</option>
                </select>
              </div>
              <button className="btn btn-black" disabled={busy}>
                {busy ? "Creando..." : "Crear Cuenta"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
