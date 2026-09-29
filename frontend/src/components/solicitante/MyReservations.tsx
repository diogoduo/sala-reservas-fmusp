import {
  CalendarBlankIcon,
  CalendarCheckIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  HammerIcon,
  HashIcon,
  HourglassMediumIcon,
  KeyIcon,
  MapPinIcon,
  PencilSimpleIcon,
  PencilSimpleLineIcon,
  RepeatIcon,
  UserMinusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ACTIVITY_TYPE_LABELS } from "../../lib/activities";
import { api } from "../../lib/api";
import { formatDayMonth } from "../../lib/calendar";
import { cn } from "../../lib/cn";
import { useConfirm } from "../../lib/confirm";
import { dateTile, formatDateTimeRange, formatTimeRange, plural, relativeDays } from "../../lib/format";
import { ACTIVITY_ICONS } from "../../lib/icons";
import {
  formatMinutes,
  groupBySeries,
  isCancellable,
  isEditable,
  isModifiedPending,
  isPastCancelDeadline,
  keyPickupTime,
  requesterDeadline,
} from "../../lib/reservations";
import { useToast } from "../../lib/toast";
import type { Reservation, ReviewScope } from "../../lib/types";
import { StatusBadge } from "../StatusBadge";
import { Badge } from "../ui/Badge";
import { RoomPhotosButton } from "../rooms/RoomPhotos";
import { Button } from "../ui/Button";
import { Alert, CardListSkeleton, EmptyState } from "../ui/Feedback";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card, IconTile, PageHeader, StatCard } from "../ui/Surface";

type View = "upcoming" | "past";

const COLLAPSED_ROWS = 4;

const roomLabel = (r: Reservation) => (r.room ? `${r.room.name} — ${r.room.building}, ${r.room.floor}` : null);

/** O que o solicitante precisa saber sobre cada data, conforme o status. */
function Situation({ reservation: r, upcoming }: { reservation: Reservation; upcoming: boolean }) {
  const room = roomLabel(r);
  switch (r.status) {
    case "APPROVED":
      return (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-foreground">
          <MapPinIcon size={16} weight="fill" className="shrink-0 text-primary" aria-hidden />
          {room}
          {r.room && <RoomPhotosButton room={r.room} />}
          {upcoming && (
            // Portaria 2793, Art. 10: o responsável vai ao SAD/NE 10 minutos antes.
            <span className="flex w-full items-center gap-1.5 text-xs text-muted">
              <KeyIcon size={14} className="shrink-0" aria-hidden />
              Retire as chaves no SAD/NE às {keyPickupTime(r)} (10 minutos antes).
            </span>
          )}
          {r.noShowAt && (
            <span className="w-full text-xs font-medium text-danger-foreground">
              Ausência registrada pelo SAD: o espaço não foi usado nem cancelado (Portaria 2793, Art. 9º §2º).
            </span>
          )}
          {r.modifiedByAdminAt && <span className="w-full text-xs text-muted">Alterada pelo SAD em {new Date(r.modifiedByAdminAt).toLocaleDateString("pt-BR")}</span>}
        </span>
      );
    case "PENDING":
      if (r.modifiedByRequesterAt) {
        return <span className="text-muted">Alterada por você · aguardando nova análise do SAD</span>;
      }
      // Com sala = pedido anterior à correção pós-Fase 5, quando o solicitante indicava a sala.
      return <span className="text-muted">{room ? `Sala indicada: ${room} · aguardando aprovação` : "Aguardando o SAD alocar uma sala"}</span>;
    case "REJECTED":
      return (
        <span className="text-danger-foreground">
          <span className="font-medium">Justificativa:</span> {r.rejectionReason}
        </span>
      );
    case "CANCELLED":
      // Com motivo = cancelada pelo SAD (o solicitante cancela sem precisar justificar).
      if (r.cancellationReason) {
        return (
          <span className="text-danger-foreground">
            <span className="font-medium">Cancelada pelo SAD{r.cancelledAt ? ` em ${new Date(r.cancelledAt).toLocaleDateString("pt-BR")}` : ""}:</span>{" "}
            {r.cancellationReason}
          </span>
        );
      }
      return <span className="text-muted">{r.cancelledAt ? `Cancelada em ${new Date(r.cancelledAt).toLocaleDateString("pt-BR")}` : "Cancelada"}</span>;
  }
}

function DateTile({ iso, muted }: { iso: string; muted?: boolean }) {
  const { day, month, weekday } = dateTile(iso);
  return (
    <div
      className={cn(
        "flex w-14 shrink-0 flex-col items-center rounded-xl border py-1.5 leading-none",
        muted ? "border-border bg-surface-muted text-muted" : "border-primary/20 bg-primary-soft text-primary-soft-foreground",
      )}
    >
      <span className="text-[10px] font-semibold tracking-wide uppercase">{weekday}</span>
      <span className="mt-1 text-xl font-bold tabular-nums">{day}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase">{month}</span>
    </div>
  );
}

// "Minhas Reservas" (Fase 8): acompanhar o status de cada data e cancelar o
// que ainda não começou — uma data ou todas as próximas de uma série.
export function MyReservations() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [view, setView] = useState<View>("upcoming");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [suspension, setSuspension] = useState<{ until: string | null; reason: string } | null>(null);

  useEffect(() => {
    api<{ suspension: { until: string | null; reason: string } | null }>("/reservations/me/standing")
      .then((res) => setSuspension(res.suspension))
      .catch(() => undefined);
  }, []);

  async function load() {
    try {
      const { reservations: list } = await api<{ reservations: Reservation[] }>("/reservations");
      setReservations(list);
    } catch (e) {
      toast.error("Não foi possível carregar suas reservas.", e instanceof Error ? e.message : undefined);
      setReservations([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cancel(target: Reservation, scope: ReviewScope, count: number) {
    const ok = await confirm({
      tone: "danger",
      title: scope === "series" ? `Cancelar as ${count} próximas datas?` : "Cancelar esta reserva?",
      description:
        scope === "series"
          ? `Todas as próximas datas de "${target.title}" serão canceladas e os horários ficarão livres para outras pessoas.`
          : `${formatDateTimeRange(target.startTime, target.endTime)} — o horário ficará livre para outras pessoas.`,
      confirmLabel: scope === "series" ? "Cancelar todas" : "Cancelar reserva",
      cancelLabel: "Manter",
    });
    if (!ok) return;

    setBusyId(target.id);
    try {
      const res = await api<{ cancelledIds: string[]; keptIds: string[] }>(`/reservations/${target.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      toast.success(
        plural(res.cancelledIds.length, "data cancelada", "datas canceladas"),
        res.keptIds.length > 0
          ? `${plural(res.keptIds.length, "data aprovada já passou", "datas aprovadas já passaram")} do prazo de 3 dias úteis e só o SAD pode cancelar.`
          : "O SAD foi avisado por e-mail.",
      );
      await load();
    } catch (e) {
      toast.error("Não foi possível cancelar.", e instanceof Error ? e.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  const now = Date.now();
  const all = reservations ?? [];
  const upcoming = all.filter((r) => new Date(r.endTime).getTime() >= now);
  const past = all.filter((r) => new Date(r.endTime).getTime() < now);
  const upcomingActive = upcoming.filter((r) => r.status === "PENDING" || r.status === "APPROVED");
  const nextApproved = upcoming.find((r) => r.status === "APPROVED");

  const groups = groupBySeries(view === "upcoming" ? upcoming : past);
  if (view === "past") groups.reverse(); // no histórico, as mais recentes primeiro

  return (
    <div className="space-y-6">
      <PageHeader
        title="Minhas reservas"
        description="Acompanhe suas solicitações e cancele o que não for mais usar."
        actions={
          <Button icon={CalendarPlusIcon} onClick={() => navigate("/reservar")}>
            Reservar uma sala
          </Button>
        }
      />

      {suspension && (
        <Alert
          tone="danger"
          title={`Suas novas reservas estão suspensas ${suspension.until ? `até ${new Date(suspension.until).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "até a regularização"}`}
        >
          Motivo: {suspension.reason}. Fale com o SAD/NE.
        </Alert>
      )}

      {reservations !== null && all.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {nextApproved ? (
            <div className="relative col-span-2 animate-fade-in-up overflow-hidden rounded-2xl bg-linear-to-br from-teal-700 to-emerald-800 p-4 text-white shadow-sm">
              <div aria-hidden className="absolute -top-10 -right-10 size-40 rounded-full bg-white/10 blur-2xl" />
              <p className="relative flex items-center gap-1.5 text-xs font-semibold tracking-wide text-teal-100 uppercase">
                <CalendarCheckIcon size={16} weight="fill" aria-hidden /> Próxima reserva · {relativeDays(nextApproved.startTime)}
              </p>
              <p className="relative mt-2 truncate font-display text-lg font-bold">{nextApproved.title}</p>
              <p className="relative mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-teal-50">
                <span className="flex items-center gap-1.5">
                  <ClockIcon size={16} aria-hidden /> {formatDateTimeRange(nextApproved.startTime, nextApproved.endTime)}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPinIcon size={16} aria-hidden /> {nextApproved.room?.name}
                  {nextApproved.room && <RoomPhotosButton room={nextApproved.room} tone="inverse" />}
                </span>
              </p>
            </div>
          ) : (
            <div className="col-span-2">
              <StatCard label="Próximas datas" value={upcomingActive.length} icon={CalendarBlankIcon} />
            </div>
          )}
          <StatCard
            label="Aguardando aprovação"
            value={upcoming.filter((r) => r.status === "PENDING").length}
            icon={HourglassMediumIcon}
            tone="warning"
          />
          <StatCard label="Aprovadas" value={upcoming.filter((r) => r.status === "APPROVED").length} icon={CheckCircleIcon} tone="success" />
        </div>
      )}

      <SegmentedControl
        label="Período"
        value={view}
        onChange={setView}
        options={[
          { value: "upcoming", label: "Próximas", count: groupBySeries(upcoming).length, icon: CalendarBlankIcon },
          { value: "past", label: "Anteriores", count: groupBySeries(past).length, icon: ClockCounterClockwiseIcon },
        ]}
      />

      {reservations === null ? (
        <CardListSkeleton />
      ) : groups.length === 0 ? (
        view === "upcoming" ? (
          <EmptyState
            icon={CalendarPlusIcon}
            title="Nenhuma reserva por vir"
            description="Quando você fizer uma solicitação, ela aparece aqui com o status de cada data."
            action={
              <Button icon={CalendarPlusIcon} onClick={() => navigate("/reservar")}>
                Reservar uma sala
              </Button>
            }
          />
        ) : (
          <EmptyState icon={CalendarXIcon} title="Nenhuma reserva anterior" description="Seu histórico aparece aqui depois que as datas passarem." />
        )
      ) : (
        <ul className="space-y-4">
          {groups.map((group, index) => {
            const first = group[0]!;
            const key = first.seriesId ?? first.id;
            const cancellable = group.filter((r) => isCancellable(r, now));
            const isExpanded = expanded.has(key);
            const visibleRows = isExpanded ? group : group.slice(0, COLLAPSED_ROWS);
            const ActivityIcon = first.activityType ? ACTIVITY_ICONS[first.activityType] : CalendarBlankIcon;
            return (
              <li key={key} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
                <Card className="overflow-hidden">
                  <div className="flex items-start gap-4 p-4 sm:p-5">
                    <IconTile icon={ActivityIcon} />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold sm:text-lg">{first.title}</h2>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                        {first.activityType ? ACTIVITY_TYPE_LABELS[first.activityType] : "Solicitação"}
                        {group.length > 1 && (
                          <span className="flex items-center gap-1">
                            · <RepeatIcon size={14} aria-hidden /> série com {group.length} datas
                          </span>
                        )}
                        <span className="flex items-center gap-1 tabular-nums">
                          · <HashIcon size={14} aria-hidden /> Protocolo {first.protocol}
                        </span>
                      </p>
                    </div>
                  </div>

                  <ul className="divide-y divide-border border-t border-border">
                    {visibleRows.map((r) => {
                      const inactive = r.status === "CANCELLED" || r.status === "REJECTED";
                      // Art. 9º: passado o prazo de 3 dias úteis, só o SAD cancela a reserva aprovada.
                      const lateNotice = isPastCancelDeadline(r, now) && (
                        <p className="max-w-56 text-xs text-muted sm:text-right">
                          Prazo para cancelar pelo sistema encerrado em {formatDayMonth(requesterDeadline(r))}. Fale com o SAD/NE.
                        </p>
                      );
                      const actions = isCancellable(r, now) && (
                        <div className="flex gap-1">
                          {isEditable(r, now) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={PencilSimpleIcon}
                              disabled={busyId !== null}
                              onClick={() => navigate(`/minhas-reservas/${r.id}/editar`)}
                            >
                              Alterar
                            </Button>
                          )}
                          <Button
                            variant="danger-soft"
                            size="sm"
                            icon={XIcon}
                            loading={busyId === r.id}
                            disabled={busyId !== null}
                            onClick={() => void cancel(r, "single", 1)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      );
                      return (
                        <li key={r.id} className="flex items-start gap-3 px-4 py-3 sm:items-center sm:gap-4 sm:px-5">
                          <DateTile iso={r.startTime} muted={inactive || view === "past"} />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
                                <ClockIcon size={16} className="text-muted" aria-hidden />
                                {formatTimeRange(r.startTime, r.endTime)}
                              </span>
                              <StatusBadge status={r.status} />
                              {isModifiedPending(r) && (
                                <Badge tone="info" icon={PencilSimpleLineIcon}>
                                  Alterada
                                </Badge>
                              )}
                              {r.setupMinutes > 0 && (
                                <Badge tone="neutral" icon={HammerIcon}>
                                  Inclui {formatMinutes(r.setupMinutes)} de montagem
                                </Badge>
                              )}
                              {r.noShowAt && (
                                <Badge tone="danger" icon={UserMinusIcon}>
                                  Ausência
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm">
                              <Situation reservation={r} upcoming={view === "upcoming"} />
                            </p>
                            {r.status === "APPROVED" && isCancellable(r, now) && view === "upcoming" && (
                              <p className="text-xs text-muted">Cancelar ou alterar pelo sistema até {formatDayMonth(requesterDeadline(r))}.</p>
                            )}
                            {/* Celular: o botão vai abaixo do texto, que fica com a largura toda. */}
                            {actions && <div className="-ml-3 sm:hidden">{actions}</div>}
                            {lateNotice && <div className="sm:hidden">{lateNotice}</div>}
                          </div>
                          {actions && <div className="hidden shrink-0 sm:block">{actions}</div>}
                          {lateNotice && <div className="hidden shrink-0 sm:block">{lateNotice}</div>}
                        </li>
                      );
                    })}
                  </ul>

                  {(group.length > COLLAPSED_ROWS || cancellable.length > 1) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-muted/50 px-4 py-2.5 sm:px-5">
                      {group.length > COLLAPSED_ROWS ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          iconRight={CaretDownIcon}
                          aria-expanded={isExpanded}
                          className={cn("[&>svg]:transition-transform", isExpanded && "[&>svg]:rotate-180")}
                          onClick={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        >
                          {isExpanded ? "Mostrar menos" : `Mostrar todas as ${group.length} datas`}
                        </Button>
                      ) : (
                        <span />
                      )}
                      {cancellable.length > 1 && (
                        <Button
                          variant="danger-soft"
                          size="sm"
                          loading={busyId === cancellable[0]!.id}
                          disabled={busyId !== null}
                          onClick={() => void cancel(cancellable[0]!, "series", cancellable.length)}
                        >
                          Cancelar as {cancellable.length} próximas
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
