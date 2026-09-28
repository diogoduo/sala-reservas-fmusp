import { ArrowRightIcon, FunnelSimpleXIcon, HandHeartIcon, MagnifyingGlassIcon, MapPinIcon, RulerIcon, UsersIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { plural } from "../../lib/format";
import { resourceIcon, ROOM_TYPE_ICONS } from "../../lib/icons";
import { sortRooms } from "../../lib/rooms";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { Room, RoomType } from "../../lib/types";
import { RoomDetailsDrawer } from "../rooms/RoomDetails";
import { RoomFeatures } from "../rooms/RoomFeatures";
import { RoomCover } from "../rooms/RoomPhotos";
import { Button } from "../ui/Button";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];

/** Recursos que o solicitante pode pedir; a infraestrutura (nobreak, splitter…) fica de fora. */
export function RoomResourceChips({ room, max = 4 }: { room: Room; max?: number }) {
  const visible = room.resources.filter((r) => r.resource.requestable);
  const shown = visible.slice(0, max);
  const hidden = visible.slice(max);
  if (visible.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((r) => {
        const ResourceIcon = resourceIcon(r.resource.name);
        return (
          <li key={r.resourceId} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-xs text-muted">
            <ResourceIcon size={14} aria-hidden />
            {r.resource.name}
            {r.quantity > 1 && <span className="tabular-nums">×{r.quantity}</span>}
          </li>
        );
      })}
      {hidden.length > 0 && (
        <li
          className="inline-flex items-center rounded-md bg-surface-muted px-2 py-1 text-xs text-muted"
          title={hidden.map((r) => r.resource.name).join(", ")}
        >
          +{hidden.length}
          <span className="sr-only">: {hidden.map((r) => r.resource.name).join(", ")}</span>
        </li>
      )}
    </ul>
  );
}

// Catálogo de consulta: ajuda o solicitante a saber o que existe (fotos, tipos,
// capacidades, recursos, agenda) antes de descrever o pedido — mas não escolhe
// a sala aqui. A alocação é sempre feita pelo Admin ao aprovar (Fase 6).
export function RoomSearch() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [query, setQuery] = useState("");
  const [roomType, setRoomType] = useState<RoomType | "">("");
  const [minCapacity, setMinCapacity] = useState("");
  const [building, setBuilding] = useState("");
  const [specialOnly, setSpecialOnly] = useState(false);
  const [openRoom, setOpenRoom] = useState<Room | null>(null);

  useEffect(() => {
    api<{ rooms: Room[] }>("/rooms?status=ACTIVE")
      .then((res) => setRooms(sortRooms(res.rooms)))
      .catch(() => setRooms([]));
  }, []);

  const buildings = useMemo(() => [...new Set((rooms ?? []).map((r) => r.building))].sort(), [rooms]);
  // Só os tipos que existem entre as salas ativas.
  const roomTypes = useMemo(() => ROOM_TYPES.filter((t) => (rooms ?? []).some((r) => r.roomType === t)), [rooms]);

  // Filtro no próprio navegador: o catálogo é pequeno e a resposta fica instantânea.
  const filtered = (rooms ?? []).filter((room) => {
    const text = `${room.name} ${room.building} ${room.floor}`.toLowerCase();
    return (
      (!query || text.includes(query.toLowerCase())) &&
      (!roomType || room.roomType === roomType) &&
      (!minCapacity || (room.capacity ?? 0) >= Number(minCapacity)) &&
      (!building || room.building === building) &&
      (!specialOnly || room.specialNeeds)
    );
  });
  const hasFilters = Boolean(query || roomType || minCapacity || building || specialOnly);

  function clearFilters() {
    setQuery("");
    setRoomType("");
    setMinCapacity("");
    setBuilding("");
    setSpecialOnly(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Consultar salas" description="Veja as fotos, a capacidade e a agenda de cada espaço antes de fazer seu pedido." />

      <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
        <div className="relative">
          <Input label="Buscar" type="search" placeholder="Nome, número ou prédio" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute bottom-3.5 left-3 text-muted" />
        </div>
        <Select label="Tipo de espaço" value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType | "")}>
          <option value="">Todos os tipos</option>
          {roomTypes.map((t) => (
            <option key={t} value={t}>
              {ROOM_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Input label="Capacidade mínima" type="number" inputMode="numeric" min={1} placeholder="Ex.: 40" value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} />
        <Select label="Prédio" value={building} onChange={(e) => setBuilding(e.target.value)}>
          <option value="">Todos os prédios</option>
          {buildings.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
        {(rooms ?? []).some((room) => room.specialNeeds) && (
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-border-strong px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground has-[:checked]:border-info-foreground/40 has-[:checked]:bg-info-soft has-[:checked]:text-info-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring sm:col-span-2 lg:col-span-4">
            <input type="checkbox" className="sr-only" checked={specialOnly} onChange={(e) => setSpecialOnly(e.target.checked)} />
            <HandHeartIcon size={18} aria-hidden />
            Só salas com atendimento especial
          </label>
        )}
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-live="polite">
          {rooms === null ? "Carregando salas…" : plural(filtered.length, "sala encontrada", "salas encontradas")}
        </p>
        {hasFilters && (
          <Button variant="ghost" size="sm" icon={FunnelSimpleXIcon} onClick={clearFilters}>
            Limpar filtros
          </Button>
        )}
      </div>

      {rooms === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-96 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={MagnifyingGlassIcon}
          title="Nenhuma sala com esses filtros"
          description="Tente uma capacidade menor ou outro tipo de espaço."
          action={hasFilters && <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((room, index) => {
            const TypeIcon = ROOM_TYPE_ICONS[room.roomType];
            return (
              <li key={room.id} className="min-w-0 animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
                <Card className="flex h-full flex-col overflow-hidden transition-shadow duration-200 hover:shadow-md">
                  <RoomCover room={room} />
                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="text-base font-semibold break-words">{room.name}</h2>
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <TypeIcon size={16} aria-hidden /> {ROOM_TYPE_LABELS[room.roomType]}
                    </p>
                    <div className="mt-3 space-y-1.5 text-sm text-muted">
                      <p className="flex items-center gap-2">
                        <MapPinIcon size={16} aria-hidden /> {room.building} · {room.floor}
                      </p>
                      <p className="flex items-center gap-2">
                        <UsersIcon size={16} aria-hidden />
                        <span>
                          até <strong className="text-foreground tabular-nums">{room.capacity}</strong> pessoas
                          {room.extraSeats ? <span className="text-muted"> (+{room.extraSeats} cadeiras extras)</span> : null}
                        </span>
                      </p>
                      {room.dimensions && (
                        <p className="flex items-center gap-2">
                          <RulerIcon size={16} aria-hidden /> {room.dimensions}
                        </p>
                      )}
                    </div>
                    <RoomFeatures room={room} compact className="mt-4" />
                    <div className="mt-1.5">
                      <RoomResourceChips room={room} />
                    </div>
                    <div className="mt-auto pt-5">
                      <Button variant="secondary" iconRight={ArrowRightIcon} className="w-full" onClick={() => setOpenRoom(room)}>
                        Ver sala e agenda
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {openRoom && <RoomDetailsDrawer room={openRoom} onClose={() => setOpenRoom(null)} />}
    </div>
  );
}
