import { Navigate, Route, Routes } from "react-router";
import { RequestsAdmin } from "./components/admin/RequestsAdmin";
import { ResourcesAdmin } from "./components/admin/ResourcesAdmin";
import { RoomsAdmin } from "./components/admin/RoomsAdmin";
import { AppShell } from "./components/layout/AppShell";
import { Login } from "./components/Login";
import { MyReservations } from "./components/solicitante/MyReservations";
import { ReservationPage } from "./components/solicitante/ReservationForm";
import { RoomSearch } from "./components/solicitante/RoomSearch";
import { LogoMark } from "./components/ui/Logo";
import { useAuth } from "./lib/auth";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-label="Carregando">
        <LogoMark className="size-14 animate-pulse" />
      </div>
    );
  }
  if (!user) return <Login />;

  // Cada papel tem suas telas; qualquer outro endereço cai na tela inicial do papel.
  return (
    <Routes>
      <Route element={<AppShell />}>
        {user.role === "ADMIN" ? (
          <>
            <Route path="/admin/solicitacoes" element={<RequestsAdmin />} />
            <Route path="/admin/salas" element={<RoomsAdmin />} />
            <Route path="/admin/recursos" element={<ResourcesAdmin />} />
            <Route path="*" element={<Navigate to="/admin/solicitacoes" replace />} />
          </>
        ) : (
          <>
            <Route path="/minhas-reservas" element={<MyReservations />} />
            <Route path="/reservar" element={<ReservationPage />} />
            <Route path="/salas" element={<RoomSearch />} />
            <Route path="*" element={<Navigate to="/minhas-reservas" replace />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
