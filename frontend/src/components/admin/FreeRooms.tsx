import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  CopyIcon,
  LockIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { capitalizeFirst, formatTimeRange } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { RoomAvailability, RoomType } from "../../lib/types";
import { RoomThumb } from "../rooms/RoomPhotos";
import { RoomResourceChips } from "../solicitante/RoomSearch";
import { AvailabilityCalendar } from "../solicitante/AvailabilityCalendar";
import { StatusBadge } from "../StatusBadge";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, EmptyState, Skeleton } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];
const pad = (n: number) => String(n).padStart(2, "0");
const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Próxima meia hora cheia, por 1 hora: o palpite mais útil quando alguém pergunta "tem sala agora?". */
function nextSlot() {
  const start = new Date();
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { data: toDateValue(start), inicio: toTimeValue(start), fim: toTimeValue(end) };
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min((h ?? 0) * 60 + (m ?? 0) + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const PERIODS: { label: string; inicio: string; fim: string }[] = [
  { label: "Manhã", inicio: "08:00", fim: "12:00" },
  { label: "Tarde", inicio: "13:00", fim: "17:00" },
  { label: "Noite", inicio: "19:00", fim: "22:00" },
];

function QuickChip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-9 rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary-soft text-primary-soft-foreground"
          : "border-border-strong text-muted hover:border-primary/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Consulta rápida do SAD: "qual sala está livre no dia 30, das 10 às 11?".
 * Os campos ficam na URL (/admin/salas-livres?data=…&inicio=…&fim=…), então
 * dá para voltar à pesquisa ou mandar o link para alguém da equipe.
 */
export function FreeRooms() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const defaults = useMemo(nextSlot, []);
  const date = params.get("data") ?? defaults.data;
  const start = params.get("inicio") ?? defaults.inicio;
  const end = params.get("fim") ?? defaults.fim;
  const minCapacity = params.get("capacidade") ?? "";
  const roomType = (params.get("tipo") ?? "") as RoomType | "";

  const [rooms, setRooms] = useState<RoomAvailability[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [agenda, setAgenda] = useState<RoomAvailability["room"] | null>(null);

  function update(patch: Partial<Record<"data" | "inicio" | "fim" | "capacidade" | "tipo", string>>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const merged = { data: date, inicio: start, fim: end, ...patch };
        for (const [key, value] of Object.entries(merged)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }

  const startDate = new Date(`${date}T${start}:00`);
  const endDate = new Date(`${date}T${end}:00`);
  const valid = !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate > startDate;

  // Busca a cada mudança (com uma pausa curta enquanto a pessoa ainda digita).
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ start: startDate.toISOString(), end: endDate.toISOString() });
      api<{ rooms: RoomAvailability[] }>(`/admin/availability?${query.toString()}`)
        .then((res) => !cancelled && setRooms(res.rooms))
        .catch((e: Error) => !cancelled && toast.error("Não foi possível consultar as salas.", e.message))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, start, end, valid]);

  const filtered = (rooms ?? []).filter(
    (r) => (!minCapacity || (r.room.capacity ?? 0) >= Number(minCapacity)) && (!roomType || r.room.roomType === roomType),
  );
  const free = filtered.filter((r) => r.free);
  const occupied = filtered.filter((r) => !r.free);
  const dayLabel = valid ? capitalizeFirst(startDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })) : "";
  const today = toDateValue(new Date());
  const tomorrow = toDateValue(new Date(Date.now() + 24 * 60 * 60 * 1000));

  async function copyAnswer(r: RoomAvailability) {
    const when = startDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    // Sem artigo: "a Sala 101", mas "o Laboratório"/"o Auditório".
    const text = `${r.room.name} (${r.room.building}, ${r.room.floor}, até ${r.room.capacity} pessoas) está disponível no dia ${when}, das ${start} às ${end}.`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Resposta copiada", text);
    } catch {
      toast.error("Não foi possível copiar.", text);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Salas livres" description="Responda na hora: qual sala está disponível num dia e horário." />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Dia" type="date" value={date} onChange={(e) => update({ data: e.target.value })} />
          <Input label="Das" type="time" step={300} value={start} onChange={(e) => update({ inicio: e.target.value })} />
          <Input label="Às" type="time" step={300} value={end} onChange={(e) => update({ fim: e.target.value })} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <QuickChip active={date === today} onClick={() => update({ data: today })}>
            Hoje
          </QuickChip>
          <QuickChip active={date === tomorrow} onClick={() => update({ data: tomorrow })}>
            Amanhã
          </QuickChip>
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          {[30, 60, 120].map((minutes) => (
            <QuickChip key={minutes} active={end === addMinutes(start, minutes)} onClick={() => update({ fim: addMinutes(start, minutes) })}>
              {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
            </QuickChip>
          ))}
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          {PERIODS.map((p) => (
            <QuickChip key={p.label} active={start === p.inicio && end === p.fim} onClick={() => update({ inicio: p.inicio, fim: p.fim })}>
              {p.label}
            </QuickChip>
          ))}
        </div>
        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Input
            label="Capacidade mínima"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="Qualquer"
            value={minCapacity}
            onChange={(e) => update({ capacidade: e.target.value })}
          />
          <Select label="Tipo de espaço" value={roomType} onChange={(e) => update({ tipo: e.target.value })}>
            <option value="">Todos os tipos</option>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ROOM_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {!valid ? (
        <Alert tone="warning">Confira o horário: o término precisa ser depois do início.</Alert>
      ) : rooms === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={cn("space-y-8 transition-opacity duration-150", loading && "opacity-60")} aria-busy={loading}>
          <div aria-live="polite">
            <p className="font-display text-2xl font-bold">
              <span className={free.length > 0 ? "text-success-foreground" : "text-danger-foreground"}>{free.length}</span>{" "}
              {free.length === 1 ? "sala livre" : "salas livres"}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
              <ClockIcon size={16} aria-hidden /> {dayLabel} · das {start} às {end}
            </p>
          </div>

          {free.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title="Nenhuma sala livre nesse horário"
              description={minCapacity || roomType ? "Tente sem os filtros de capacidade e tipo, ou outro horário." : "Tente outro horário ou outro dia."}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {free.map((r, index) => (
                <li key={r.room.id} className="min-w-0 animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
                  <Card className="flex h-full flex-col border-success-foreground/25 p-5">
                    <div className="flex items-start gap-3">
                      <RoomThumb room={r.room} tone="success" />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold break-words">{r.room.name}</h2>
                        <p className="text-sm text-muted">{ROOM_TYPE_LABELS[r.room.roomType]}</p>
                      </div>
                      <Badge tone="success" icon={CheckCircleIcon}>
                        Livre
                      </Badge>
                    </div>
                    <div className="mt-4 space-y-1.5 text-sm text-muted">
                      <p className="flex items-center gap-2">
                        <MapPinIcon size={16} aria-hidden /> {r.room.building} · {r.room.floor}
                      </p>
                      <p className="flex items-center gap-2">
                        <UsersIcon size={16} aria-hidden /> até <strong className="text-foreground tabular-nums">{r.room.capacity}</strong> pessoas
                      </p>
                    </div>
                    {r.room.resources.some((link) => link.resource.requestable) && (
                      <div className="mt-4">
                        <RoomResourceChips room={r.room} />
                      </div>
                    )}
                    <div className="mt-auto flex gap-2 pt-5">
                      <Button variant="secondary" size="sm" icon={CopyIcon} className="flex-1" onClick={() => void copyAnswer(r)}>
                        Copiar resposta
                      </Button>
                      <Button variant="ghost" size="sm" icon={CalendarBlankIcon} onClick={() => setAgenda(r.room)}>
                        Agenda
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {occupied.length > 0 && (
            <section aria-labelledby="ocupadas">
              <h2 id="ocupadas" className="text-base font-semibold">
                Ocupadas nesse horário <span className="font-normal text-muted">({occupied.length})</span>
              </h2>
              <ul className="mt-3 space-y-3">
                {occupied.map((r) => (
                  <li key={r.room.id}>
                    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <RoomThumb room={r.room} tone="neutral" size="sm" dimmed />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {r.room.name}{" "}
                            <span className="text-sm font-normal text-muted">
                              · {r.room.building}, {r.room.floor} · até {r.room.capacity}
                            </span>
                          </p>
                          <ul className="mt-2 space-y-1.5">
                            {r.busy.map((b, i) => (
                              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                <span className="font-medium tabular-nums">{formatTimeRange(b.start, b.end)}</span>
                                {b.type === "reservation" ? (
                                  <>
                                    <span className="min-w-0 break-words">{b.title}</span>
                                    <StatusBadge status={b.status} />
                                    <span className="text-muted">· {b.requester}</span>
                                  </>
                                ) : (
                                  <span className="flex items-center gap-1 text-danger-foreground">
                                    <LockIcon size={14} aria-hidden /> Bloqueio: {b.reason}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" icon={CalendarBlankIcon} onClick={() => setAgenda(r.room)} className="self-start">
                        Agenda
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {agenda && (
        <Dialog
          open
          variant="drawer"
          onClose={() => setAgenda(null)}
          title={agenda.name}
          description={`${ROOM_TYPE_LABELS[agenda.roomType]} · ${agenda.building}, ${agenda.floor} · até ${agenda.capacity} pessoas`}
        >
          <AvailabilityCalendar roomId={agenda.id} initialDate={valid ? startDate : undefined} />
        </Dialog>
      )}
    </div>
  );
}
