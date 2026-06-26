import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

interface ProtectedRouteProps {
  allowedRoles?: ("SUPER_ADMIN" | "CLIENT")[];
}

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

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

  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  if (!user.mustChangePassword && location.pathname === "/change-password") {
    const fallbackPath = user.role === "SUPER_ADMIN" ? "/admin/clients" : "/client/documents";
    return <Navigate to={fallbackPath} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role as any)) {
    // Redirigir al inicio o panel correspondiente según su rol real
    const fallbackPath = user.role === "SUPER_ADMIN" ? "/admin/clients" : "/client/documents";
    return <Navigate to={fallbackPath} replace />;
  }

  return <Outlet />;
}
