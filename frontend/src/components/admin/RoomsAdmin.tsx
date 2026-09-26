import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { ROOM_STATUS_LABELS, ROOM_TYPE_LABELS } from "../../lib/types";
import type { Resource, Room } from "../../lib/types";
import { RoomForm, type RoomFormValues } from "./RoomForm";

export function RoomsAdmin() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Room | null | "new">(null);

  async function load() {
    setLoading(true);
    try {
      const [{ rooms: roomList }, { resources: resourceList }] = await Promise.all([
        api<{ rooms: Room[] }>("/rooms"),
        api<{ resources: Resource[] }>("/resources"),
      ]);
      setRooms(roomList);
      setResources(resourceList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar salas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(values: RoomFormValues) {
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify(values);
      if (editing && editing !== "new") {
        await api(`/rooms/${editing.id}`, { method: "PATCH", body });
      } else {
        await api("/rooms", { method: "POST", body });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao salvar sala.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(room: Room) {
    if (!confirm(`Excluir a sala "${room.name}"? Se ela já tiver reservas vinculadas, prefira marcá-la como Inativa.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/rooms/${room.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao excluir sala.");
    } finally {
      setBusy(false);
    }
  }

  const formRoom = editing === "new" ? null : editing;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Salas cadastradas</h2>
        {editing === null && (
          <button onClick={() => setEditing("new")} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
            Nova sala
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {editing !== null && (
        <div className="mt-4">
          <RoomForm room={formRoom} resources={resources} busy={busy} onSubmit={submit} onCancel={() => setEditing(null)} />
        </div>
      )}

      <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
        {loading && <li className="p-4 text-sm text-slate-500">Carregando…</li>}
        {!loading && rooms.length === 0 && <li className="p-4 text-sm text-slate-500">Nenhuma sala cadastrada.</li>}
        {rooms.map((room) => (
          <li key={room.id} className="flex items-center justify-between p-3">
            <div>
              <div className="font-medium">
                {room.name} <span className="font-normal text-slate-500">— {room.building}, {room.floor}</span>
              </div>
              <div className="text-sm text-slate-500">
                {ROOM_TYPE_LABELS[room.roomType]} · Capacidade {room.capacity} ·{" "}
                <span
                  className={
                    room.status === "ACTIVE"
                      ? "text-emerald-600"
                      : room.status === "MAINTENANCE"
                        ? "text-amber-600"
                        : "text-slate-400"
                  }
                >
                  {ROOM_STATUS_LABELS[room.status]}
                </span>
                {room.resources.length > 0 && (
                  <> · {room.resources.map((r) => r.resource.name).join(", ")}</>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(room)} className="text-sm text-slate-600 hover:underline">
                Editar
              </button>
              <button onClick={() => void remove(room)} className="text-sm text-red-600 hover:underline">
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
