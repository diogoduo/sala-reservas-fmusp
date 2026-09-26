import { useEffect, useState } from "react";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { Resource, Room, RoomStatus, RoomType } from "../../lib/types";

export interface RoomFormValues {
  name: string;
  building: string;
  floor: string;
  capacity: number;
  roomType: RoomType;
  status: RoomStatus;
  resources: { resourceId: string; quantity: number }[];
}

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];

function emptyValues(): RoomFormValues {
  return { name: "", building: "", floor: "", capacity: 1, roomType: "CLASSROOM", status: "ACTIVE", resources: [] };
}

function fromRoom(room: Room): RoomFormValues {
  return {
    name: room.name,
    building: room.building,
    floor: room.floor,
    capacity: room.capacity,
    roomType: room.roomType,
    status: room.status,
    resources: room.resources.map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
  };
}

interface Props {
  room: Room | null; // null = criando uma sala nova
  resources: Resource[];
  busy: boolean;
  onSubmit: (values: RoomFormValues) => void;
  onCancel: () => void;
}

export function RoomForm({ room, resources, busy, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<RoomFormValues>(room ? fromRoom(room) : emptyValues());

  useEffect(() => {
    setValues(room ? fromRoom(room) : emptyValues());
  }, [room]);

  function toggleResource(resourceId: string, checked: boolean) {
    setValues((v) => ({
      ...v,
      resources: checked
        ? [...v.resources, { resourceId, quantity: 1 }]
        : v.resources.filter((r) => r.resourceId !== resourceId),
    }));
  }

  function setQuantity(resourceId: string, quantity: number) {
    setValues((v) => ({
      ...v,
      resources: v.resources.map((r) => (r.resourceId === resourceId ? { ...r, quantity } : r)),
    }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
      className="space-y-4 rounded-lg border border-slate-200 p-4"
    >
      <h3 className="font-medium">{room ? `Editar sala: ${room.name}` : "Nova sala"}</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700">Nome/Número da sala</label>
          <input
            required
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Capacidade</label>
          <input
            required
            type="number"
            min={1}
            value={values.capacity}
            onChange={(e) => setValues({ ...values, capacity: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Prédio/Bloco</label>
          <input
            required
            value={values.building}
            onChange={(e) => setValues({ ...values, building: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Andar/Pavimento</label>
          <input
            required
            value={values.floor}
            onChange={(e) => setValues({ ...values, floor: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Tipo de espaço</label>
          <select
            value={values.roomType}
            onChange={(e) => setValues({ ...values, roomType: e.target.value as RoomType })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ROOM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Status</label>
          <select
            value={values.status}
            onChange={(e) => setValues({ ...values, status: e.target.value as RoomStatus })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="ACTIVE">Ativa</option>
            <option value="MAINTENANCE">Em Manutenção</option>
            <option value="INACTIVE">Inativa</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">Recursos/Equipamentos disponíveis</label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {resources.map((r) => {
            const linked = values.resources.find((x) => x.resourceId === r.id);
            return (
              <div key={r.id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2">
                <input
                  type="checkbox"
                  checked={!!linked}
                  onChange={(e) => toggleResource(r.id, e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="flex-1 text-sm">{r.name}</span>
                {linked && (
                  <input
                    type="number"
                    min={1}
                    value={linked.quantity}
                    onChange={(e) => setQuantity(r.id, Number(e.target.value))}
                    className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                )}
              </div>
            );
          })}
          {resources.length === 0 && (
            <p className="col-span-2 text-sm text-slate-500">
              Nenhum recurso cadastrado ainda — cadastre na aba "Recursos" primeiro.
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button disabled={busy} type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
          {room ? "Salvar alterações" : "Criar sala"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
          Cancelar
        </button>
      </div>
    </form>
  );
}
