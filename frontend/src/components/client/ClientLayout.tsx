import { Outlet } from "react-router-dom";
import Sidebar from "../Sidebar.tsx";

export default function ClientLayout() {
  const links = [
    { path: "/client/apikeys", label: "API Keys", icon: "🔑" },
    { path: "/client/webhooks", label: "Webhooks & Firma Segura", icon: "🔗" },
    { path: "/client/documents", label: "Documentos Firmados", icon: "📄" },
    { path: "/client/validate", label: "Validar Certificado", icon: "🔍" },
    { path: "/client/testcerts", label: "Certificados de Prueba", icon: "🧪" },
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

