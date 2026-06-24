import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../api";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const { login, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      if (user.mustChangePassword) {
        navigate("/change-password", { replace: true });
      } else if (user.role === "SUPER_ADMIN") {
        navigate("/admin/clients", { replace: true });
      } else {
        navigate("/client/documents", { replace: true });
      }
    }
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (r.ok && d.status === "success") {
        login(d.data.token, d.data.user);
      } else {
        setErr(d.message || "Error");
      }
    } catch {
      setErr("No se pudo conectar al servidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">Open Signer</div>
        <p className="login-subtitle">Microservicio de Firma Electrónica</p>
        {err && <div className="alert alert-error">{err}</div>}
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Correo Electrónico</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@opensigner.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button
            className="btn btn-black"
            type="submit"
            style={{ width: "100%" }}
            disabled={busy}
          >
            {busy ? "Verificando..." : "Iniciar Sesión"}
          </button>
        </form>
        <div className="login-hint">
          Primera vez: si la BD está vacía, usa <code>admin@opensigner.com</code>{" "}
          / <code>admin12345</code>
        </div>
      </div>
    </div>
  );
}
