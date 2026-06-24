import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../api";
import { useAuth } from "../context/AuthContext";

export default function ForceChangePasswordPage() {
  const { user, token, logout, setUser } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setErr("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErr("Las contraseñas nuevas no coinciden.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`${API}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const d = await r.json();
      if (r.ok && d.status === "success") {
        // Actualizar el estado de cambio de contraseña
        setUser({ ...user, mustChangePassword: false });
        navigate(user.role === "SUPER_ADMIN" ? "/admin/clients" : "/client/documents", { replace: true });
      } else {
        setErr(d.message || "Error al actualizar la contraseña.");
      }
    } catch {
      setErr("No se pudo conectar al servidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box" style={{ maxWidth: "420px" }}>
        <div className="login-logo">🔒 Cambio Obligatorio</div>
        <p className="login-subtitle">
          Por seguridad, debes cambiar la contraseña predeterminada para{" "}
          <strong>{user.email}</strong> antes de continuar.
        </p>
        {err && <div className="alert alert-error">{err}</div>}
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Contraseña Actual</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Contraseña actual"
              required
            />
          </div>
          <div className="form-group">
            <label>Nueva Contraseña (mínimo 8 caracteres)</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nueva contraseña"
              required
            />
          </div>
          <div className="form-group">
            <label>Confirmar Nueva Contraseña</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirmar nueva contraseña"
              required
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button
              className="btn btn-outline"
              type="button"
              onClick={logout}
              style={{ flex: 1 }}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              className="btn btn-black"
              type="submit"
              style={{ flex: 2 }}
              disabled={busy}
            >
              {busy ? "Actualizando..." : "Cambiar Contraseña"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
