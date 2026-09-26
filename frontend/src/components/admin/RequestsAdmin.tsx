import { Fragment, useEffect, useState } from "react";
import { ACTIVITY_TYPE_LABELS, activityDetailRows } from "../../lib/activities";
import { api } from "../../lib/api";
import { formatDateTimeRange, formatShortDate, formatTimeRange } from "../../lib/format";
import { RESERVATION_STATUS_LABELS } from "../../lib/types";
import type { AdminReservation, RequestedResource, ReservationStatus, Resource } from "../../lib/types";
import { ReviewPanel } from "./ReviewPanel";

const STATUS_FILTERS: { status: ReservationStatus; label: string }[] = [
  { status: "PENDING", label: "Pendentes" },
  { status: "APPROVED", label: "Aprovadas" },
  { status: "REJECTED", label: "Rejeitadas" },
  { status: "CANCELLED", label: "Canceladas" },
];

const STATUS_BADGE: Record<ReservationStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

/** Junta as ocorrências de uma mesma série num card só (a API já devolve em ordem de início). */
function groupBySeries(list: AdminReservation[]): AdminReservation[][] {
  const groups = new Map<string, AdminReservation[]>();
  for (const r of list) {
    const key = r.seriesId ?? r.id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
}

// Fila de aprovação (Fase 6): o Admin analisa cada solicitação, aloca a sala
// mais adequada e aprova, ou rejeita com justificativa.
export function RequestsAdmin() {
  const [status, setStatus] = useState<ReservationStatus>("PENDING");
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { reservations: list } = await api<{ reservations: AdminReservation[] }>(`/admin/reservations?status=${status}`);
      setReservations(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar solicitações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources));
  }, []);

  useEffect(() => {
    setReviewingKey(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function handleDone(message: string) {
    setNotice(message);
    setReviewingKey(null);
    void load();
  }

  // "Computador de Apoio (2)", "Webconferência: Zoom"
  const describeResource = ({ resourceId, quantity, detail }: RequestedResource) =>
    `${resources.find((r) => r.id === resourceId)?.name ?? "recurso removido"}${quantity ? ` (${quantity})` : ""}${detail ? `: ${detail}` : ""}`;
  const groups = groupBySeries(reservations);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Solicitações de reserva</h2>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.status}
              onClick={() => {
                setStatus(f.status);
                setNotice(null);
              }}
              className={`rounded-md px-3 py-1 text-sm ${
                status === f.status ? "bg-slate-200 font-medium" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {notice && <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ul className="mt-4 space-y-3">
        {loading && <li className="text-sm text-slate-500">Carregando…</li>}
        {!loading && groups.length === 0 && <li className="text-sm text-slate-500">Nenhuma solicitação nesta lista.</li>}
        {!loading &&
          groups.map((group) => {
            const first = group[0]!;
            const key = first.seriesId ?? first.id;
            const rooms = [
              ...new Set(group.flatMap((r) => (r.room ? [`${r.room.name} — ${r.room.building}, ${r.room.floor}`] : []))),
            ];
            return (
              <li key={key} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{first.title}</div>
                    <div className="text-sm text-slate-500">
                      {first.user.name} · {first.user.email}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[first.status]}`}>
                    {RESERVATION_STATUS_LABELS[first.status]}
                  </span>
                </div>

                <div className="mt-2 text-sm">
                  {group.length === 1 ? (
                    formatDateTimeRange(first.startTime, first.endTime)
                  ) : (
                    <>
                      Série · {group.length} datas · {formatTimeRange(first.startTime, first.endTime)}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {group.map((r) => (
                          <span key={r.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {formatShortDate(r.startTime)}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <p className="mt-2 text-sm text-slate-700">{first.description}</p>

                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {first.activityType && (
                    <>
                      <dt className="text-slate-500">Atividade</dt>
                      <dd>{ACTIVITY_TYPE_LABELS[first.activityType]}</dd>
                    </>
                  )}
                  <dt className="text-slate-500">Participantes</dt>
                  <dd>{first.expectedAttendees}</dd>
                  {first.activityType &&
                    first.activityDetails &&
                    activityDetailRows(first.activityType, first.activityDetails).map((row) => (
                      <Fragment key={row.label}>
                        <dt className="text-slate-500">{row.label}</dt>
                        <dd className="whitespace-pre-line">{row.value}</dd>
                      </Fragment>
                    ))}
                  {first.requestedResources.length > 0 && (
                    <>
                      <dt className="text-slate-500">Recursos</dt>
                      <dd>{first.requestedResources.map(describeResource).join("; ")}</dd>
                    </>
                  )}
                  {first.supportNotes && (
                    <>
                      <dt className="text-slate-500">Obs. para TI</dt>
                      <dd>{first.supportNotes}</dd>
                    </>
                  )}
                  {rooms.length > 0 && (
                    <>
                      {/* Pendente com sala = pedido feito antes da correção pós-Fase 5, quando o solicitante indicava sala. */}
                      <dt className="text-slate-500">{first.status === "PENDING" ? "Sala indicada" : "Sala"}</dt>
                      <dd>{rooms.join("; ")}</dd>
                    </>
                  )}
                  {first.rejectionReason && (
                    <>
                      <dt className="text-slate-500">Justificativa</dt>
                      <dd>{first.rejectionReason}</dd>
                    </>
                  )}
                  {first.reviewedBy && first.reviewedAt && (
                    <>
                      <dt className="text-slate-500">Revisada por</dt>
                      <dd>
                        {first.reviewedBy.name} em {new Date(first.reviewedAt).toLocaleString("pt-BR")}
                      </dd>
                    </>
                  )}
                </dl>

                {first.status === "PENDING" &&
                  (reviewingKey === key ? (
                    <ReviewPanel
                      group={group}
                      resources={resources}
                      onDone={handleDone}
                      onCancel={() => setReviewingKey(null)}
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setReviewingKey(key);
                        setNotice(null);
                      }}
                      className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
                    >
                      Analisar
                    </button>
                  ))}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
