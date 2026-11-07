import { Navigate, Route, Routes, useLocation } from "react-router";
import { AgendaAdmin } from "./components/admin/AgendaAdmin";
import { AuditLogPage } from "./components/admin/AuditLogPage";
import { PricesPage } from "./components/admin/PricesPage";
import { AuthorizationPage } from "./components/events/AuthorizationPage";
import { EventDetail } from "./components/events/EventDetail";
import { EventsAdmin, MyEvents } from "./components/events/EventList";
import { EventRequestForm } from "./components/events/EventRequestForm";
import { UsersAdmin } from "./components/admin/UsersAdmin";
import { FreeRooms } from "./components/admin/FreeRooms";
import { RequestsAdmin } from "./components/admin/RequestsAdmin";
import { ResourcesAdmin } from "./components/admin/ResourcesAdmin";
import { RoomsAdmin } from "./components/admin/RoomsAdmin";
import { AppShell } from "./components/layout/AppShell";
import { Login } from "./components/Login";
import { RegulationPage } from "./components/regulation/Regulation";
import { MyReservations } from "./components/solicitante/MyReservations";
import { AdminEditReservationPage, AdminNewReservationPage, EditReservationPage, ReservationPage } from "./components/solicitante/ReservationForm";
import { PlantaoPage } from "./components/plantao/PlantaoPage";
import { RoomSearch } from "./components/solicitante/RoomSearch";
import { TvPanel } from "./components/tv/TvPanel";
import { LogoMark } from "./components/ui/Logo";
import { canRequestActivity } from "./lib/permissions";
import { useAuth } from "./lib/auth";

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Link do e-mail da Diretoria (Fase 12): abre sem login.
  if (location.pathname.startsWith("/autorizacao/")) {
    return (
      <Routes>
        <Route path="/autorizacao/:token" element={<AuthorizationPage />} />
      </Routes>
    );
  }

  // Painel da TV em frente ao SAD (Fase 15): abre pelo link secreto, sem login.
  if (location.pathname.startsWith("/tv/")) {
    return (
      <Routes>
        <Route path="/tv/:token" element={<TvPanel />} />
      </Routes>
    );
  }

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
            <Route path="/admin/agenda" element={<AgendaAdmin />} />
            <Route path="/admin/eventos" element={<EventsAdmin />} />
            <Route path="/admin/eventos/:id" element={<EventDetail />} />
            <Route path="/admin/plantao" element={<PlantaoPage />} />
            <Route path="/admin/reservar" element={<AdminNewReservationPage />} />
            <Route path="/admin/reservas/:id/editar" element={<AdminEditReservationPage />} />
            <Route path="/admin/salas-livres" element={<FreeRooms />} />
            <Route path="/admin/salas" element={<RoomsAdmin />} />
            <Route path="/admin/recursos" element={<ResourcesAdmin />} />
            <Route path="/admin/precos" element={<PricesPage />} />
            <Route path="/admin/regulamento" element={<RegulationPage />} />
            <Route path="/admin/pessoas" element={<UsersAdmin />} />
            <Route path="/admin/historico" element={<AuditLogPage />} />
            <Route path="*" element={<Navigate to="/admin/solicitacoes" replace />} />
          </>
        ) : user.role === "NUCEV" ? (
          // NUCEV: acompanha as mesmas telas do SAD, só para consultar (Fase 9).
          <>
            <Route path="/admin/solicitacoes" element={<RequestsAdmin />} />
            <Route path="/admin/agenda" element={<AgendaAdmin />} />
            <Route path="/admin/eventos" element={<EventsAdmin />} />
            <Route path="/admin/eventos/:id" element={<EventDetail />} />
            <Route path="/admin/plantao" element={<PlantaoPage />} />
            <Route path="/admin/salas-livres" element={<FreeRooms />} />
            <Route path="/salas" element={<RoomSearch />} />
            <Route path="/admin/precos" element={<PricesPage />} />
            <Route path="/admin/historico" element={<AuditLogPage />} />
            <Route path="/regulamento" element={<RegulationPage />} />
            <Route path="*" element={<Navigate to="/admin/agenda" replace />} />
          </>
        ) : (
          <>
            <Route path="/minhas-reservas" element={<MyReservations />} />
            <Route path="/minhas-reservas/:id/editar" element={<EditReservationPage />} />
            <Route path="/reservar" element={<ReservationPage />} />
            {canRequestActivity(user, "CULTURE_EXTENSION") && (
              <>
                <Route path="/eventos" element={<MyEvents />} />
                <Route path="/eventos/novo" element={<EventRequestForm />} />
                <Route path="/eventos/:id" element={<EventDetail />} />
              </>
            )}
            <Route path="/salas" element={<RoomSearch />} />
            <Route path="/regulamento" element={<RegulationPage />} />
            <Route path="*" element={<Navigate to="/minhas-reservas" replace />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
