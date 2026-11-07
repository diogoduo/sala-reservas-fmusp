import {
  CalendarStarIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  HourglassMediumIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PencilSimpleLineIcon,
  ProhibitIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { EVENT_STATUS_LABELS, type EventStatus } from "../../lib/events";
import { capitalizeFirst, formatTimeRange, plural } from "../../lib/format";
import { onReservationsChanged } from "../../lib/reservations";
import { useToast } from "../../lib/toast";
import type { ActivityType, ReservationStatus } from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card } from "../ui/Surface";

// Fase 15 — agenda geral do SAD e do NUCEV: semana e mês, com as reservas e os
// eventos juntos (o evento aparece uma vez por dia, com as salas dele), e
// filtros por situação, espaço e pessoa (solicitante ou responsável).

interface RangeReservation {
  id: string;
  protocol: string;
  title: string;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  modifiedByRequesterAt: string | null;
  activityType: ActivityType | null;
  expectedAttendees: number;
  seriesId: string | null;
  room: { id: string; name: string } | null;
  user: { name: string; email: string };
  reviewedBy: { name: string } | null;
}

interface RangeEvent {
  id: string;
  protocol: string;
  title: string;
  status: EventStatus;
  expectedAttendees: number;
  assigneeName: string | null;
  responsible: string;
  user: { name: string; email: string };
  days: { date: string; startTime: string; endTime: string; rooms: { id: string; name: string }[] }[];
}

interface RangeData {
  from: string;
  to: string;
  reservations: RangeReservation[];
  events: RangeEvent[];
  rooms: { id: string; name: string; building: string; floor: string }[];
}

/** A situação na agenda: o evento confirmado conta como aprovado; em andamento, como pendente. */
type Bucket = "PENDING" | "MODIFIED" | "APPROVED" | "CANCELLED" | "REJECTED";

type AgendaItem = {
  key: string;
  date: string;
  start: string;
  end: string;
  title: string;
  bucket: Bucket;
  roomIds: string[];
  people: string;
} & ({ kind: "reservation"; reservation: RangeReservation } | { kind: "event"; event: RangeEvent; rooms: { id: string; name: string }[] });

type StatusFilter = "ALL" | Bucket;
type KindFilter = "ALL" | "reservation" | "event";

const STATUS_FILTERS: { value: StatusFilter; label: string; icon: Icon }[] = [
  { value: "ALL", label: "Todas", icon: ListBulletsIcon },
  { value: "PENDING", label: "Pendentes", icon: HourglassMediumIcon },
  { value: "MODIFIED", label: "Alteradas", icon: PencilSimpleLineIcon },
  { value: "APPROVED", label: "Aprovadas", icon: CheckCircleIcon },
  { value: "CANCELLED", label: "Canceladas", icon: ProhibitIcon },
  { value: "REJECTED", label: "Rejeitadas", icon: XCircleIcon },
];

/** Cor da faixa à esquerda de cada item, pela situação. */
const BUCKET_STYLE: Record<Bucket, string> = {
  APPROVED: "border-l-success-foreground",
  PENDING: "border-l-warning-foreground",
  MODIFIED: "border-l-info-foreground",
  CANCELLED: "border-l-border-strong opacity-60",
  REJECTED: "border-l-danger-foreground opacity-60",
};

const BUCKET_DOT: Record<Bucket, string> = {
  APPROVED: "bg-success-foreground",
  PENDING: "bg-warning-foreground",
  MODIFIED: "bg-info-foreground",
  CANCELLED: "bg-border-strong",
  REJECTED: "bg-danger-foreground",
};

const LEGEND: { bucket: Bucket; label: string }[] = [
  { bucket: "APPROVED", label: "Aprovada ou evento confirmado" },
  { bucket: "PENDING", label: "Pendente ou evento em andamento" },
  { bucket: "MODIFIED", label: "Alterada pelo solicitante" },
  { bucket: "CANCELLED", label: "Cancelada" },
  { bucket: "REJECTED", label: "Rejeitada" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (key: string) => new Date(`${key}T12:00:00`);
const addDays = (key: string, days: number) => {
  const d = parseDay(key);
  d.setDate(d.getDate() + days);
  return isoDay(d);
};
/** Semana de segunda a domingo. */
const weekStart = (key: string) => addDays(key, -((parseDay(key).getDay() + 6) % 7));
const WEEKDAYS = ["seg.", "ter.", "qua.", "qui.", "sex.", "sáb.", "dom."];
const localKey = (iso: string) => isoDay(new Date(iso));

/** O período da visão: a semana do dia escolhido, ou o mês (com as semanas completas, para a grade). */
function rangeOf(view: "week" | "month", date: string) {
  if (view === "week") {
    const from = weekStart(date);
    return { from, to: addDays(from, 6), gridFrom: from, gridTo: addDays(from, 6) };
  }
  const d = parseDay(date);
  const from = isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
  const to = isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const gridFrom = weekStart(from);
  const gridTo = addDays(weekStart(to), 6);
  return { from, to, gridFrom, gridTo };
}

function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) out.push(key);
  return out;
}

function toItems(data: RangeData): AgendaItem[] {
  const items: AgendaItem[] = data.reservations.map((r) => ({
    key: r.id,
    kind: "reservation",
    reservation: r,
    date: localKey(r.startTime),
    start: r.startTime,
    end: r.endTime,
    title: r.title,
    bucket: r.status === "PENDING" && r.modifiedByRequesterAt ? "MODIFIED" : r.status,
    roomIds: r.room ? [r.room.id] : [],
    people: `${r.user.name} ${r.user.email} ${r.reviewedBy?.name ?? ""}`,
  }));
  for (const e of data.events) {
    for (const day of e.days) {
      items.push({
        key: `${e.id}:${day.date}`,
        kind: "event",
        event: e,
        rooms: day.rooms,
        date: day.date,
        start: day.startTime,
        end: day.endTime,
        title: e.title,
        bucket: e.status === "CONFIRMED" ? "APPROVED" : "PENDING",
        roomIds: day.rooms.map((r) => r.id),
        people: `${e.user.name} ${e.user.email} ${e.assigneeName ?? ""} ${e.responsible}`,
      });
    }
  }
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

const roomText = (item: AgendaItem) =>
  item.kind === "reservation"
    ? (item.reservation.room?.name ?? "Sala a definir")
    : item.rooms.length === 0
      ? "Salas a definir"
      : item.rooms.length === 1
        ? item.rooms[0]!.name
        : plural(item.rooms.length, "sala", "salas");

function ItemButton({ item, compact, onOpen }: { item: AgendaItem; compact?: boolean; onOpen: (item: AgendaItem) => void }) {
  const crossed = item.bucket === "CANCELLED" || item.bucket === "REJECTED";
  const label = item.kind === "event" ? `Evento · ${EVENT_STATUS_LABELS[item.event.status]}` : undefined;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={`${formatTimeRange(item.start, item.end)} · ${item.title} · ${roomText(item)}${label ? ` · ${label}` : ""}`}
      className={cn(
        "w-full rounded-lg border border-l-4 border-border bg-surface text-left transition-[border-color,box-shadow] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        BUCKET_STYLE[item.bucket],
        compact ? "px-2 py-1.5 text-xs" : "p-3 text-sm",
      )}
    >
      <span className="flex items-center gap-1 font-semibold tabular-nums">
        {item.kind === "event" && <CalendarStarIcon size={compact ? 13 : 15} className="shrink-0 text-primary" aria-label="Evento" />}
        {formatTimeRange(item.start, item.end)}
      </span>
      <span className={cn("block font-medium break-words", compact ? "line-clamp-2" : "", crossed && "line-through decoration-muted/60")}>{item.title}</span>
      <span className="block truncate text-muted">
        {roomText(item)}
        {!compact && ` · ${item.kind === "event" ? item.event.user.name : item.reservation.user.name}`}
      </span>
      {!compact && label && <span className="mt-0.5 block text-xs text-primary">{label}</span>}
    </button>
  );
}

const dayTitle = (key: string, today: string) => {
  const d = parseDay(key);
  const text = capitalizeFirst(d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }));
  return key === today ? `${text} · hoje` : text;
};

/** Celular (e a visão do mês em telas estreitas): os dias em lista, só os que têm algo. */
function DayList({ days, byDay, today, onOpen }: { days: string[]; byDay: Map<string, AgendaItem[]>; today: string; onOpen: (item: AgendaItem) => void }) {
  const withItems = days.filter((d) => (byDay.get(d)?.length ?? 0) > 0);
  if (withItems.length === 0) return <EmptyState icon={ClockIcon} title="Nada neste período" description="Nenhuma reserva ou evento com esses filtros." />;
  return (
    <div className="space-y-5">
      {withItems.map((d) => (
        <section key={d} className="space-y-2" aria-label={dayTitle(d, today)}>
          <h3 className={cn("text-sm font-semibold", d === today && "text-primary")}>{dayTitle(d, today)}</h3>
          <ul className="space-y-2">
            {byDay.get(d)!.map((item) => (
              <li key={item.key}>
                <ItemButton item={item} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function WeekGrid({ days, byDay, today, onOpen, onOpenDay }: { days: string[]; byDay: Map<string, AgendaItem[]>; today: string; onOpen: (item: AgendaItem) => void; onOpenDay: (date: string) => void }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d, i) => {
        const items = byDay.get(d) ?? [];
        return (
          <section key={d} aria-label={dayTitle(d, today)} className={cn("min-w-0 rounded-xl border border-border bg-surface-muted/40 p-2", d === today && "border-primary ring-1 ring-primary")}>
            <button type="button" onClick={() => onOpenDay(d)} className="mb-2 w-full rounded-md px-1 py-0.5 text-left hover:bg-surface-muted" title="Abrir o dia">
              <span className="block text-xs text-muted">{WEEKDAYS[i]}</span>
              <span className={cn("text-lg font-semibold tabular-nums", d === today && "text-primary")}>{parseDay(d).getDate()}</span>
              <span className="ml-1 text-xs text-muted">{items.length > 0 ? plural(items.length, "item", "itens") : ""}</span>
            </button>
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.key}>
                  <ItemButton item={item} compact onOpen={onOpen} />
                </li>
              ))}
            </ul>
            {items.length === 0 && <p className="px-1 text-xs text-muted">Livre</p>}
          </section>
        );
      })}
    </div>
  );
}

const MONTH_CELL_ITEMS = 3;

function MonthGrid({
  days,
  month,
  byDay,
  today,
  onOpen,
  onOpenDay,
}: {
  days: string[];
  month: string;
  byDay: Map<string, AgendaItem[]>;
  today: string;
  onOpen: (item: AgendaItem) => void;
  onOpenDay: (date: string) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1">
        {WEEKDAYS.map((w) => (
          <p key={w} className="px-2 text-xs font-medium text-muted">
            {w}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const outside = !d.startsWith(month);
          return (
            <section
              key={d}
              aria-label={dayTitle(d, today)}
              className={cn("flex min-h-32 min-w-0 flex-col rounded-lg border border-border p-1.5", outside ? "bg-surface-muted/30 opacity-60" : "bg-surface", d === today && "border-primary ring-1 ring-primary")}
            >
              <button type="button" onClick={() => onOpenDay(d)} className={cn("self-start rounded px-1 text-sm font-semibold tabular-nums hover:bg-surface-muted", d === today && "text-primary")} title="Abrir o dia">
                {parseDay(d).getDate()}
              </button>
              <ul className="mt-1 space-y-0.5">
                {items.slice(0, MONTH_CELL_ITEMS).map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      title={`${formatTimeRange(item.start, item.end)} · ${item.title} · ${roomText(item)}`}
                      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-muted"
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", BUCKET_DOT[item.bucket])} aria-hidden />
                      {item.kind === "event" && <CalendarStarIcon size={12} className="shrink-0 text-primary" aria-label="Evento" />}
                      <span className="shrink-0 tabular-nums text-muted">{formatTimeRange(item.start, item.end).split("–")[0]}</span>
                      <span className="truncate">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {items.length > MONTH_CELL_ITEMS && (
                <button type="button" onClick={() => onOpenDay(d)} className="mt-auto self-start rounded px-1 text-xs font-medium text-primary hover:underline">
                  +{items.length - MONTH_CELL_ITEMS} mais
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function AgendaRange({
  view,
  date,
  onDateChange,
  onOpenReservation,
  onOpenDay,
}: {
  view: "week" | "month";
  date: string;
  onDateChange: (date: string) => void;
  onOpenReservation: (date: string, id: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { from, to, gridFrom, gridTo } = rangeOf(view, date);
  const [data, setData] = useState<RangeData | null>(null);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [roomId, setRoomId] = useState("");
  const [person, setPerson] = useState("");
  const today = isoDay(new Date());

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<RangeData>(`/admin/agenda/range?from=${gridFrom}&to=${gridTo}`)
        .then((res) => alive && setData(res))
        .catch((e: Error) => {
          if (!alive) return;
          toast.error("Não foi possível carregar a agenda.", e.message);
          setData({ from: gridFrom, to: gridTo, reservations: [], events: [], rooms: [] });
        });
    setData(null);
    void load();
    const off = onReservationsChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridFrom, gridTo]);

  const items = useMemo(() => (data ? toItems(data) : []), [data]);
  const needle = person.trim().toLowerCase();
  const inPeriod = (item: AgendaItem) => item.date >= from && item.date <= to;
  const passesOthers = (item: AgendaItem) =>
    (kind === "ALL" || item.kind === kind) && (!roomId || item.roomIds.includes(roomId)) && (!needle || item.people.toLowerCase().includes(needle));
  const filtered = items.filter((item) => (status === "ALL" || item.bucket === status) && passesOthers(item));
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of filtered) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);

  const periodItems = filtered.filter(inPeriod);
  const reservationsCount = periodItems.filter((i) => i.kind === "reservation").length;
  const eventsCount = new Set(periodItems.flatMap((i) => (i.kind === "event" ? [i.event.id] : []))).size;
  const pendingCount = periodItems.filter((i) => i.bucket === "PENDING" || i.bucket === "MODIFIED").length;

  const label =
    view === "week"
      ? `${parseDay(from).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} a ${parseDay(to).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}`
      : capitalizeFirst(parseDay(from).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  const shift = (delta: number) => {
    if (view === "week") onDateChange(addDays(from, delta * 7));
    else {
      const d = parseDay(from);
      onDateChange(isoDay(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
    }
  };
  const open = (item: AgendaItem) => {
    if (item.kind === "event") navigate(`/admin/eventos/${item.event.id}`);
    else onOpenReservation(item.date, item.reservation.id);
  };
  const filtersOn = Boolean(kind !== "ALL" || roomId || needle);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={CaretLeftIcon} label={view === "week" ? "Semana anterior" : "Mês anterior"} variant="secondary" onClick={() => shift(-1)} />
        <IconButton icon={CaretRightIcon} label={view === "week" ? "Próxima semana" : "Próximo mês"} variant="secondary" onClick={() => shift(1)} />
        <Button variant="secondary" onClick={() => onDateChange(today)}>
          Hoje
        </Button>
        <Input type="date" aria-label="Ir para o dia" value={date} onChange={(e) => e.target.value && onDateChange(e.target.value)} className="w-44" />
        <p className="ml-1 text-base font-semibold sm:text-lg" aria-live="polite">
          {label}
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
          count: data ? items.filter((i) => inPeriod(i) && passesOthers(i) && (f.value === "ALL" || i.bucket === f.value)).length : undefined,
        }))}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Mostrar" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
          <option value="ALL">Reservas e eventos</option>
          <option value="reservation">Só reservas</option>
          <option value="event">Só eventos</option>
        </Select>
        <Select label="Espaço" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Todos os espaços</option>
          {(data?.rooms ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.floor}
            </option>
          ))}
        </Select>
        <div className="relative">
          <Input
            label="Pessoa"
            type="search"
            placeholder="Solicitante ou responsável"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className="pl-10"
          />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute bottom-3 left-3 text-muted" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-sm text-muted" aria-live="polite">
          {data ? (
            <>
              {plural(reservationsCount, "reserva", "reservas")} · {plural(eventsCount, "evento", "eventos")} ·{" "}
              <span className={pendingCount > 0 ? "font-medium text-warning-foreground" : undefined}>{plural(pendingCount, "pendência", "pendências")}</span>
              {filtersOn && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => {
                      setKind("ALL");
                      setRoomId("");
                      setPerson("");
                    }}
                  >
                    limpar filtros
                  </button>
                </>
              )}
            </>
          ) : (
            "Carregando…"
          )}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda das cores">
          {LEGEND.map((l) => (
            <li key={l.bucket} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", BUCKET_DOT[l.bucket])} aria-hidden /> {l.label}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <CalendarStarIcon size={13} className="text-primary" aria-hidden /> Evento
          </li>
        </ul>
      </div>

      {data === null ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : view === "week" ? (
        <>
          <Card className="hidden p-3 lg:block">
            <WeekGrid days={daysBetween(from, to)} byDay={byDay} today={today} onOpen={open} onOpenDay={onOpenDay} />
          </Card>
          <div className="lg:hidden">
            <DayList days={daysBetween(from, to)} byDay={byDay} today={today} onOpen={open} />
          </div>
        </>
      ) : (
        <>
          <Card className="hidden p-3 md:block">
            <MonthGrid days={daysBetween(gridFrom, gridTo)} month={from.slice(0, 7)} byDay={byDay} today={today} onOpen={open} onOpenDay={onOpenDay} />
          </Card>
          <div className="md:hidden">
            <DayList days={daysBetween(from, to)} byDay={byDay} today={today} onOpen={open} />
          </div>
        </>
      )}
    </div>
  );
}
