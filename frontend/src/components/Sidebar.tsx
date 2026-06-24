import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Sidebar({
  links,
}: {
  links: { path: string; label: string; icon: string }[];
}) {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initials = (user.name || user.email).substring(0, 2).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name || user.email}</div>
            <div className="sidebar-user-role">
              {user.role === "SUPER_ADMIN" ? "Super Admin" : "Cliente"}
            </div>
          </div>
        </div>
      </div>
      <div className="sidebar-section-label">Menú</div>
      <nav className="sidebar-nav">
        {links.map((l) => (
          <NavLink
            key={l.path}
            to={l.path}
            className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <span>{l.icon}</span> {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button onClick={logout}>↩ Cerrar Sesión</button>
      </div>
    </aside>
  );
}
