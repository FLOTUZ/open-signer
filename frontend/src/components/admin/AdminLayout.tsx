import { Outlet } from "react-router-dom";
import Sidebar from "../Sidebar.tsx";

export default function AdminLayout() {
  const links = [
    { path: "/admin/clients", label: "Clientes", icon: "👥" },
    { path: "/admin/create-client", label: "Registrar Usuario", icon: "➕" },
    { path: "/admin/audit", label: "Bitácora", icon: "📋" },
  ];

  return (
    <div className="layout">
      <Sidebar links={links} />
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
