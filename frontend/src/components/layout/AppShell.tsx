import {
  CalendarCheckIcon,
  CalendarPlusIcon,
  DoorOpenIcon,
  SignOutIcon,
  TrayIcon,
  WrenchIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { api } from "../../lib/api";
import { useAuth, type AuthUser } from "../../lib/auth";
import { cn } from "../../lib/cn";
import { groupBySeries, onReservationsChanged } from "../../lib/reservations";
import type { AdminReservation } from "../../lib/types";
import { Avatar } from "../ui/Avatar";
import { Button, IconButton } from "../ui/Button";
import { Logo, LogoMark } from "../ui/Logo";
import { ThemeCycleButton, ThemeSegmented } from "./ThemeToggle";

interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: Icon;
  badge?: number;
}

/** Nº de solicitações pendentes (uma série conta como uma), para o selo na navegação do Admin. */
function usePendingCount(enabled: boolean): number {
  const location = useLocation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      api<{ reservations: AdminReservation[] }>("/admin/reservations?status=PENDING")
        .then((res) => setCount(groupBySeries(res.reservations).length))
        .catch(() => undefined);
    void load();
    return onReservationsChanged(load);
  }, [enabled, location.pathname]);

  return count;
}

/** Indicador discreto de que a API e o banco estão respondendo. */
function HealthDot() {
  const [status, setStatus] = useState<"checking" | "ok" | "down">("checking");
  useEffect(() => {
    api<{ status: string; database: string }>("/health")
      .then((res) => setStatus(res.status === "ok" && res.database === "up" ? "ok" : "down"))
      .catch(() => setStatus("down"));
  }, []);
  const label = { checking: "Verificando o sistema…", ok: "Sistema online", down: "Sistema com problemas" }[status];
  return (
    <p className="flex items-center gap-2 px-1 text-xs text-muted">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status === "ok" ? "bg-emerald-500" : status === "down" ? "bg-red-500" : "animate-pulse bg-slate-400",
        )}
      />
      {label}
    </p>
  );
}

const ROLE_LABELS: Record<AuthUser["role"], string> = { ADMIN: "Secretaria · Admin", USER: "Solicitante" };

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isAdmin = user?.role === "ADMIN";
  const pendingCount = usePendingCount(isAdmin);

  // Ao trocar de página: volta ao topo e leva o foco ao conteúdo (leitores de tela anunciam a nova página).
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  if (!user) return null;

  const items: NavItem[] = isAdmin
    ? [
        { to: "/admin/solicitacoes", label: "Solicitações", shortLabel: "Solicitações", icon: TrayIcon, badge: pendingCount },
        { to: "/admin/salas", label: "Salas", shortLabel: "Salas", icon: DoorOpenIcon },
        { to: "/admin/recursos", label: "Recursos", shortLabel: "Recursos", icon: WrenchIcon },
      ]
    : [
        { to: "/minhas-reservas", label: "Minhas reservas", shortLabel: "Reservas", icon: CalendarCheckIcon },
        { to: "/reservar", label: "Reservar uma sala", shortLabel: "Reservar", icon: CalendarPlusIcon },
        { to: "/salas", label: "Consultar salas", shortLabel: "Salas", icon: DoorOpenIcon },
      ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <a
        href="#conteudo"
        className="sr-only z-[200] rounded-lg bg-surface px-4 py-2 font-medium shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Pular para o conteúdo
      </a>

      {/* Barra lateral (computador) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface lg:flex">
        <div className="px-5 pt-6 pb-8">
          <Logo />
        </div>
        <nav aria-label="Navegação principal" className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                  isActive ? "bg-primary-soft text-primary-soft-foreground" : "text-muted hover:bg-surface-muted hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={20} weight={isActive ? "fill" : "regular"} aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
                      {item.badge}
                      <span className="sr-only"> pendentes</span>
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-4 border-t border-border p-4">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <ThemeSegmented />
          <Button variant="secondary" size="sm" icon={SignOutIcon} className="w-full" onClick={() => void logout()}>
            Sair
          </Button>
          <HealthDot />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        {/* Cabeçalho (celular e tablet) */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border bg-surface/85 px-4 backdrop-blur-md lg:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="size-9" />
            <p className="truncate font-display text-base font-bold">Reserva de Salas</p>
          </div>
          <div className="flex items-center gap-1">
            <ThemeCycleButton />
            <Avatar name={user.name} size="sm" className="mx-1" />
            <IconButton icon={SignOutIcon} label="Sair" onClick={() => void logout()} />
          </div>
        </header>

        <main
          ref={mainRef}
          id="conteudo"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 outline-none sm:px-6 lg:px-10 lg:pt-10 lg:pb-12"
        >
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Navegação inferior (celular e tablet) */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <item.icon size={24} weight={isActive ? "fill" : "regular"} aria-hidden />
                    {item.badge ? (
                      <span className="absolute -top-1.5 -right-2.5 min-w-5 rounded-full bg-primary px-1 text-center text-[10px] leading-5 font-bold text-primary-foreground tabular-nums">
                        {item.badge}
                        <span className="sr-only"> pendentes</span>
                      </span>
                    ) : null}
                  </span>
                  {item.shortLabel}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
