import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import LoginPage from "./components/LoginPage.tsx";
import ForceChangePasswordPage from "./components/ForceChangePassword.tsx";
import AdminLayout from "./components/admin/AdminLayout.tsx";
import AdminClients from "./components/admin/AdminClients.tsx";
import AdminCreateClient from "./components/admin/AdminCreateClient.tsx";
import AdminAudit from "./components/admin/AdminAudit.tsx";
import ClientLayout from "./components/client/ClientLayout.tsx";
import ClientApiKeys from "./components/client/ClientApiKeys.tsx";
import ClientWebhooks from "./components/client/ClientWebhooks.tsx";
import ClientDocuments from "./components/client/ClientDocuments.tsx";
import ClientValidateCert from "./components/client/ClientValidateCert.tsx";
import ClientTestCerts from "./components/client/ClientTestCerts.tsx";
import PublicVerificationPage from "./components/PublicVerification.tsx";
import SignPage from "./components/SignPage.tsx";

function RootRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        Cargando...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return user.role === "SUPER_ADMIN" ? (
    <Navigate to="/admin/clients" replace />
  ) : (
    <Navigate to="/client/apikeys" replace />
  );
}

const router = createBrowserRouter([
  // Rutas Públicas
  {
    path: "/",
    element: <RootRedirect />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/verify/:id",
    element: <PublicVerificationPage />,
  },
  {
    path: "/firmar/:id",
    element: <SignPage />,
  },

  // Rutas que requieren estar autenticado (cualquier rol) pero que no deben saltarse el cambio de contraseña
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/change-password",
        element: <ForceChangePasswordPage />,
      },
    ],
  },

  // Rutas del Super Administrador
  {
    path: "/admin",
    element: <ProtectedRoute allowedRoles={["SUPER_ADMIN"]} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          {
            path: "clients",
            element: <AdminClients />,
          },
          {
            path: "create-client",
            element: <AdminCreateClient />,
          },
          {
            path: "audit",
            element: <AdminAudit />,
          },
        ],
      },
    ],
  },

  // Rutas del Cliente
  {
    path: "/client",
    element: <ProtectedRoute allowedRoles={["CLIENT"]} />,
    children: [
      {
        element: <ClientLayout />,
        children: [
          {
            path: "apikeys",
            element: <ClientApiKeys />,
          },
          {
            path: "webhooks",
            element: <ClientWebhooks />,
          },
          {
            path: "documents",
            element: <ClientDocuments />,
          },
          {
            path: "validate",
            element: <ClientValidateCert />,
          },
          {
            path: "testcerts",
            element: <ClientTestCerts />,
          },
        ],
      },
    ],
  },

  // Fallback para cualquier ruta desconocida
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
