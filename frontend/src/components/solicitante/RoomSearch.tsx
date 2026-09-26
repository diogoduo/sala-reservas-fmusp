import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { Room, RoomType } from "../../lib/types";
import { AvailabilityCalendar } from "./AvailabilityCalendar";

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];

// Catálogo de consulta: ajuda o solicitante a saber o que existe (tipos,
// capacidades, recursos) antes de descrever o pedido — mas não escolhe a sala
// aqui. A alocação é sempre feita pelo Admin ao aprovar (Fase 6).
export function RoomSearch() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [roomType, setRoomType] = useState<RoomType | "">("");
  const [minCapacity, setMinCapacity] = useState("");
  const [building, setBuilding] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    const params = new URLSearchParams({ status: "ACTIVE" });
    if (roomType) params.set("roomType", roomType);
    if (minCapacity) params.set("minCapacity", minCapacity);
    if (building) params.set("building", building);
    try {
      const { rooms: list } = await api<{ rooms: Room[] }>(`/rooms?${params.toString()}`);
      setRooms(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700">Tipo de espaço</label>
          <select
            value={roomType}
            onChange={(e) => setRoomType(e.target.value as RoomType | "")}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Qualquer</option>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ROOM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Capacidade mínima</label>
          <input
            type="number"
            min={1}
            value={minCapacity}
            onChange={(e) => setMinCapacity(e.target.value)}
            className="mt-1 w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Prédio</label>
          <input
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          Buscar
        </button>
      </form>

      <ul className="mt-4 space-y-3">
        {loading && <li className="text-sm text-slate-500">Carregando…</li>}
        {!loading && rooms.length === 0 && <li className="text-sm text-slate-500">Nenhuma sala ativa encontrada com esses filtros.</li>}
        {rooms.map((room) => (
          <li key={room.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">
                  {room.name} <span className="font-normal text-slate-500">— {room.building}, {room.floor}</span>
                </div>
                <div className="text-sm text-slate-500">
                  {ROOM_TYPE_LABELS[room.roomType]} · Capacidade {room.capacity}
                  {room.resources.length > 0 && <> · {room.resources.map((r) => r.resource.name).join(", ")}</>}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setExpandedId(expandedId === room.id ? null : room.id)}
                  className="text-sm text-slate-600 hover:underline"
                >
                  {expandedId === room.id ? "Ocultar agenda" : "Ver agenda"}
                </button>
              </div>
            </div>
            {expandedId === room.id && (
              <div className="mt-3">
                <AvailabilityCalendar roomId={room.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
