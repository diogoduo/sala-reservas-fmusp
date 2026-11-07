import { BuildingsIcon, CalendarPlusIcon, CubeIcon, InfoIcon, LockIcon, MapPinIcon, MapTrifoldIcon, NavigationArrowIcon, RowsIcon, UsersIcon, XIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { directionsTo, placeRooms, sortFloors, type CampusMapData } from "../../lib/campusMap";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { sortRooms } from "../../lib/rooms";
import { useToast } from "../../lib/toast";
import { ROOM_TYPE_LABELS, type Room } from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import { Alert, CardListSkeleton } from "../ui/Feedback";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Input, Select } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";
import { RoomDetailsDrawer } from "./RoomDetails";
import { RoomCover } from "./RoomPhotos";

// O 3D (three.js) só carrega quando alguém abre o mapa.
const Campus3D = lazy(() => import("./Campus3D"));

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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [view, setView] = useState<"3d" | "andares">("3d");
  const [campus, setCampus] = useState<CampusMapData | null>(null);
  const [floor3d, setFloor3d] = useState("1º andar");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string>("");
  const [placing, setPlacing] = useState(false);
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
    api<CampusMapData>("/campus-map")
      .then(setCampus)
      .catch(() => setCampus({ buildings: [], rooms: [] }));
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

  const layout = useMemo(() => (rooms && campus ? placeRooms(rooms, campus) : null), [rooms, campus]);
  const states = useMemo(() => new Map((status?.rooms ?? []).map((r) => [r.id, r.state])), [status]);
  const floors3d = useMemo(() => sortFloors((layout?.placements ?? []).map((p) => p.floor)), [layout]);
  const selected = layout?.placements.find((p) => p.room.id === selectedId) ?? null;
  const directions = useMemo(() => (selected ? directionsTo(selected) : null), [selected]);
  const selectedStatus = selected ? byId.get(selected.room.id) : undefined;
  const choose = (id: string | null) => {
    setSelectedId(id);
    const p = layout?.placements.find((x) => x.room.id === id);
    if (p && floor3d !== "ALL") setFloor3d(p.floor);
  };
  const placingRoom = layout?.placements.find((p) => p.room.id === placingId) ?? null;
  async function place(x: number, y: number) {
    if (!placingRoom) return;
    try {
      await api(`/campus-map/rooms/${placingRoom.room.id}`, { method: "PATCH", body: JSON.stringify({ mapX: x, mapY: y }) });
      setCampus((c) => (c ? { ...c, rooms: [...c.rooms.filter((r) => r.id !== placingRoom.room.id), { id: placingRoom.room.id, mapX: x, mapY: y }] } : c));
      toast.success("Sala posicionada", placingRoom.room.name);
      setPlacing(false);
    } catch (e) {
      toast.error("Não foi possível salvar.", e instanceof ApiError ? e.message : "");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Mapa das salas" description="A faculdade em 3D: onde fica cada sala, como chegar e se está livre no dia e no horário escolhidos." />
      <SegmentedControl
        label="Visão"
        value={view}
        onChange={setView}
        options={[
          { value: "3d", label: "Mapa 3D", icon: CubeIcon },
          { value: "andares", label: "Por andar", icon: RowsIcon },
        ]}
      />

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

      {view === "3d" ? (
        !layout ? (
          <CardListSkeleton />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,14rem)_minmax(0,22rem)]">
              <Select label="Andar" value={floor3d} onChange={(e) => setFloor3d(e.target.value)}>
                <option value="ALL">Todos os andares (3D)</option>
                {floors3d.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
              <Select label="Procurar sala" value={selectedId ?? ""} onChange={(e) => choose(e.target.value || null)}>
                <option value="">Escolha uma sala</option>
                {layout.placements
                  .slice()
                  .sort((a, b) => a.room.name.localeCompare(b.room.name, "pt-BR", { numeric: true }))
                  .map((p) => (
                    <option key={p.room.id} value={p.room.id}>
                      {p.room.name} · {p.room.building}, {p.floor}
                    </option>
                  ))}
              </Select>
            </div>
            {user?.role === "ADMIN" && (
              <details className="rounded-xl border border-border bg-surface p-3 text-sm">
                <summary className="cursor-pointer font-medium">Posicionar salas no mapa (SAD)</summary>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Select label="Sala" value={placingId} onChange={(e) => setPlacingId(e.target.value)} containerClassName="min-w-64 flex-1">
                    <option value="">Escolha</option>
                    {layout.placements
                      .slice()
                      .sort((a, b) => Number(b.auto) - Number(a.auto) || a.room.name.localeCompare(b.room.name, "pt-BR", { numeric: true }))
                      .map((p) => (
                        <option key={p.room.id} value={p.room.id}>
                          {p.auto ? "⚠ " : ""}
                          {p.room.name} · {p.room.building}, {p.floor}
                        </option>
                      ))}
                  </Select>
                  <Button
                    icon={MapPinIcon}
                    variant={placing ? "primary" : "secondary"}
                    disabled={!placingRoom}
                    onClick={() => {
                      if (!placingRoom) return;
                      setFloor3d(placingRoom.floor);
                      setPlacing((v) => !v);
                    }}
                  >
                    {placing ? "Clique no piso…" : "Posicionar"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted">⚠ = posição aproximada (ainda não marcada). Escolha a sala, clique em Posicionar e depois no lugar dela no piso do andar.</p>
              </details>
            )}
            {placing && placingRoom && <Alert tone="info">Clique no piso do {placingRoom.floor} do {placingRoom.building.name} onde fica a {placingRoom.room.name}.</Alert>}
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="h-[68vh] min-h-[420px] overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-primary-soft to-surface-muted">
                <Suspense fallback={<p className="p-6 text-sm text-muted">Carregando o mapa 3D…</p>}>
                  <Campus3D
                    buildings={layout.buildings}
                    placements={layout.placements}
                    states={states}
                    floor={floor3d}
                    selectedId={selectedId}
                    route={directions?.path ?? null}
                    routeBuilding={selected?.building.name ?? null}
                    onSelect={choose}
                    placing={placing && placingRoom ? { roomId: placingRoom.room.id, building: placingRoom.building.name, floor: placingRoom.floor } : null}
                    onPlace={(x, y) => void place(x, y)}
                  />
                </Suspense>
              </div>
              {selected ? (
                <Card className="overflow-hidden">
                  <div className="relative">
                    <RoomCover room={selected.room} className="aspect-[16/9] w-full" />
                    <IconButton icon={XIcon} label="Fechar" onClick={() => setSelectedId(null)} variant="secondary" className="absolute top-2 right-2" />
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <h2 className="text-lg font-semibold">{selected.room.name}</h2>
                      <p className="text-sm text-muted">
                        {selected.room.building} · {selected.floor} · {selected.room.capacity ? `${selected.room.capacity} lugares` : "sem limite cadastrado"}
                      </p>
                    </div>
                    {selectedStatus && (
                      <p className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-sm font-semibold", STATE[selectedStatus.state].tile)}>
                        {STATE[selectedStatus.state].label} das {start} às {end}
                      </p>
                    )}
                    {selectedStatus && selectedStatus.busy.length > 0 && (
                      <p className="text-xs text-muted">Ocupada no dia: {selectedStatus.busy.map((b) => `${b.start}–${b.end}`).join(", ")}</p>
                    )}
                    {directions && (
                      <div className="rounded-xl bg-surface-muted p-3">
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                          <NavigationArrowIcon size={16} className="text-warning-foreground" aria-hidden /> Como chegar
                        </h3>
                        <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm">
                          {directions.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                        {directions.path.length > 1 && <p className="mt-1.5 text-xs text-muted">O caminho aparece em laranja no mapa.</p>}
                      </div>
                    )}
                    {selected.auto && (
                      <p className="flex items-start gap-1.5 text-xs text-muted">
                        <InfoIcon size={14} className="mt-0.5 shrink-0" aria-hidden /> Posição aproximada no andar: a planta deste espaço ainda não foi marcada.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setOpen(selected.room)}>
                        Detalhes e calendário
                      </Button>
                      {(user?.role === "ADMIN" || user?.role === "USER") && (
                        <Button
                          icon={CalendarPlusIcon}
                          onClick={() => navigate(user.role === "ADMIN" ? `/admin/reservar?sala=${selected.room.id}&data=${date}&voltar=/mapa` : "/reservar")}
                        >
                          Reservar
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="space-y-2 p-4 text-sm text-muted">
                  <p className="font-medium text-foreground">Escolha uma sala</p>
                  <p>Clique numa sala no mapa (ou procure acima) para ver a foto, a capacidade, se está livre e como chegar.</p>
                  <p>Cores: verde livre, vermelho ocupada, cinza bloqueada no horário escolhido. Portas vermelhas: os acessos; laranja: escadas; azul: elevadores.</p>
                </Card>
              )}
            </div>
          </div>
        )
      ) : rooms === null ? (
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
