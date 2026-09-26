import { useEffect, useState } from "react";
import { ACTIVITY_TYPE_LABELS } from "../../lib/activities";
import { api } from "../../lib/api";
import { formatDateTimeRange } from "../../lib/format";
import { groupBySeries, isCancellable } from "../../lib/reservations";
import type { Reservation, ReviewScope } from "../../lib/types";
import { StatusBadge } from "../StatusBadge";

type View = "upcoming" | "past";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** O que o solicitante precisa saber sobre cada data, conforme o status. */
function situation(r: Reservation): string {
  const room = r.room ? `${r.room.name} — ${r.room.building}, ${r.room.floor}` : null;
  switch (r.status) {
    case "APPROVED":
      return `Sala: ${room}`;
    case "PENDING":
      // Com sala = pedido anterior à correção pós-Fase 5, quando o solicitante indicava a sala.
      return room ? `Sala indicada: ${room} · aguardando aprovação` : "Aguardando a Secretaria alocar uma sala";
    case "REJECTED":
      return `Justificativa: ${r.rejectionReason}`;
    case "CANCELLED":
      return r.cancelledAt ? `Cancelada em ${new Date(r.cancelledAt).toLocaleDateString("pt-BR")}` : "Cancelada";
  }
}

interface Props {
  onNewRequest: () => void;
}

// "Minhas Reservas" (Fase 8): acompanhar o status de cada data e cancelar o
// que ainda não começou — uma data ou todas as próximas de uma série.
export function MyReservations({ onNewRequest }: Props) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [view, setView] = useState<View>("upcoming");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { reservations: list } = await api<{ reservations: Reservation[] }>("/reservations");
      setReservations(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar suas reservas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function cancel(target: Reservation, scope: ReviewScope, count: number) {
    const question =
      scope === "series"
        ? `Cancelar as ${count} próximas datas desta série?`
        : `Cancelar a reserva de ${formatDateTimeRange(target.startTime, target.endTime)}?`;
    if (!confirm(`${question} O horário volta a ficar livre para outras pessoas.`)) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ cancelledIds: string[] }>(`/reservations/${target.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      setNotice(`${plural(res.cancelledIds.length, "data cancelada", "datas canceladas")}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  const visible = reservations.filter((r) =>
    view === "upcoming" ? new Date(r.endTime).getTime() >= now : new Date(r.endTime).getTime() < now,
  );
  const groups = groupBySeries(visible);
  if (view === "past") groups.reverse(); // no histórico, as mais recentes primeiro

  const viewClass = (v: View) =>
    `rounded-md px-3 py-1 text-sm ${view === v ? "bg-slate-200 font-medium" : "text-slate-600 hover:bg-slate-100"}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Minhas reservas</h2>
        <div className="flex gap-1">
          <button onClick={() => setView("upcoming")} className={viewClass("upcoming")}>
            Próximas
          </button>
          <button onClick={() => setView("past")} className={viewClass("past")}>
            Anteriores
          </button>
        </div>
      </div>

      {notice && <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ul className="mt-4 space-y-3">
        {loading && <li className="text-sm text-slate-500">Carregando…</li>}
        {!loading && groups.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            {view === "upcoming" ? (
              <>
                Você não tem reservas futuras.{" "}
                <button onClick={onNewRequest} className="text-slate-900 underline">
                  Reservar uma sala
                </button>
              </>
            ) : (
              "Nenhuma reserva anterior."
            )}
          </li>
        )}
        {!loading &&
          groups.map((group) => {
            const first = group[0]!;
            const cancellable = group.filter((r) => isCancellable(r, now));
            return (
              <li key={first.seriesId ?? first.id} className="rounded-lg border border-slate-200 p-4">
                <div className="font-medium">{first.title}</div>
                <div className="text-sm text-slate-500">
                  {first.activityType ? ACTIVITY_TYPE_LABELS[first.activityType] : "Solicitação"}
                  {group.length > 1 && ` · série com ${group.length} datas`}
                </div>

                <ul className="mt-3 divide-y divide-slate-100">
                  {group.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="w-60 shrink-0">{formatDateTimeRange(r.startTime, r.endTime)}</span>
                      <StatusBadge status={r.status} />
                      <span className="min-w-0 flex-1 text-slate-600">{situation(r)}</span>
                      {isCancellable(r, now) && (
                        <button
                          disabled={busy}
                          onClick={() => void cancel(r, "single", 1)}
                          className="text-sm text-red-600 hover:underline disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {cancellable.length > 1 && (
                  <button
                    disabled={busy}
                    onClick={() => void cancel(cancellable[0]!, "series", cancellable.length)}
                    className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                  >
                    Cancelar as {cancellable.length} próximas datas
                  </button>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
