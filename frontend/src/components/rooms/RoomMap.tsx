import { BuildingsIcon, LockIcon, MapTrifoldIcon, UsersIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { sortRooms } from "../../lib/rooms";
import { useToast } from "../../lib/toast";
import { ROOM_TYPE_LABELS, type Room } from "../../lib/types";
import { CardListSkeleton } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";
import { RoomDetailsDrawer } from "./RoomDetails";

// Fase 19 — mapa das salas (documento SAD/NUCEV, 2.1): os espaços por prédio e
// andar, com o número, a capacidade e a situação no dia e horário escolhidos
// (livre, ocupada ou bloqueada). Clicar na sala abre os detalhes (fotos,
// recursos, calendário). As plantas dos prédios entram quando chegarem todas.

type State = "FREE" | "BUSY" | "BLOCKED";

interface MapStatus {
  rooms: { id: string; state: State; busy: { start: string; end: string }[]; blocks: { start: string; end: string; reason: string }[] }[];
}

const STATE: Record<State, { label: string; tile: string; dot: string }> = {
  FREE: { label: "Livre", tile: "border-success-foreground/40 bg-success-soft text-success-foreground", dot: "bg-success-foreground" },
  BUSY: { label: "Ocupada", tile: "border-danger-foreground/40 bg-danger-soft text-danger-foreground", dot: "bg-danger-foreground" },
  BLOCKED: { label: "Bloqueada", tile: "border-border-strong bg-neutral-soft text-neutral-foreground", dot: "bg-border-strong" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const startDefault = `${pad(Math.min(now.getHours(), 22))}:00`;
const endDefault = `${pad(Math.min(now.getHours() + 1, 23))}:00`;

/** "Sala de Aula 1107" → "1107"; o resto fica como está. */
const shortName = (name: string) => name.match(/\b\d{3,4}[A-Z]?\b(?:\s?[A-Z])?$/)?.[0] ?? name;

function floorRank(floor: string) {
  if (/subsolo/i.test(floor)) return -1;
  if (/t[ée]rreo/i.test(floor)) return 0;
  const n = floor.match(/\d+/);
  return n ? Number(n[0]) : 99;
}

export function RoomMap() {
  const toast = useToast();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [status, setStatus] = useState<MapStatus | null>(null);
  const [date, setDate] = useState(today);
  const [start, setStart] = useState(startDefault);
  const [end, setEnd] = useState(endDefault);
  const [building, setBuilding] = useState("");
  const [minCapacity, setMinCapacity] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [open, setOpen] = useState<Room | null>(null);

  useEffect(() => {
    api<{ rooms: Room[] }>("/rooms?status=ACTIVE")
      .then((res) => setRooms(sortRooms(res.rooms)))
      .catch((e) => toast.error("Não foi possível carregar as salas.", e instanceof ApiError ? e.message : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!(end > start)) return;
    setStatus(null);
    api<MapStatus>(`/rooms/map/status?date=${date}&start=${start}&end=${end}`)
      .then(setStatus)
      .catch((e) => toast.error("Não foi possível ver a situação das salas.", e instanceof ApiError ? e.message : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, start, end]);

  const byId = useMemo(() => new Map((status?.rooms ?? []).map((r) => [r.id, r])), [status]);
  const buildings = [...new Set((rooms ?? []).map((r) => r.building))];
  const visible = (rooms ?? []).filter(
    (r) => (!building || r.building === building) && (!minCapacity || (r.capacity ?? 0) >= Number(minCapacity)) && (!onlyFree || byId.get(r.id)?.state === "FREE"),
  );
  const counts = { FREE: 0, BUSY: 0, BLOCKED: 0 } as Record<State, number>;
  for (const r of visible) {
    const s = byId.get(r.id)?.state;
    if (s) counts[s]++;
  }
  // Prédio → andar (do subsolo para cima) → salas.
  const groups = [...new Set(visible.map((r) => r.building))].map((b) => {
    const inBuilding = visible.filter((r) => r.building === b);
    const floors = [...new Set(inBuilding.map((r) => r.floor))].sort((x, y) => floorRank(x) - floorRank(y));
    return { building: b, floors: floors.map((f) => ({ floor: f, rooms: inBuilding.filter((r) => r.floor === f) })) };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Mapa das salas" description="Os espaços por prédio e andar, com a capacidade e a situação no dia e no horário escolhidos. Clique na sala para ver os detalhes." />

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Input label="Dia" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} containerClassName="lg:col-span-2" />
        <Input label="Das" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input label="Até" type="time" value={end} onChange={(e) => setEnd(e.target.value)} error={end <= start ? "O fim vem depois do início." : undefined} />
        <Select label="Prédio" value={building} onChange={(e) => setBuilding(e.target.value)}>
          <option value="">Todos</option>
          {buildings.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
        <Input label="Pessoas (mín.)" type="number" min={1} inputMode="numeric" value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legenda">
          {(Object.keys(STATE) as State[]).map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("size-3 rounded-full", STATE[s].dot)} aria-hidden /> {STATE[s].label}
              {status && <span className="text-muted">({counts[s]})</span>}
            </li>
          ))}
        </ul>
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Só as livres
        </label>
      </div>

      {rooms === null ? (
        <CardListSkeleton />
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma sala com esses filtros.</p>
      ) : (
        groups.map((g) => (
          <section key={g.building} aria-label={g.building} className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <BuildingsIcon size={20} className="text-primary" aria-hidden /> {g.building}
            </h2>
            {/* Os andares de cima para baixo, como num prédio. */}
            {[...g.floors].reverse().map((f) => (
              <div key={f.floor} className="grid gap-3 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <p className="text-sm font-semibold text-muted sm:pt-2">{f.floor}</p>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                  {f.rooms.map((r) => {
                    const s = byId.get(r.id);
                    const style = s ? STATE[s.state] : null;
                    const title = [
                      r.name,
                      r.capacity ? `${r.capacity} lugares` : "sem limite cadastrado",
                      s?.busy.length ? `Ocupada no dia: ${s.busy.map((b) => `${b.start}–${b.end}`).join(", ")}` : "Sem reservas no dia",
                      ...(s?.blocks.map((b) => `Bloqueio ${b.start}–${b.end}: ${b.reason}`) ?? []),
                    ].join("\n");
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setOpen(r)}
                          title={title}
                          aria-label={`${r.name}, ${style?.label ?? "carregando"}`}
                          className={cn(
                            "flex h-full min-h-20 w-full flex-col justify-between rounded-xl border p-2.5 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            style?.tile ?? "border-border bg-surface-muted text-muted",
                          )}
                        >
                          <span className="flex items-start justify-between gap-1">
                            <span className="text-base leading-tight font-bold break-words">{shortName(r.name)}</span>
                            {s?.state === "BLOCKED" && <LockIcon size={14} aria-hidden />}
                          </span>
                          <span className="mt-1 block text-[11px] leading-tight opacity-90">{r.roomType === "SUPPORT_AREA" || shortName(r.name) !== r.name ? (ROOM_TYPE_LABELS[r.roomType] ?? "") : ""}</span>
                          <span className="mt-1 flex items-center justify-between gap-1 text-xs">
                            <span className="inline-flex items-center gap-1">
                              <UsersIcon size={12} aria-hidden /> {r.capacity ?? "—"}
                            </span>
                            <span className="font-semibold">{style?.label ?? "…"}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}

      {status && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <MapTrifoldIcon size={14} aria-hidden /> {plural(visible.length, "espaço", "espaços")} no mapa. As plantas dos prédios entram aqui quando todas estiverem
          digitalizadas.
        </p>
      )}

      {open && <RoomDetailsDrawer room={open} onClose={() => setOpen(null)} initialDate={new Date(`${date}T12:00:00`)} />}
    </div>
  );
}
