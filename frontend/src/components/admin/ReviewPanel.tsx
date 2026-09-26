import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { formatDateTimeRange, formatShortDate } from "../../lib/format";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { AdminReservation, Resource, ReviewScope, RoomOption } from "../../lib/types";

const ALL = "all";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Props {
  /** Ocorrências pendentes de uma mesma solicitação: uma se for avulsa, várias se for série. */
  group: AdminReservation[];
  resources: Resource[];
  onDone: (message: string) => void;
  onCancel: () => void;
}

/**
 * Análise de uma solicitação pendente: lista as salas ativas já ordenadas da
 * mais para a menos adequada (GET .../room-options) e permite aprovar alocando
 * uma delas, ou rejeitar com justificativa. Numa série, dá para decidir todas
 * as datas de uma vez ou uma data específica.
 */
export function ReviewPanel({ group, resources, onDone, onCancel }: Props) {
  const [target, setTarget] = useState<string>(group.length > 1 ? ALL : group[0]!.id);
  const [options, setOptions] = useState<RoomOption[] | null>(null);
  const [occurrenceCount, setOccurrenceCount] = useState(0);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const scope: ReviewScope = target === ALL ? "series" : "single";
  const reservationId = target === ALL ? group[0]!.id : target;
  const attendees = group[0]!.expectedAttendees;

  useEffect(() => {
    setOptions(null);
    setSelectedRoomId(null);
    api<{ occurrences: unknown[]; options: RoomOption[] }>(`/admin/reservations/${reservationId}/room-options?scope=${scope}`)
      .then((res) => {
        setOptions(res.options);
        setOccurrenceCount(res.occurrences.length);
        // A API já devolve a mais adequada primeiro; só pré-seleciona se ela for utilizável.
        const best = res.options[0];
        if (best && best.fitsCapacity && best.conflictingDates.length < res.occurrences.length) {
          setSelectedRoomId(best.room.id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [reservationId, scope, reloadKey]);

  const selected = options?.find((o) => o.room.id === selectedRoomId) ?? null;
  const partial = selected !== null && selected.conflictingDates.length > 0;
  const freeCount = selected ? occurrenceCount - selected.conflictingDates.length : 0;
  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? "recurso removido";

  async function approve() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ approved: AdminReservation[]; skipped: unknown[] }>(`/admin/reservations/${reservationId}/approve`, {
        method: "POST",
        body: JSON.stringify({ roomId: selected.room.id, scope, skipConflicting: partial }),
      });
      onDone(
        `${plural(res.approved.length, "data aprovada", "datas aprovadas")} em ${selected.room.name}` +
          (res.skipped.length > 0 ? `; ${plural(res.skipped.length, "data continua pendente", "datas continuam pendentes")}.` : "."),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao aprovar.");
      // Conflito ou revisão simultânea: a ocupação das salas mudou, então recarrega as opções.
      if (e instanceof ApiError && e.status === 409) setReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!confirm(`Rejeitar ${plural(occurrenceCount, "data", "datas")}? O solicitante verá a justificativa.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ rejectedIds: string[] }>(`/admin/reservations/${reservationId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason, scope }),
      });
      onDone(`${plural(res.rejectedIds.length, "data rejeitada", "datas rejeitadas")}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao rejeitar.");
    } finally {
      setBusy(false);
    }
  }

  let approveLabel = "Aprovar";
  if (selected) {
    approveLabel =
      occurrenceCount > 1
        ? `Aprovar ${plural(freeCount, "data", "datas")} em ${selected.room.name}`
        : `Aprovar em ${selected.room.name}`;
  }

  return (
    <div className="mt-3 space-y-4 rounded-lg bg-slate-50 p-4">
      {group.length > 1 && (
        <div>
          <label className="block text-sm font-medium text-slate-700">Aplicar a</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value={ALL}>Todas as datas pendentes da série</option>
            {group.map((r) => (
              <option key={r.id} value={r.id}>
                Só {formatDateTimeRange(r.startTime, r.endTime)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium text-slate-700">Sala (da mais para a menos adequada)</h4>
        {!options && !error && <p className="mt-2 text-sm text-slate-500">Buscando salas…</p>}
        {options?.length === 0 && <p className="mt-2 text-sm text-slate-500">Nenhuma sala ativa cadastrada.</p>}
        <ul className="mt-2 space-y-2">
          {options?.map((option) => {
            const conflicts = option.conflictingDates.length;
            const allBusy = conflicts >= occurrenceCount;
            const disabled = !option.fitsCapacity || allBusy;
            return (
              <li key={option.room.id}>
                <label
                  className={`flex gap-3 rounded-md border bg-white p-3 text-sm ${
                    selectedRoomId === option.room.id ? "border-slate-900" : "border-slate-200"
                  } ${disabled ? "opacity-50" : "cursor-pointer"}`}
                >
                  <input
                    type="radio"
                    name={`room-${group[0]!.id}`}
                    disabled={disabled}
                    checked={selectedRoomId === option.room.id}
                    onChange={() => setSelectedRoomId(option.room.id)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">
                      {option.room.name}{" "}
                      <span className="font-normal text-slate-500">
                        — {option.room.building}, {option.room.floor} · {ROOM_TYPE_LABELS[option.room.roomType]} · cap.{" "}
                        {option.room.capacity}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {option.fitsCapacity ? (
                        <span className="text-emerald-700">✓ comporta {attendees} pessoas</span>
                      ) : (
                        <span className="text-red-600">
                          ✗ comporta só {option.room.capacity} (pedido: {attendees})
                        </span>
                      )}
                      {conflicts === 0 && (
                        <span className="text-emerald-700">✓ livre {occurrenceCount > 1 ? "em todas as datas" : "no horário"}</span>
                      )}
                      {conflicts > 0 && occurrenceCount === 1 && <span className="text-red-600">✗ ocupada no horário</span>}
                      {conflicts > 0 && occurrenceCount > 1 && (
                        <span className={allBusy ? "text-red-600" : "text-amber-700"}>
                          {allBusy ? "✗" : "⚠"} ocupada em {conflicts} de {occurrenceCount} datas (
                          {option.conflictingDates.map(formatShortDate).join(", ")})
                        </span>
                      )}
                      {option.missingResources.map((m) => (
                        <span key={m.resourceId} className="text-amber-700">
                          ⚠{" "}
                          {m.available === 0
                            ? `sem ${resourceName(m.resourceId)}`
                            : `${resourceName(m.resourceId)}: só ${m.available} (pedido: ${m.requested})`}
                        </span>
                      ))}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {partial && (
        <p className="text-sm text-amber-800">
          {plural(selected.conflictingDates.length, "data já está ocupada", "datas já estão ocupadas")} nesta sala e vai
          continuar pendente — dá para alocá-la em outra sala depois.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => void approve()}
          disabled={busy || !selected}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {approveLabel}
        </button>
        <button onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
          Fechar
        </button>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <label className="block text-sm font-medium text-slate-700">Justificativa da rejeição</label>
        <textarea
          rows={2}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Obrigatória — o solicitante verá este texto."
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          onClick={() => void reject()}
          disabled={busy || !rejectReason.trim() || occurrenceCount === 0}
          className="mt-2 rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
        >
          {occurrenceCount > 1 ? `Rejeitar ${occurrenceCount} datas` : "Rejeitar"}
        </button>
      </div>
    </div>
  );
}
