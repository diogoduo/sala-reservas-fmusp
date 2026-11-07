import {
  ArrowRightIcon,
  CalendarBlankIcon,
  CalendarPlusIcon,
  CalendarStarIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CoffeeIcon,
  DoorOpenIcon,
  HammerIcon,
  HashIcon,
  HourglassMediumIcon,
  ListNumbersIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  MoonIcon,
  PencilSimpleLineIcon,
  ProhibitIcon,
  RepeatIcon,
  TrayIcon,
  UserMinusIcon,
  UsersIcon,
  WarningIcon,
  WrenchIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES, PRIORITY_LABELS, priorityOf } from "../../lib/activities";
import { api } from "../../lib/api";
import { useCanManage } from "../../lib/auth";
import { formatDateTimeRange, formatShortDate, formatTimeRange, plural } from "../../lib/format";
import { dayLabel, EVENT_STATUS_LABELS, EVENT_STATUS_TONES, eventPeriod, spaceText, type SadPendingEvent } from "../../lib/events";
import { ACTIVITY_ICONS } from "../../lib/icons";
import { reservationWarnings } from "../../lib/portarias";
import { formatMinutes, isModifiedPending, notifyReservationsChanged, onReservationsChanged } from "../../lib/reservations";
import { useToast } from "../../lib/toast";
import type { ActivityType, AdminReservation, ReservationStatus, Resource, Sanction } from "../../lib/types";
import { StatusBadge } from "../StatusBadge";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { CardListSkeleton, EmptyState } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card, IconTile, PageHeader } from "../ui/Surface";
import { PreReserveDialog } from "../events/EventManagement";
import { AdminReservationActions, isAdminActionable } from "./ReservationActions";
import { ReviewDrawer } from "./ReviewPanel";

// "MODIFIED" não é um status do banco: são as pendentes que o solicitante alterou.
type Filter = ReservationStatus | "MODIFIED";

function matchesFilter(r: AdminReservation, filter: Filter): boolean {
  if (filter === "MODIFIED") return isModifiedPending(r);
  if (filter === "PENDING") return r.status === "PENDING" && !isModifiedPending(r);
  return r.status === filter;
}

const STATUS_FILTERS: { value: Filter; label: string; icon: Icon; empty: string }[] = [
  { value: "PENDING", label: "Pendentes", icon: HourglassMediumIcon, empty: "Nenhuma solicitação esperando análise. Tudo em dia!" },
  { value: "MODIFIED", label: "Alteradas", icon: PencilSimpleLineIcon, empty: "Nenhuma reserva alterada pelos solicitantes esperando análise." },
  { value: "APPROVED", label: "Aprovadas", icon: CheckCircleIcon, empty: "Nenhuma solicitação aprovada ainda." },
  { value: "REJECTED", label: "Rejeitadas", icon: XCircleIcon, empty: "Nenhuma solicitação rejeitada." },
  { value: "CANCELLED", label: "Canceladas", icon: ProhibitIcon, empty: "Nenhuma reserva cancelada." },
];

function Chip({ icon: ChipIcon, children }: { icon: Icon; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-medium">
      <ChipIcon size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Uma série vira um cartão; as salas de um evento também (Fase 12). */
const keyOf = (r: AdminReservation) => r.seriesId ?? r.eventId ?? r.id;
const groupKey = (group: AdminReservation[]) => keyOf(group[0]!);

function groupReservations(list: AdminReservation[]): AdminReservation[][] {
  const groups = new Map<string, AdminReservation[]>();
  for (const r of list) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  return [...groups.values()].map((g) => [...g].sort((a, b) => a.startTime.localeCompare(b.startTime)));
}

type Sort = "SOONEST" | "PRIORITY" | "OLDEST_REQUEST" | "NEWEST_REQUEST";
const SORTS: { value: Sort; label: string }[] = [
  { value: "SOONEST", label: "Data mais próxima" },
  { value: "PRIORITY", label: "Maior prioridade (Art. 7º)" },
  { value: "OLDEST_REQUEST", label: "Pedido mais antigo" },
  { value: "NEWEST_REQUEST", label: "Pedido mais recente" },
];
type Period = "ALL" | "7" | "30";

/** A próxima data do grupo que ainda não passou (ou a última, se todas passaram). */
const nextStart = (group: AdminReservation[], now: number) =>
  new Date((group.find((r) => new Date(r.startTime).getTime() >= now) ?? group[group.length - 1]!).startTime).getTime();

/** Futuras primeiro, da mais próxima para a mais distante; as que já passaram vão para o fim. */
function bySoonest(now: number) {
  return (a: AdminReservation[], b: AdminReservation[]) => {
    const [x, y] = [nextStart(a, now), nextStart(b, now)];
    const [fx, fy] = [x >= now, y >= now];
    if (fx !== fy) return fx ? -1 : 1;
    return fx ? x - y : y - x;
  };
}

function sortGroups(groups: AdminReservation[][], sort: Sort): AdminReservation[][] {
  const now = Date.now();
  const soonest = bySoonest(now);
  const priority = (g: AdminReservation[]) => priorityOf(g[0]!.activityType, g[0]!.activityDetails);
  const created = (g: AdminReservation[]) => new Date(g[0]!.createdAt).getTime();
  const compare = {
    SOONEST: soonest,
    PRIORITY: (a: AdminReservation[], b: AdminReservation[]) => priority(a) - priority(b) || soonest(a, b),
    OLDEST_REQUEST: (a: AdminReservation[], b: AdminReservation[]) => created(a) - created(b),
    NEWEST_REQUEST: (a: AdminReservation[], b: AdminReservation[]) => created(b) - created(a),
  }[sort];
  return [...groups].sort(compare);
}

// --- Pedidos de evento nas pendências do SAD ---------------------------------

const eventFirstDay = (e: SadPendingEvent) => e.days.map((d) => d.date).sort()[0] ?? "";

function sortEvents(events: SadPendingEvent[], sort: Sort): SadPendingEvent[] {
  const created = (e: SadPendingEvent) => new Date(e.createdAt).getTime();
  const soonest = (a: SadPendingEvent, b: SadPendingEvent) => eventFirstDay(a).localeCompare(eventFirstDay(b));
  const compare = {
    SOONEST: soonest,
    // Todos os eventos são Cultura e Extensão: a mesma prioridade, então vale a data.
    PRIORITY: soonest,
    OLDEST_REQUEST: (a: SadPendingEvent, b: SadPendingEvent) => created(a) - created(b),
    NEWEST_REQUEST: (a: SadPendingEvent, b: SadPendingEvent) => created(b) - created(a),
  }[sort];
  return [...events].sort(compare);
}

/** Um pedido de evento esperando o SAD: escolher e pré-reservar as salas, ou confirmar a reserva. */
function EventPendingCard({
  event,
  canManage,
  onPreReserve,
  onChanged,
}: {
  event: SadPendingEvent;
  canManage: boolean;
  onPreReserve: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const days = [...event.days].sort((a, b) => a.date.localeCompare(b.date));
  const first = days[0];

  async function confirm() {
    setBusy(true);
    try {
      await api(`/events/${event.id}/confirm`, { method: "POST", body: "{}" });
      toast.success("Reserva confirmada", "Quem pediu foi avisado por e-mail.");
      onChanged();
    } catch (e) {
      toast.error("Não foi possível confirmar.", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 transition-shadow duration-200 hover:shadow-md sm:p-5">
      <div className="flex items-start gap-4">
        <IconTile icon={CalendarStarIcon} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h2 className="min-w-0 text-base font-semibold sm:text-lg">{event.title}</h2>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={EVENT_STATUS_TONES[event.status]}>{EVENT_STATUS_LABELS[event.status]}</Badge>
              <Badge tone="primary" icon={CalendarStarIcon}>
                Evento
              </Badge>
            </div>
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted">
            <Avatar name={event.user.name} size="sm" className="size-6 text-[10px]" />
            <span className="truncate">
              {event.user.name} · {event.user.email}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Chip icon={HashIcon}>Protocolo {event.protocol}</Chip>
        {first && (
          <Chip icon={CalendarBlankIcon}>
            {days.length === 1 ? `${dayLabel(first.date)} · ${first.start}–${first.end}` : `${days.length} dias · ${eventPeriod(days)}`}
          </Chip>
        )}
        <Chip icon={UsersIcon}>{plural(event.expectedAttendees, "pessoa", "pessoas")}</Chip>
        <Chip icon={MapPinIcon}>{plural(event.spaces.length, "pedido de espaço", "pedidos de espaço")}</Chip>
        {event.coffeeBreak && <Chip icon={CoffeeIcon}>Coffee break{event.coffeeAttendees ? ` · ${event.coffeeAttendees} pessoas` : ""}</Chip>}
        <Chip icon={CalendarStarIcon}>{ACTIVITY_TYPE_LABELS.CULTURE_EXTENSION}</Chip>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-muted">
        <span className="font-medium text-foreground">Espaços pedidos:</span> {event.spaces.map(spaceText).join(" · ")}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted">
          {event.sadAction === "PRE_RESERVE" ? "Falta o SAD escolher as salas" : "Pagamento validado: falta confirmar a reserva"} · enviado em{" "}
          {new Date(event.createdAt).toLocaleDateString("pt-BR")}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/admin/eventos/${event.id}`)}>
            Abrir o evento
          </Button>
          {canManage && event.sadAction === "PRE_RESERVE" && (
            <Button size="sm" icon={DoorOpenIcon} onClick={onPreReserve}>
              Pré-reservar
            </Button>
          )}
          {canManage && event.sadAction === "CONFIRM" && (
            <Button size="sm" icon={CheckCircleIcon} loading={busy} onClick={() => void confirm()}>
              Confirmar a reserva
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

type ActiveSuspension = Sanction & { user: { id: string; name: string; email: string } };

/** Solicitantes com novas reservas suspensas (Portaria 2793, Arts. 9º §2º, 11, 17 e 22). */
function ActiveSuspensions() {
  const canManage = useCanManage();
  const toast = useToast();
  const [list, setList] = useState<ActiveSuspension[]>([]);
  const load = () =>
    api<{ suspensions: ActiveSuspension[] }>("/admin/sanctions/active")
      .then((res) => setList(res.suspensions))
      .catch(() => setList([]));
  useEffect(() => {
    void load();
    return onReservationsChanged(() => void load());
  }, []);
  if (list.length === 0) return null;

  async function lift(id: string) {
    try {
      await api(`/admin/sanctions/${id}/lift`, { method: "POST" });
      toast.success("Suspensão retirada");
      void load();
    } catch (e) {
      toast.error("Não foi possível retirar.", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <details className="rounded-xl border border-danger-foreground/25 bg-danger-soft/60 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-danger-foreground">
        {plural(list.length, "solicitante suspenso", "solicitantes suspensos")} de fazer novas reservas
      </summary>
      <ul className="mt-3 divide-y divide-danger-foreground/15">
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-medium">{s.user.name}</span> <span className="text-muted">· {s.user.email}</span>
              <span className="block text-xs text-muted">
                {s.until ? `Até ${new Date(s.until).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "Até a regularização"} — {s.reason}
              </span>
            </span>
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => void lift(s.id)}>
                Retirar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// Fila de aprovação (Fase 6): o Admin analisa cada solicitação, aloca a sala
// mais adequada e aprova, ou rejeita com justificativa.
export function RequestsAdmin() {
  const canManage = useCanManage();
  const toast = useToast();
  const navigate = useNavigate();
  const [reservations, setReservations] = useState<AdminReservation[] | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [status, setStatus] = useState<Filter>("PENDING");
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("SOONEST");
  const [period, setPeriod] = useState<Period>("ALL");
  const [activity, setActivity] = useState<ActivityType | "">("");
  const [events, setEvents] = useState<SadPendingEvent[]>([]);
  const [preReserving, setPreReserving] = useState<SadPendingEvent | null>(null);

  // Carrega tudo de uma vez: os filtros e as contagens ficam instantâneos.
  async function load() {
    try {
      const [{ reservations: list }, pending] = await Promise.all([
        api<{ reservations: AdminReservation[] }>("/admin/reservations"),
        // Pedidos de evento esperando o SAD (pré-reserva ou confirmação), nas Pendentes.
        api<{ events: SadPendingEvent[] }>("/events/sad-pending").catch(() => ({ events: [] as SadPendingEvent[] })),
      ]);
      setReservations(list);
      setEvents(pending.events);
    } catch (e) {
      toast.error("Não foi possível carregar as solicitações.", e instanceof Error ? e.message : undefined);
      setReservations([]);
    }
  }

  useEffect(() => {
    void load();
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(message: string) {
    toast.success(message, "O solicitante foi avisado por e-mail.");
    setOpenKey(null);
    notifyReservationsChanged();
    void load();
  }

  const all = reservations ?? [];
  const groupsByStatus = (s: Filter) => groupReservations(all.filter((r) => matchesFilter(r, s)));
  const statusGroups = groupsByStatus(status);
  const needle = query.trim().toLowerCase();
  const now = Date.now();
  const horizon = period === "ALL" ? null : now + Number(period) * 86_400_000;
  const groups = sortGroups(
    statusGroups.filter(([first], i) => {
      const group = statusGroups[i]!;
      if (needle && !`${first!.protocol} ${first!.title} ${first!.user.name} ${first!.user.email}`.toLowerCase().includes(needle)) return false;
      if (activity && first!.activityType !== activity) return false;
      if (horizon !== null) {
        const next = nextStart(group, now);
        if (next < now || next > horizon) return false;
      }
      return true;
    }),
    sort,
  );
  const visibleEvents =
    status !== "PENDING"
      ? []
      : sortEvents(
          events.filter((e) => {
            if (needle && !`${e.protocol} ${e.title} ${e.user.name} ${e.user.email}`.toLowerCase().includes(needle)) return false;
            if (activity && activity !== "CULTURE_EXTENSION") return false;
            if (horizon !== null) {
              const day = new Date(`${eventFirstDay(e)}T12:00:00`).getTime();
              if (day < now - 86_400_000 || day > horizon) return false;
            }
            return true;
          }),
          sort,
        );
  const filtered = Boolean(needle || activity || period !== "ALL");
  const openGroup = openKey ? statusGroups.find((g) => groupKey(g) === openKey) : undefined;
  const filter = STATUS_FILTERS.find((f) => f.value === status)!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitações"
        description={
          canManage
            ? "Analise os pedidos, escolha a sala mais adequada e aprove ou rejeite."
            : "Acompanhe os pedidos e a análise do SAD. Quem aprova, aloca e altera é o SAD."
        }
        actions={
          canManage ? (
            <Button icon={CalendarPlusIcon} onClick={() => navigate("/admin/reservar?voltar=/admin/solicitacoes")}>
              Nova reserva
            </Button>
          ) : undefined
        }
      />

      <ActiveSuspensions />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setOpenKey(null);
          }}
          options={STATUS_FILTERS.map((f) => ({
            value: f.value,
            label: f.label,
            icon: f.icon,
            count: groupsByStatus(f.value).length + (f.value === "PENDING" ? events.length : 0),
          }))}
        />
        <div className="relative lg:w-72">
          <Input
            type="search"
            aria-label="Buscar por protocolo, título ou solicitante"
            placeholder="Protocolo, título ou solicitante"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select label="Período" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="ALL">Todas as datas</option>
          <option value="7">Próximos 7 dias</option>
          <option value="30">Próximos 30 dias</option>
        </Select>
        <Select label="Tipo de atividade" value={activity} onChange={(e) => setActivity(e.target.value as ActivityType | "")}>
          <option value="">Todos os tipos</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
      {filtered && (
        <p className="text-sm text-muted" aria-live="polite">
          {plural(groups.length + visibleEvents.length, "solicitação", "solicitações")} com esses filtros ·{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => {
              setQuery("");
              setActivity("");
              setPeriod("ALL");
            }}
          >
            limpar filtros
          </button>
        </p>
      )}

      {reservations === null ? (
        <CardListSkeleton />
      ) : groups.length === 0 && visibleEvents.length === 0 ? (
        <EmptyState
          icon={filtered ? MagnifyingGlassIcon : TrayIcon}
          title={filtered ? "Nada encontrado" : `Sem solicitações ${filter.label.toLowerCase()}`}
          description={filtered ? `Nenhuma solicitação ${filter.label.toLowerCase().replace(/s$/, "")} com esses filtros.` : filter.empty}
        />
      ) : (
        <div className="space-y-6">
          {visibleEvents.length > 0 && (
            <section className="space-y-3" aria-labelledby="pending-events">
              <div>
                <h2 id="pending-events" className="text-sm font-semibold">
                  Pedidos de evento
                </h2>
                <p className="text-sm text-muted">Escolha as salas e pré-reserve. O orçamento e o pagamento seguem na página do evento.</p>
              </div>
              <ul className="space-y-4">
                {visibleEvents.map((e, index) => (
                  <li key={e.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
                    <EventPendingCard
                      event={e}
                      canManage={canManage}
                      onPreReserve={() => setPreReserving(e)}
                      onChanged={() => {
                        notifyReservationsChanged();
                        void load();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {groups.length > 0 && (
            <section className="space-y-3" aria-label="Reservas">
              {visibleEvents.length > 0 && <h2 className="text-sm font-semibold">Reservas</h2>}
        <ul className="space-y-4">
          {groups.map((group, index) => {
            const first = group[0]!;
            const key = groupKey(group);
            const isPending = first.status === "PENDING";
            const ActivityIcon = first.activityType ? ACTIVITY_ICONS[first.activityType] : CalendarBlankIcon;
            const rooms = [...new Set(group.flatMap((r) => (r.room ? [r.room.name] : [])))];
            const last = group[group.length - 1]!;
            // Numa série, "Alterar"/"Cancelar" partem da próxima data que ainda pode mudar.
            const actionTarget = group.find((r) => isAdminActionable(r));
            return (
              <li key={key} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
                <Card className="p-4 transition-shadow duration-200 hover:shadow-md sm:p-5">
                  <div className="flex items-start gap-4">
                    <IconTile icon={ActivityIcon} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <h2 className="min-w-0 text-base font-semibold sm:text-lg">{first.title}</h2>
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge status={first.status} />
                          {isModifiedPending(first) && (
                            <Badge tone="info" icon={PencilSimpleLineIcon}>
                              Alterada
                            </Badge>
                          )}
                          {first.eventId && (
                            <Badge tone="primary" icon={CalendarStarIcon}>
                              {first.preReservedUntil ? "Evento · pré-reserva" : "Evento"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted">
                        <Avatar name={first.user.name} size="sm" className="size-6 text-[10px]" />
                        <span className="truncate">
                          {first.user.name} · {first.user.email}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Chip icon={HashIcon}>Protocolo {first.protocol}</Chip>
                    {(() => {
                      const priority = priorityOf(first.activityType, first.activityDetails);
                      return (
                        <span title={`Art. 7º: ${PRIORITY_LABELS[priority]}`}>
                          <Chip icon={ListNumbersIcon}>Prioridade {priority}</Chip>
                        </span>
                      );
                    })()}
                    {first.eventId ? (
                      <Chip icon={CalendarStarIcon}>
                        {plural(rooms.length, "sala", "salas")} · {[...new Set(group.map((r) => formatShortDate(r.startTime)))].join(", ")} ·{" "}
                        {formatTimeRange(first.startTime, first.endTime)}
                      </Chip>
                    ) : group.length === 1 ? (
                      <Chip icon={CalendarBlankIcon}>{formatDateTimeRange(first.startTime, first.endTime)}</Chip>
                    ) : (
                      <Chip icon={RepeatIcon}>
                        {plural(group.length, "data", "datas")} · {formatShortDate(first.startTime)} a {formatShortDate(last.startTime)} ·{" "}
                        {formatTimeRange(first.startTime, first.endTime)}
                      </Chip>
                    )}
                    {isModifiedPending(first) && first.previousSnapshot && (
                      <Chip icon={ClockCounterClockwiseIcon}>
                        Antes: {formatDateTimeRange(first.previousSnapshot.startTime, first.previousSnapshot.endTime)}
                        {first.previousSnapshot.roomName ? ` · ${first.previousSnapshot.roomName.split(" — ")[0]}` : ""}
                      </Chip>
                    )}
                    <Chip icon={UsersIcon}>{plural(first.expectedAttendees, "pessoa", "pessoas")}</Chip>
                    {first.activityType && <Chip icon={ActivityIcon}>{ACTIVITY_TYPE_LABELS[first.activityType]}</Chip>}
                    {first.requestedResources.length > 0 && (
                      <Chip icon={WrenchIcon}>{plural(first.requestedResources.length, "recurso", "recursos")}</Chip>
                    )}
                    {rooms.length > 0 && <Chip icon={MapPinIcon}>{isPending ? `Indicada: ${rooms.join(", ")}` : rooms.join(", ")}</Chip>}
                    {first.setupMinutes > 0 && <Chip icon={HammerIcon}>Montagem de {formatMinutes(first.setupMinutes)}</Chip>}
                    {first.outsideRegularHours && <Chip icon={MoonIcon}>Horário extraordinário</Chip>}
                    {reservationWarnings(first).length > 0 && (
                      <span title={reservationWarnings(first).map((w) => `${w.rule}: ${w.message}`).join("\n")}>
                        <Chip icon={WarningIcon}>Fora das portarias</Chip>
                      </span>
                    )}
                    {group.some((r) => r.noShowAt) && <Chip icon={UserMinusIcon}>Ausência registrada</Chip>}
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted">{first.description}</p>
                  {first.status === "CANCELLED" && first.cancellationReason && (
                    <p className="mt-2 text-sm">
                      <span className="font-medium">Cancelada pelo SAD:</span> <span className="text-muted">{first.cancellationReason}</span>
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="text-xs text-muted">
                      {isModifiedPending(first) && first.modifiedByRequesterAt
                        ? `Alterada pelo solicitante em ${new Date(first.modifiedByRequesterAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                        : first.modifiedByAdminAt
                          ? `Alterada pelo SAD em ${new Date(first.modifiedByAdminAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                          : `Enviada em ${new Date(first.createdAt).toLocaleDateString("pt-BR")}`}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {first.eventId ? (
                        <Button size="sm" variant="secondary" iconRight={ArrowRightIcon} onClick={() => navigate(`/admin/eventos/${first.eventId}`)}>
                          Abrir o evento
                        </Button>
                      ) : (
                        <>
                      {actionTarget && canManage && (
                        <AdminReservationActions reservation={actionTarget} returnTo="/admin/solicitacoes" onChanged={() => void load()} />
                      )}
                      <Button
                        size="sm"
                        variant={isPending && canManage ? "primary" : "secondary"}
                        iconRight={ArrowRightIcon}
                        onClick={() => setOpenKey(key)}
                      >
                        {isPending && canManage ? "Analisar" : "Ver detalhes"}
                      </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
            </section>
          )}
        </div>
      )}

      {preReserving && (
        <PreReserveDialog
          event={preReserving}
          onClose={() => setPreReserving(null)}
          onDone={() => {
            setPreReserving(null);
            notifyReservationsChanged();
            void load();
          }}
        />
      )}

      {openGroup && (
        <ReviewDrawer
          key={openKey}
          group={openGroup}
          resources={resources}
          onClose={() => setOpenKey(null)}
          onDone={handleDone}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
