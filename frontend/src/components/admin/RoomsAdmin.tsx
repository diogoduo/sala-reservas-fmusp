import {
  CheckCircleIcon,
  DoorOpenIcon,
  FloppyDiskIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PauseCircleIcon,
  PencilSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  RulerIcon,
  TrashIcon,
  UsersIcon,
  WrenchIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError } from "../../lib/api";
import { useConfirm } from "../../lib/confirm";
import { plural } from "../../lib/format";
import { sortRooms } from "../../lib/rooms";
import { useToast } from "../../lib/toast";
import { ROOM_STATUS_LABELS, ROOM_TYPE_LABELS } from "../../lib/types";
import type { Resource, Room, RoomStatus } from "../../lib/types";
import { RoomCover } from "../rooms/RoomPhotos";
import { RoomResourceChips } from "../solicitante/RoomSearch";
import { Badge, type Tone } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Input } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card, PageHeader, StatCard } from "../ui/Surface";
import { RoomForm, type RoomFormValues } from "./RoomForm";

const STATUS_STYLE: Record<RoomStatus, { tone: Tone; icon: Icon }> = {
  ACTIVE: { tone: "success", icon: CheckCircleIcon },
  MAINTENANCE: { tone: "warning", icon: WrenchIcon },
  INACTIVE: { tone: "neutral", icon: ProhibitIcon },
};

const FORM_ID = "formulario-sala";

type Filter = "ALL" | RoomStatus;

export function RoomsAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useSearchParams();

  async function load() {
    try {
      const [{ rooms: roomList }, { resources: resourceList }] = await Promise.all([
        api<{ rooms: Room[] }>("/rooms"),
        api<{ resources: Resource[] }>("/resources"),
      ]);
      setRooms(roomList);
      setResources(resourceList);
    } catch (e) {
      toast.error("Não foi possível carregar as salas.", e instanceof Error ? e.message : undefined);
      setRooms([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Editar" no inventário (Recursos) abre direto o painel da sala: /admin/salas?editar=<id>
  const editId = params.get("editar");
  useEffect(() => {
    if (!editId || !rooms) return;
    const room = rooms.find((r) => r.id === editId);
    if (room) setEditing(room);
    setParams({}, { replace: true });
  }, [editId, rooms, setParams]);

  async function submit(values: RoomFormValues) {
    setSaving(true);
    try {
      const body = JSON.stringify(values);
      if (editing && editing !== "new") {
        await api(`/rooms/${editing.id}`, { method: "PATCH", body });
        toast.success("Sala atualizada", values.name);
      } else {
        await api("/rooms", { method: "POST", body });
        toast.success("Sala criada", values.name);
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error("Não foi possível salvar a sala.", e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function remove(room: Room) {
    const ok = await confirm({
      tone: "danger",
      title: `Excluir "${room.name}"?`,
      description: "A exclusão é definitiva. Se a sala já tiver reservas, prefira marcá-la como Inativa.",
      confirmLabel: "Excluir sala",
    });
    if (!ok) return;
    try {
      await api(`/rooms/${room.id}`, { method: "DELETE" });
      toast.success("Sala excluída", room.name);
      await load();
    } catch (e) {
      toast.error("Não foi possível excluir.", e instanceof ApiError ? e.message : undefined);
    }
  }

  const all = rooms ?? [];
  const buildings = [...new Set(all.map((r) => r.building))].sort();
  const needle = query.trim().toLowerCase();
  // Inativas por último: são as que saíram de uso (ex.: as salas fictícias do seed).
  const visible = sortRooms(all).sort((a, b) => Number(a.status === "INACTIVE") - Number(b.status === "INACTIVE")).filter(
    (room) =>
      (filter === "ALL" || room.status === filter) &&
      (!needle || `${room.name} ${room.building} ${room.floor}`.toLowerCase().includes(needle)),
  );
  const active = all.filter((r) => r.status === "ACTIVE");
  const editingRoom = editing === "new" ? null : editing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salas"
        description="Cadastre os espaços, a capacidade e os recursos de cada um."
        actions={
          <Button icon={PlusIcon} onClick={() => setEditing("new")}>
            Nova sala
          </Button>
        }
      />

      {rooms !== null && all.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Salas cadastradas" value={all.length} icon={DoorOpenIcon} />
          <StatCard label="Ativas" value={active.length} icon={CheckCircleIcon} tone="success" />
          <StatCard label="Em manutenção" value={all.filter((r) => r.status === "MAINTENANCE").length} icon={PauseCircleIcon} tone="warning" />
          <StatCard label="Lugares nas ativas" value={active.reduce((sum, r) => sum + r.capacity, 0)} icon={UsersIcon} tone="info" />
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          label="Status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "ALL", label: "Todas", count: all.length },
            { value: "ACTIVE", label: "Ativas", count: active.length },
            { value: "MAINTENANCE", label: "Manutenção", count: all.filter((r) => r.status === "MAINTENANCE").length },
            { value: "INACTIVE", label: "Inativas", count: all.filter((r) => r.status === "INACTIVE").length },
          ]}
        />
        <div className="relative lg:w-72">
          <Input type="search" aria-label="Buscar sala" placeholder="Buscar por nome ou prédio" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
      </div>

      {rooms === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-60 rounded-2xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={DoorOpenIcon}
          title={all.length === 0 ? "Nenhuma sala cadastrada" : "Nenhuma sala com esse filtro"}
          description={all.length === 0 ? "Cadastre o primeiro espaço para começar a receber solicitações." : undefined}
          action={
            all.length === 0 && (
              <Button icon={PlusIcon} onClick={() => setEditing("new")}>
                Nova sala
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((room, index) => {
            const { tone, icon: StatusIcon } = STATUS_STYLE[room.status];
            return (
              <li key={room.id} className="min-w-0 animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
                <Card className="flex h-full flex-col overflow-hidden">
                  <RoomCover room={room} className={room.status === "ACTIVE" ? undefined : "opacity-70 grayscale"} />
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold break-words">{room.name}</h2>
                        <p className="text-sm text-muted">{ROOM_TYPE_LABELS[room.roomType]}</p>
                      </div>
                      <Badge tone={tone} icon={StatusIcon}>
                        {ROOM_STATUS_LABELS[room.status]}
                      </Badge>
                    </div>
                    <div className="mt-4 space-y-1.5 text-sm text-muted">
                      <p className="flex items-center gap-2">
                        <MapPinIcon size={16} aria-hidden /> {room.building} · {room.floor}
                      </p>
                      <p className="flex items-center gap-2">
                        <UsersIcon size={16} aria-hidden /> {plural(room.capacity, "lugar", "lugares")}
                        {room.extraSeats ? ` + ${plural(room.extraSeats, "extra", "extras")}` : ""}
                      </p>
                      {room.dimensions && (
                        <p className="flex items-center gap-2">
                          <RulerIcon size={16} aria-hidden /> {room.dimensions}
                        </p>
                      )}
                    </div>
                    {room.resources.some((r) => r.resource.requestable) && (
                      <div className="mt-4">
                        <RoomResourceChips room={room} />
                      </div>
                    )}
                    <div className="mt-auto flex gap-2 pt-5">
                      <Button variant="secondary" size="sm" icon={PencilSimpleIcon} className="flex-1" onClick={() => setEditing(room)}>
                        Editar
                      </Button>
                      <IconButton icon={TrashIcon} label={`Excluir ${room.name}`} variant="danger-soft" size="sm" onClick={() => void remove(room)} />
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {editing !== null && (
        <Dialog
          open
          variant="drawer"
          onClose={() => setEditing(null)}
          title={editingRoom ? `Editar ${editingRoom.name}` : "Nova sala"}
          description={editingRoom ? `${editingRoom.building}, ${editingRoom.floor}` : "Preencha os dados do espaço."}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" form={FORM_ID} icon={FloppyDiskIcon} loading={saving}>
                {editingRoom ? "Salvar alterações" : "Criar sala"}
              </Button>
            </>
          }
        >
          <RoomForm
            room={editingRoom}
            resources={resources}
            buildings={buildings}
            formId={FORM_ID}
            onSubmit={(values) => void submit(values)}
            onPhotosChange={() => void load()}
          />
        </Dialog>
      )}
    </div>
  );
}
