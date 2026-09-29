import {
  ArrowRightIcon,
  CalendarBlankIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  LockIcon,
  PencilSimpleLineIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ACTIVITY_TYPE_LABELS } from "../../lib/activities";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/cn";
import { capitalizeFirst, formatTimeRange, plural } from "../../lib/format";
import { formatMinutes } from "../../lib/reservations";
import { ACTIVITY_ICONS } from "../../lib/icons";
import type { BusyInterval } from "../../lib/types";
import { StatusBadge } from "../StatusBadge";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Skeleton } from "../ui/Feedback";

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Uma reserva do dia: o que é, de que tipo e (para o SAD) de quem, com recursos e observações. */
function ReservationItem({ interval, isAdmin, day }: { interval: BusyInterval; isAdmin: boolean; day: Date }) {
  const navigate = useNavigate();
  const ActivityIcon = interval.activityType ? ACTIVITY_ICONS[interval.activityType] : CalendarBlankIcon;
  return (
    <li className="rounded-lg bg-surface-muted p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold tabular-nums">{formatTimeRange(interval.start, interval.end)}</span>
        {interval.status && <StatusBadge status={interval.status} />}
        {interval.modified && (
          <Badge tone="info" icon={PencilSimpleLineIcon}>
            Alterada
          </Badge>
        )}
      </div>
      {interval.title && <p className="mt-1.5 font-medium break-words">{interval.title}</p>}
      {interval.activityType && (
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          <ActivityIcon size={14} aria-hidden /> {ACTIVITY_TYPE_LABELS[interval.activityType]}
          {interval.setupMinutes ? ` · inclui ${formatMinutes(interval.setupMinutes)} de montagem` : ""}
        </p>
      )}
      {isAdmin && interval.requester && (
        <dl className="mt-2.5 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border pt-2.5 text-xs">
          {interval.protocol && (
            <>
              <dt className="text-muted">Protocolo</dt>
              <dd className="tabular-nums">{interval.protocol}</dd>
            </>
          )}
          <dt className="text-muted">Solicitante</dt>
          <dd className="min-w-0 break-words">
            {interval.requester.name} · {interval.requester.email}
          </dd>
          {interval.expectedAttendees !== undefined && (
            <>
              <dt className="text-muted">Participantes</dt>
              <dd>{plural(interval.expectedAttendees, "pessoa", "pessoas")}</dd>
            </>
          )}
          {interval.resources && interval.resources.length > 0 && (
            <>
              <dt className="text-muted">Recursos</dt>
              <dd className="min-w-0 break-words">{interval.resources.join("; ")}</dd>
            </>
          )}
          {interval.supportNotes && (
            <>
              <dt className="text-muted">Obs. para TI</dt>
              <dd className="min-w-0 break-words whitespace-pre-line">{interval.supportNotes}</dd>
            </>
          )}
          {interval.description && (
            <>
              <dt className="text-muted">Descrição</dt>
              <dd className="line-clamp-3 min-w-0 break-words">{interval.description}</dd>
            </>
          )}
        </dl>
      )}
      {isAdmin && interval.id && (
        <Button
          variant="ghost"
          size="sm"
          iconRight={ArrowRightIcon}
          className="mt-2 -ml-3"
          onClick={() => navigate(`/admin/agenda?data=${isoDay(day)}&reserva=${interval.id}`)}
        >
          Abrir na Agenda
        </Button>
      )}
    </li>
  );
}

/**
 * Calendário mensal da sala (GET /api/rooms/:id/availability): marca os dias
 * com algum horário ocupado e, ao clicar num dia, lista as reservas do dia com
 * título e tipo de atividade (o SAD vê a reserva inteira). Só orienta a
 * consulta — quem garante que não há conflito é o back-end ao aprovar.
 */
export function AvailabilityCalendar({ roomId, initialDate }: { roomId: string; /** Abre já neste dia. */ initialDate?: Date }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [monthOffset, setMonthOffset] = useState(() => {
    if (!initialDate) return 0;
    const now = new Date();
    return (initialDate.getFullYear() - now.getFullYear()) * 12 + initialDate.getMonth() - now.getMonth();
  });
  const [busy, setBusy] = useState<BusyInterval[] | null>(null);
  const [selected, setSelected] = useState<Date>(() => initialDate ?? new Date());

  const viewDate = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  useEffect(() => {
    const from = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const to = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    setBusy(null);
    api<{ busy: BusyInterval[] }>(`/rooms/${roomId}/availability?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((res) => setBusy(res.busy))
      .catch(() => setBusy([]));
  }, [roomId, viewDate]);

  // Intervalos agrupados por dia (reservas não atravessam a meia-noite).
  const byDay = useMemo(() => {
    const map = new Map<string, BusyInterval[]>();
    for (const interval of busy ?? []) {
      const key = dayKey(new Date(interval.start));
      map.set(key, [...(map.get(key) ?? []), interval]);
    }
    return map;
  }, [busy]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstWeekday = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewDate.getFullYear(), viewDate.getMonth(), i + 1)),
  ];
  const selectedIntervals = byDay.get(dayKey(selected)) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <IconButton icon={CaretLeftIcon} label="Mês anterior" variant="secondary" size="sm" onClick={() => setMonthOffset((m) => m - 1)} />
        <p className="font-display text-base font-semibold" aria-live="polite">
          {capitalizeFirst(viewDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}
        </p>
        <IconButton icon={CaretRightIcon} label="Próximo mês" variant="secondary" size="sm" onClick={() => setMonthOffset((m) => m + 1)} />
      </div>

      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={`vazio-${i}`} />;
            const isPast = date < today;
            const count = byDay.get(dayKey(date))?.length ?? 0;
            const isToday = date.getTime() === today.getTime();
            const isSelected = dayKey(date) === dayKey(selected);
            return (
              <button
                key={dayKey(date)}
                type="button"
                onClick={() => setSelected(date)}
                aria-pressed={isSelected}
                aria-label={`${date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}: ${
                  count > 0 ? `${count} ${count === 1 ? "horário ocupado" : "horários ocupados"}` : "livre"
                }`}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm font-medium tabular-nums transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isPast
                      ? "text-muted/60 hover:bg-surface-muted"
                      : "hover:bg-surface-muted",
                  isToday && !isSelected && "ring-1 ring-primary ring-inset",
                )}
              >
                {date.getDate()}
                {count > 0 && (
                  <span className="absolute bottom-1.5 flex gap-0.5" aria-hidden>
                    {Array.from({ length: Math.min(count, 3) }, (_, k) => (
                      <span key={k} className={cn("size-1 rounded-full", isSelected ? "bg-primary-foreground" : "bg-amber-500")} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden /> horário ocupado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded ring-1 ring-primary ring-inset" aria-hidden /> hoje
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">
          {capitalizeFirst(selected.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))}
        </p>
        {busy === null ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : selectedIntervals.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-success-foreground">
            <CheckCircleIcon size={18} weight="fill" aria-hidden /> Nenhum horário ocupado neste dia.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {selectedIntervals.map((interval, i) =>
              interval.type === "block" ? (
                <li key={i} className="flex items-center gap-3 rounded-lg bg-surface-muted px-3 py-2 text-sm">
                  <LockIcon size={18} className="shrink-0 text-danger-foreground" aria-hidden />
                  <span className="font-medium tabular-nums">{formatTimeRange(interval.start, interval.end)}</span>
                  <span className="truncate text-muted">Bloqueado{interval.reason ? `: ${interval.reason}` : ""}</span>
                </li>
              ) : (
                <ReservationItem key={interval.id ?? i} interval={interval} isAdmin={isAdmin} day={selected} />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
