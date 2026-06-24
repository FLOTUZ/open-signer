import { useState, useEffect, useCallback } from "react";
import type { FormEvent } from "react";
import { api } from "../../api";
import type { AuditItem } from "../../types";
import { useAuth } from "../../context/AuthContext";

export default function AdminAudit() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [method, setMethod] = useState("");
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const LIMIT = 20;

  const fetchLogs = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(LIMIT),
    });
    if (method) params.set("method", method);
    if (role) params.set("role", role);
    if (search) params.set("search", search);
    api(`/admin/audit-logs?${params}`, token!)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") {
          setLogs(d.data);
          setTotal(d.pagination.total);
          setTotalPages(d.pagination.totalPages);
        }
      })
      .finally(() => setLoading(false));
  }, [token, page, method, role, search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const applySearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const methodColor: Record<string, string> = {
    GET: "#0284c7",
    POST: "#16a34a",
    PUT: "#d97706",
    DELETE: "#dc2626",
  };

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Bitácora de Auditoría</div>
          <div className="page-count">{total} registros</div>
        </div>
      </div>
      <div className="main-content">
        {/* Filtros */}
        <div className="card card-compact" style={{ marginBottom: "1rem" }}>
          <div
            className="card-body"
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            <div
              className="form-group"
              style={{ margin: 0, flex: "1 1 140px" }}
            >
              <label style={{ fontSize: "0.75rem" }}>Método HTTP</label>
              <select
                value={method}
                onChange={(e) => {
                  setPage(1);
                  setMethod(e.target.value);
                }}
                style={{
                  width: "100%",
                  height: 36,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "0 0.5rem",
                }}
              >
                <option value="">Todos</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div
              className="form-group"
              style={{ margin: 0, flex: "1 1 140px" }}
            >
              <label style={{ fontSize: "0.75rem" }}>Rol</label>
              <select
                value={role}
                onChange={(e) => {
                  setPage(1);
                  setRole(e.target.value);
                }}
                style={{
                  width: "100%",
                  height: 36,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "0 0.5rem",
                }}
              >
                <option value="">Todos</option>
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="CLIENT">Cliente</option>
              </select>
            </div>
            <form
              onSubmit={applySearch}
              style={{
                display: "flex",
                gap: "0.5rem",
                flex: "2 1 220px",
                alignItems: "flex-end",
              }}
            >
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label style={{ fontSize: "0.75rem" }}>
                  Buscar usuario / endpoint
                </label>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Buscar..."
                  style={{ height: 36 }}
                />
              </div>
              <button
                type="submit"
                className="btn btn-outline btn-sm"
                style={{ height: 36, alignSelf: "flex-end" }}
              >
                Buscar
              </button>
              {(search || method || role) && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ height: 36, alignSelf: "flex-end" }}
                  onClick={() => {
                    setMethod("");
                    setRole("");
                    setSearch("");
                    setSearchInput("");
                    setPage(1);
                  }}
                >
                  ✕ Limpiar
                </button>
              )}
            </form>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Método</th>
                  <th>Acción</th>
                  <th>Endpoint</th>
                  <th>IP</th>
                  <th>Usuario / Nombre</th>
                  <th>Rol</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7}>Cargando...</td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      Sin registros
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                        {new Date(l.timestamp).toLocaleString()}
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            color: "#fff",
                            background: methodColor[l.method] || "#666",
                          }}
                        >
                          {l.method}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.85rem", color: "#374151", minWidth: "220px" }}>
                        {l.description}
                      </td>
                      <td
                        className="mono truncate"
                        title={l.endpoint}
                        style={{ fontSize: "0.78rem", maxWidth: "180px" }}
                      >
                        {l.endpoint}
                      </td>
                      <td className="mono" style={{ fontSize: "0.78rem" }}>
                        {l.originIp}
                      </td>
                      <td style={{ fontSize: "0.85rem" }}>
                        {l.username || <span style={{ color: "#aaa" }}>—</span>}
                      </td>
                      <td>
                        {l.role ? (
                          <span
                            className={`badge ${l.role === "SUPER_ADMIN" ? "badge-admin" : "badge-client"}`}
                          >
                            {l.role}
                          </span>
                        ) : (
                          <span style={{ color: "#aaa" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.75rem",
                padding: "1rem",
                borderTop: "1px solid #f0f0f0",
              }}
            >
              <button
                className="btn btn-outline btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Anterior
              </button>
              <span style={{ fontSize: "0.85rem", color: "#555" }}>
                Página {page} de {totalPages}
              </span>
              <button
                className="btn btn-outline btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente →
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
