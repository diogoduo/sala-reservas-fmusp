import {
  ArrowRightIcon,
  CalendarBlankIcon,
  CalendarPlusIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  DoorOpenIcon,
  HammerIcon,
  HourglassMediumIcon,
  ListBulletsIcon,
  LockIcon,
  MapPinIcon,
  MoonIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  ProhibitIcon,
  UserMinusIcon,
  UsersIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ACTIVITY_TYPE_LABELS } from "../../lib/activities";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { capitalizeFirst, formatTimeRange, plural } from "../../lib/format";
import { ACTIVITY_ICONS } from "../../lib/icons";
import { formatMinutes, isModifiedPending, onReservationsChanged } from "../../lib/reservations";
import { sortRooms } from "../../lib/rooms";
import { useToast } from "../../lib/toast";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { AdminReservation, Resource, RoomPhoto, RoomType } from "../../lib/types";
import { StatusBadge } from "../StatusBadge";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Input } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card, PageHeader } from "../ui/Surface";
import { AdminReservationActions, NoShowButton } from "./ReservationActions";
import { RequestDetails, ReviewDrawer } from "./ReviewPanel";

interface AgendaRoom {
  id: string;
  name: string;
  building: string;
  floor: string;
  capacity: number | null;
  roomType: RoomType;
  photos: RoomPhoto[];
}

interface AgendaBlock {
  id: string;
  roomId: string;
  reason: string;
  startTime: string;
  endTime: string;
}

interface AgendaDay {
  date: string;
  reservations: AdminReservation[];
  blocks: AgendaBlock[];
  rooms: AgendaRoom[];
}

type MonthCounts = Record<string, { total: number; PENDING: number; MODIFIED: number; APPROVED: number; REJECTED: number; CANCELLED: number }>;

type StatusFilter = "ALL" | "PENDING" | "MODIFIED" | "APPROVED" | "CANCELLED" | "REJECTED";

const STATUS_FILTERS: { value: StatusFilter; label: string; icon: Icon }[] = [
  { value: "ALL", label: "Todas", icon: ListBulletsIcon },
  { value: "PENDING", label: "Pendentes", icon: HourglassMediumIcon },
  { value: "MODIFIED", label: "Alteradas", icon: PencilSimpleLineIcon },
  { value: "APPROVED", label: "Aprovadas", icon: CheckCircleIcon },
  { value: "CANCELLED", label: "Canceladas", icon: ProhibitIcon },
  { value: "REJECTED", label: "Rejeitadas", icon: XCircleIcon },
];

function matchesStatus(r: AdminReservation, filter: StatusFilter) {
  if (filter === "ALL") return true;
  if (filter === "MODIFIED") return isModifiedPending(r);
  if (filter === "PENDING") return r.status === "PENDING" && !isModifiedPending(r);
  return r.status === filter;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (key: string) => new Date(`${key}T12:00:00`);
const shiftDay = (key: string, days: number) => {
  const d = parseDay(key);
  d.setDate(d.getDate() + days);
  return isoDay(d);
};

// Linha do tempo das salas: o funcionamento regular, das 07h às 22h (Portaria
// 2793, Art. 6º), estendido quando há reserva extraordinária fora dele.
const REGULAR_START = 7 * 60;
const REGULAR_END = 22 * 60;
const minutesOf = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

function timelineOf(items: { startTime: string; endTime: string }[]) {
  let start = REGULAR_START;
  let end = REGULAR_END;
  for (const item of items) {
    start = Math.min(start, Math.floor(minutesOf(item.startTime) / 60) * 60);
    end = Math.max(end, Math.min(24 * 60, Math.ceil(minutesOf(item.endTime) / 60) * 60));
  }
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start / 60 + i);
  const percent = (minutes: number) => ((Math.min(Math.max(minutes, start), end) - start) / (end - start)) * 100;
  return { hours, percent };
}

/** Reserva que ocupa a sala (pendente com sala ou aprovada). */
const occupies = (r: AdminReservation) => r.roomId !== null && (r.status === "APPROVED" || r.status === "PENDING");

function MonthCalendar({ selected, onSelect, counts }: { selected: string; onSelect: (key: string) => void; counts: MonthCounts | null }) {
  const view = parseDay(selected);
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = isoDay(new Date());
  const cells = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDay(new Date(view.getFullYear(), view.getMonth(), i + 1))),
  ];
  const monthShift = (delta: number) => onSelect(isoDay(new Date(view.getFullYear(), view.getMonth() + delta, 1)));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <IconButton icon={CaretLeftIcon} label="Mês anterior" variant="ghost" size="sm" onClick={() => monthShift(-1)} />
        <p className="text-sm font-semibold">{capitalizeFirst(view.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}</p>
        <IconButton icon={CaretRightIcon} label="Próximo mês" variant="ghost" size="sm" onClick={() => monthShift(1)} />
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-medium text-muted">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div key={i} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((key, i) => {
          if (!key) return <div key={`vazio-${i}`} />;
          const day = counts?.[key];
          const active = day ? day.PENDING + day.MODIFIED + day.APPROVED : 0;
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-pressed={isSelected}
              aria-label={`${parseDay(key).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}: ${plural(day?.total ?? 0, "reserva", "reservas")}`}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                isSelected ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-surface-muted",
                key === today && !isSelected && "ring-1 ring-primary ring-inset",
              )}
            >
              {Number(key.slice(8))}
              {active > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-[9px] leading-4 font-bold shadow-sm",
                    isSelected ? "bg-primary-foreground text-primary" : day!.PENDING + day!.MODIFIED > 0 ? "bg-warning-soft text-warning-foreground" : "bg-primary-soft text-primary-soft-foreground",
                  )}
                >
                  {active}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-warning-soft ring-1 ring-warning-foreground/40" aria-hidden /> tem pendências
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-primary-soft ring-1 ring-primary/40" aria-hidden /> só aprovadas
        </span>
      </div>
    </Card>
  );
}

function ReservationRow({ reservation: r, onOpen }: { reservation: AdminReservation; onOpen: () => void }) {
  const ActivityIcon = r.activityType ? ACTIVITY_ICONS[r.activityType] : CalendarBlankIcon;
  const inactive = r.status === "CANCELLED" || r.status === "REJECTED";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:p-4",
          inactive && "opacity-70",
        )}
      >
        <div className="w-16 shrink-0 text-sm font-semibold tabular-nums sm:w-24">
          <span className="block">{formatTimeRange(r.startTime, r.endTime).split("–")[0]}</span>
          <span className="block text-xs font-normal text-muted">até {formatTimeRange(r.startTime, r.endTime).split("–")[1]}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={r.status} />
            {isModifiedPending(r) && (
              <Badge tone="info" icon={PencilSimpleLineIcon}>
                Alterada
              </Badge>
            )}
          </div>
          <p className={cn("mt-1 font-semibold break-words", inactive && "line-through decoration-muted/60")}>{r.title}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span className="tabular-nums">Protocolo {r.protocol}</span>
            {r.setupMinutes > 0 && (
              <span className="inline-flex items-center gap-1">
                <HammerIcon size={14} aria-hidden /> montagem {formatMinutes(r.setupMinutes)}
              </span>
            )}
            {r.outsideRegularHours && (
              <span className="inline-flex items-center gap-1">
                <MoonIcon size={14} aria-hidden /> extraordinário
              </span>
            )}
            {r.noShowAt && (
              <span className="inline-flex items-center gap-1 text-danger-foreground">
                <UserMinusIcon size={14} aria-hidden /> ausência
              </span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {r.activityType && (
              <span className="inline-flex items-center gap-1">
                <ActivityIcon size={14} aria-hidden /> {ACTIVITY_TYPE_LABELS[r.activityType]}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPinIcon size={14} aria-hidden /> {r.room ? r.room.name : "Sala a definir"}
            </span>
            <span className="inline-flex items-center gap-1">
              <UsersIcon size={14} aria-hidden /> {r.expectedAttendees}
            </span>
            <span className="truncate">{r.user.name}</span>
          </p>
        </div>
        <ArrowRightIcon size={18} className="mt-1 shrink-0 text-muted" aria-hidden />
      </button>
    </li>
  );
}

function RoomsTimeline({ day, onOpen, onBook }: { day: AgendaDay; onOpen: (r: AdminReservation) => void; onBook: (roomId: string) => void }) {
  const [filter, setFilter] = useState<"ALL" | "BUSY" | "FREE">("ALL");
  const rooms = useMemo(() => sortRooms(day.rooms), [day.rooms]);
  const busyByRoom = useMemo(() => {
    const map = new Map<string, { reservations: AdminReservation[]; blocks: AgendaBlock[] }>();
    for (const r of day.reservations.filter(occupies)) {
      const entry = map.get(r.roomId!) ?? { reservations: [], blocks: [] };
      entry.reservations.push(r);
      map.set(r.roomId!, entry);
    }
    for (const b of day.blocks) {
      const entry = map.get(b.roomId) ?? { reservations: [], blocks: [] };
      entry.blocks.push(b);
      map.set(b.roomId, entry);
    }
    return map;
  }, [day]);

  const { hours: HOURS, percent } = useMemo(() => timelineOf([...day.reservations.filter(occupies), ...day.blocks]), [day]);
  const busyRooms = rooms.filter((room) => busyByRoom.has(room.id));
  const freeRooms = rooms.filter((room) => !busyByRoom.has(room.id));
  const visible = filter === "BUSY" ? busyRooms : filter === "FREE" ? freeRooms : rooms;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Salas no dia</h2>
          <p className="text-sm text-muted">
            {plural(busyRooms.length, "ocupada", "ocupadas")} em algum horário · {plural(freeRooms.length, "livre", "livres")} o dia todo
          </p>
        </div>
        <SegmentedControl
          label="Salas"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "ALL", label: "Todas", count: rooms.length },
            { value: "BUSY", label: "Ocupadas", count: busyRooms.length },
            { value: "FREE", label: "Livres", count: freeRooms.length },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {/* `relative`: nada de position:absolute "escapa" da área rolável (ver RoomsPreview). */}
        <div className="relative overflow-x-auto">
          <div className="min-w-[680px] sm:min-w-[760px]">
            <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] sm:grid-cols-[13rem_minmax(0,1fr)] border-b border-border bg-surface-muted/60 text-[11px] text-muted">
              <div className="sticky left-0 z-10 bg-surface-muted px-4 py-2 font-medium">Sala</div>
              <div className="relative h-8">
                {/* Rótulos de hora em hora; o último, na borda, ficaria cortado (a linha dele continua). */}
                {HOURS.slice(0, -1).map((h) => (
                  <span key={h} className={cn("absolute top-2 tabular-nums", h > HOURS[0]! && "-translate-x-1/2")} style={{ left: `${percent(h * 60)}%` }}>
                    {pad(h)}h
                  </span>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma sala neste filtro.</p>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((room) => {
                  const busy = busyByRoom.get(room.id);
                  return (
                    <li key={room.id} className="grid grid-cols-[9.5rem_minmax(0,1fr)] sm:grid-cols-[13rem_minmax(0,1fr)] items-center">
                      {/* Nome fixo à esquerda ao rolar a linha do tempo para o lado. */}
                      <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2 bg-surface px-3 py-2 sm:px-4">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm leading-tight font-medium" title={room.name}>
                            {room.name}
                          </p>
                          <p className="truncate text-[11px] text-muted">
                            {ROOM_TYPE_LABELS[room.roomType]} · {room.capacity ?? "?"} lugares
                          </p>
                        </div>
                        <IconButton icon={PlusIcon} size="sm" label={`Reservar ${room.name} neste dia`} onClick={() => onBook(room.id)} className="-mr-1" />
                      </div>
                      <div className="relative h-14">
                        {HOURS.map((h) => (
                          <span key={h} aria-hidden className="absolute inset-y-0 border-l border-border/60" style={{ left: `${percent(h * 60)}%` }} />
                        ))}
                        {!busy && (
                          <span className="absolute inset-y-2 left-2 flex items-center gap-1 text-xs font-medium text-success-foreground">
                            <CheckCircleIcon size={14} weight="fill" aria-hidden /> Livre o dia todo
                          </span>
                        )}
                        {busy?.blocks.map((b) => (
                          <span
                            key={b.id}
                            title={`Bloqueio: ${b.reason}`}
                            className="absolute inset-y-2 flex items-center gap-1 overflow-hidden rounded-md bg-danger-soft px-1.5 text-[11px] font-medium text-danger-foreground"
                            style={{ left: `${percent(minutesOf(b.startTime))}%`, width: `${percent(minutesOf(b.endTime)) - percent(minutesOf(b.startTime))}%` }}
                          >
                            <LockIcon size={12} aria-hidden className="shrink-0" />
                            <span className="truncate">{b.reason}</span>
                          </span>
                        ))}
                        {busy?.reservations.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => onOpen(r)}
                            title={`${formatTimeRange(r.startTime, r.endTime)} · ${r.title}`}
                            className={cn(
                              "absolute inset-y-2 overflow-hidden rounded-md px-1.5 text-left text-[11px] leading-tight font-medium transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              r.status === "APPROVED"
                                ? "bg-primary text-primary-foreground"
                                : "border border-warning-foreground/40 bg-warning-soft text-warning-foreground",
                            )}
                            style={{ left: `${percent(minutesOf(r.startTime))}%`, width: `${percent(minutesOf(r.endTime)) - percent(minutesOf(r.startTime))}%` }}
                          >
                            <span className="block truncate tabular-nums">{formatTimeRange(r.startTime, r.endTime)}</span>
                            <span className="block truncate font-normal opacity-90">{r.title}</span>
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-primary" aria-hidden /> aprovada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-warning-foreground/40 bg-warning-soft" aria-hidden /> pendente com sala indicada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-danger-soft" aria-hidden /> bloqueio
          </span>
        </div>
      </Card>
    </section>
  );
}

/**
 * Agenda do SAD: tudo o que acontece num dia. As reservas por situação
 * (pendentes, alteradas, aprovadas, canceladas, rejeitadas) e a linha do tempo
 * de cada sala, separando as ocupadas das livres.
 */
export function AgendaAdmin() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("data") ?? "") ? params.get("data")! : isoDay(new Date());
  const openId = params.get("reserva");
  const [day, setDay] = useState<AgendaDay | null>(null);
  const [counts, setCounts] = useState<MonthCounts | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [reviewing, setReviewing] = useState<AdminReservation | null>(null);
  const month = date.slice(0, 7);

  const setDate = (key: string) => setParams({ data: key }, { replace: true });
  const openReservation = (id: string | null) => setParams(id ? { data: date, reserva: id } : { data: date }, { replace: true });

  const load = useCallback(() => {
    api<AgendaDay>(`/admin/agenda?date=${date}`)
      .then(setDay)
      .catch((e: Error) => {
        toast.error("Não foi possível carregar a agenda.", e.message);
        setDay({ date, reservations: [], blocks: [], rooms: [] });
      });
    api<{ days: MonthCounts }>(`/admin/agenda/month?month=${month}`)
      .then((res) => setCounts(res.days))
      .catch(() => setCounts({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, month]);

  useEffect(() => {
    setDay(null);
    load();
  }, [load]);

  useEffect(() => onReservationsChanged(load), [load]);

  useEffect(() => {
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources));
  }, []);

  const reservations = day?.reservations ?? [];
  const visible = reservations.filter((r) => matchesStatus(r, status));
  const opened = openId ? reservations.find((r) => r.id === openId) : undefined;
  const dayLabel = capitalizeFirst(parseDay(date).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  const returnTo = `/admin/agenda?data=${date}`;
  /** Formulário de reserva do SAD já com o dia (e a sala) da Agenda. */
  const newReservationUrl = (roomId?: string) =>
    `/admin/reservar?${new URLSearchParams({ data: date, voltar: returnTo, ...(roomId ? { sala: roomId } : {}) }).toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agenda"
        description="Tudo o que acontece em cada dia: as reservas por situação e as salas ocupadas e livres."
        actions={
          <Button icon={CalendarPlusIcon} onClick={() => navigate(newReservationUrl())}>
            Nova reserva
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={CaretLeftIcon} label="Dia anterior" variant="secondary" onClick={() => setDate(shiftDay(date, -1))} />
        <IconButton icon={CaretRightIcon} label="Próximo dia" variant="secondary" onClick={() => setDate(shiftDay(date, 1))} />
        <Button variant="secondary" onClick={() => setDate(isoDay(new Date()))}>
          Hoje
        </Button>
        <Input type="date" aria-label="Escolher o dia" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
        <p className="ml-1 text-base font-semibold sm:text-lg" aria-live="polite">
          {dayLabel}
        </p>
      </div>

      <SegmentedControl
        label="Situação"
        value={status}
        onChange={setStatus}
        options={STATUS_FILTERS.map((f) => ({
          value: f.value,
          label: f.label,
          icon: f.icon,
          count: day ? reservations.filter((r) => matchesStatus(r, f.value)).length : undefined,
        }))}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        {/* No celular a lista vem primeiro; o calendário do mês fica depois. */}
        <aside className="order-2 lg:order-1">
          <MonthCalendar selected={date} onSelect={setDate} counts={counts} />
        </aside>

        <div className="order-1 min-w-0 lg:order-2">
          <section className="space-y-3">
            {day === null ? (
              <div className="space-y-2">
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={ClockIcon}
                title={reservations.length === 0 ? "Nenhuma reserva neste dia" : "Nenhuma reserva nesta situação"}
                description={reservations.length === 0 ? "Todas as salas estão livres." : undefined}
              />
            ) : (
              <ul className="space-y-2">
                {visible.map((r) => (
                  <ReservationRow key={r.id} reservation={r} onOpen={() => openReservation(r.id)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* A linha do tempo ocupa a largura toda: são 16 horas lado a lado. */}
      {day === null ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : day.rooms.length > 0 ? (
        <RoomsTimeline day={day} onOpen={(r) => openReservation(r.id)} onBook={(roomId) => navigate(newReservationUrl(roomId))} />
      ) : (
        <EmptyState icon={DoorOpenIcon} title="Nenhuma sala ativa" />
      )}

      {opened && !reviewing && (
        <Dialog
          open
          variant="drawer"
          onClose={() => openReservation(null)}
          title={opened.title}
          description={`${formatTimeRange(opened.startTime, opened.endTime)} · ${opened.room ? opened.room.name : "Sala a definir"}`}
          footer={
            <>
              <NoShowButton reservation={opened} onChanged={load} />
              <AdminReservationActions
                reservation={opened}
                returnTo={returnTo}
                onChanged={() => {
                  openReservation(null);
                  load();
                }}
              />
              {opened.status === "PENDING" && (
                <Button iconRight={ArrowRightIcon} onClick={() => setReviewing(opened)}>
                  Analisar
                </Button>
              )}
            </>
          }
        >
          <RequestDetails group={[opened]} resources={resources} />
        </Dialog>
      )}

      {reviewing && (
        <ReviewDrawer
          group={[reviewing]}
          resources={resources}
          onClose={() => setReviewing(null)}
          onDone={(message) => {
            toast.success(message, "O solicitante foi avisado por e-mail.");
            setReviewing(null);
            openReservation(null);
            load();
          }}
        />
      )}
    </div>
  );
}
