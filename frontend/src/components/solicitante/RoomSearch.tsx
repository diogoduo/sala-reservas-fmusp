import { CalendarBlankIcon, FunnelSimpleXIcon, MagnifyingGlassIcon, MapPinIcon, UsersIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { plural } from "../../lib/format";
import { resourceIcon, ROOM_TYPE_ICONS } from "../../lib/icons";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { Room, RoomType } from "../../lib/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { Card, IconTile, PageHeader } from "../ui/Surface";
import { AvailabilityCalendar } from "./AvailabilityCalendar";

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];
const MAX_CHIPS = 4;

/** Recursos que o solicitante pode pedir; a infraestrutura (nobreak, splitter…) fica de fora. */
export function RoomResourceChips({ room }: { room: Room }) {
  const visible = room.resources.filter((r) => r.resource.requestable);
  const shown = visible.slice(0, MAX_CHIPS);
  const hidden = visible.slice(MAX_CHIPS);
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

// Catálogo de consulta: ajuda o solicitante a saber o que existe (tipos,
// capacidades, recursos, agenda) antes de descrever o pedido — mas não escolhe
// a sala aqui. A alocação é sempre feita pelo Admin ao aprovar (Fase 6).
export function RoomSearch() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [query, setQuery] = useState("");
  const [roomType, setRoomType] = useState<RoomType | "">("");
  const [minCapacity, setMinCapacity] = useState("");
  const [building, setBuilding] = useState("");
  const [agendaRoom, setAgendaRoom] = useState<Room | null>(null);

  useEffect(() => {
    api<{ rooms: Room[] }>("/rooms?status=ACTIVE")
      .then((res) => setRooms(res.rooms))
      .catch(() => setRooms([]));
  }, []);

  const buildings = useMemo(() => [...new Set((rooms ?? []).map((r) => r.building))].sort(), [rooms]);

  // Filtro no próprio navegador: o catálogo é pequeno e a resposta fica instantânea.
  const filtered = (rooms ?? []).filter((room) => {
    const text = `${room.name} ${room.building} ${room.floor}`.toLowerCase();
    return (
      (!query || text.includes(query.toLowerCase())) &&
      (!roomType || room.roomType === roomType) &&
      (!minCapacity || room.capacity >= Number(minCapacity)) &&
      (!building || room.building === building)
    );
  });
  const hasFilters = Boolean(query || roomType || minCapacity || building);

  function clearFilters() {
    setQuery("");
    setRoomType("");
    setMinCapacity("");
    setBuilding("");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Consultar salas" description="Conheça os espaços e veja a agenda de cada um antes de fazer seu pedido." />

      <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
        <div className="relative">
          <Input label="Buscar" type="search" placeholder="Nome, prédio ou andar" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute bottom-3.5 left-3 text-muted" />
        </div>
        <Select label="Tipo de espaço" value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType | "")}>
          <option value="">Todos os tipos</option>
          {ROOM_TYPES.map((t) => (
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
            <Skeleton key={i} className="h-56 rounded-2xl" />
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
          {filtered.map((room, index) => (
            <li key={room.id} className="min-w-0 animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
              <Card className="flex h-full flex-col p-5 transition-shadow duration-200 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <IconTile icon={ROOM_TYPE_ICONS[room.roomType]} />
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold break-words">{room.name}</h2>
                    <p className="text-sm text-muted">{ROOM_TYPE_LABELS[room.roomType]}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-1.5 text-sm">
                  <p className="flex items-center gap-2 text-muted">
                    <MapPinIcon size={16} aria-hidden /> {room.building} · {room.floor}
                  </p>
                  <p className="flex items-center gap-2 text-muted">
                    <UsersIcon size={16} aria-hidden /> até <strong className="text-foreground tabular-nums">{room.capacity}</strong> pessoas
                  </p>
                </div>
                {room.resources.length > 0 && (
                  <div className="mt-4">
                    <RoomResourceChips room={room} />
                  </div>
                )}
                <div className="mt-auto pt-5">
                  <Button variant="secondary" icon={CalendarBlankIcon} className="w-full" onClick={() => setAgendaRoom(room)}>
                    Ver agenda
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {agendaRoom && (
        <Dialog
          open
          variant="drawer"
          onClose={() => setAgendaRoom(null)}
          title={agendaRoom.name}
          description={`${ROOM_TYPE_LABELS[agendaRoom.roomType]} · ${agendaRoom.building}, ${agendaRoom.floor} · até ${agendaRoom.capacity} pessoas`}
        >
          <AvailabilityCalendar roomId={agendaRoom.id} />
        </Dialog>
      )}
    </div>
  );
}
