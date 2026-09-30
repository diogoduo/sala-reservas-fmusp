import {
  ArrowRightIcon,
  CalendarBlankIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  HammerIcon,
  HashIcon,
  HourglassMediumIcon,
  ListNumbersIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  MoonIcon,
  PencilSimpleLineIcon,
  ProhibitIcon,
  RepeatIcon,
  TrayIcon,
  UserMinusIcon,
  UsersIcon,
  WarningIcon,
  WrenchIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ACTIVITY_TYPE_LABELS, PRIORITY_LABELS, priorityOf } from "../../lib/activities";
import { api } from "../../lib/api";
import { formatDateTimeRange, formatShortDate, formatTimeRange, plural } from "../../lib/format";
import { ACTIVITY_ICONS } from "../../lib/icons";
import { reservationWarnings } from "../../lib/portarias";
import { formatMinutes, groupBySeries, isModifiedPending, notifyReservationsChanged, onReservationsChanged } from "../../lib/reservations";
import { useToast } from "../../lib/toast";
import type { AdminReservation, ReservationStatus, Resource, Sanction } from "../../lib/types";
import { StatusBadge } from "../StatusBadge";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { CardListSkeleton, EmptyState } from "../ui/Feedback";
import { Input } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card, IconTile, PageHeader } from "../ui/Surface";
import { AdminReservationActions, isAdminActionable } from "./ReservationActions";
import { ReviewDrawer } from "./ReviewPanel";

// "MODIFIED" não é um status do banco: são as pendentes que o solicitante alterou.
type Filter = ReservationStatus | "MODIFIED";

function matchesFilter(r: AdminReservation, filter: Filter): boolean {
  if (filter === "MODIFIED") return isModifiedPending(r);
  if (filter === "PENDING") return r.status === "PENDING" && !isModifiedPending(r);
  return r.status === filter;
}

const STATUS_FILTERS: { value: Filter; label: string; icon: Icon; empty: string }[] = [
  { value: "PENDING", label: "Pendentes", icon: HourglassMediumIcon, empty: "Nenhuma solicitação esperando análise. Tudo em dia!" },
  { value: "MODIFIED", label: "Alteradas", icon: PencilSimpleLineIcon, empty: "Nenhuma reserva alterada pelos solicitantes esperando análise." },
  { value: "APPROVED", label: "Aprovadas", icon: CheckCircleIcon, empty: "Nenhuma solicitação aprovada ainda." },
  { value: "REJECTED", label: "Rejeitadas", icon: XCircleIcon, empty: "Nenhuma solicitação rejeitada." },
  { value: "CANCELLED", label: "Canceladas", icon: ProhibitIcon, empty: "Nenhuma reserva cancelada." },
];

function Chip({ icon: ChipIcon, children }: { icon: Icon; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-medium">
      <ChipIcon size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

const groupKey = (group: AdminReservation[]) => group[0]!.seriesId ?? group[0]!.id;

type ActiveSuspension = Sanction & { user: { id: string; name: string; email: string } };

/** Solicitantes com novas reservas suspensas (Portaria 2793, Arts. 9º §2º, 11, 17 e 22). */
function ActiveSuspensions() {
  const toast = useToast();
  const [list, setList] = useState<ActiveSuspension[]>([]);
  const load = () =>
    api<{ suspensions: ActiveSuspension[] }>("/admin/sanctions/active")
      .then((res) => setList(res.suspensions))
      .catch(() => setList([]));
  useEffect(() => {
    void load();
    return onReservationsChanged(() => void load());
  }, []);
  if (list.length === 0) return null;

  async function lift(id: string) {
    try {
      await api(`/admin/sanctions/${id}/lift`, { method: "POST" });
      toast.success("Suspensão retirada");
      void load();
    } catch (e) {
      toast.error("Não foi possível retirar.", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <details className="rounded-xl border border-danger-foreground/25 bg-danger-soft/60 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-danger-foreground">
        {plural(list.length, "solicitante suspenso", "solicitantes suspensos")} de fazer novas reservas
      </summary>
      <ul className="mt-3 divide-y divide-danger-foreground/15">
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-medium">{s.user.name}</span> <span className="text-muted">· {s.user.email}</span>
              <span className="block text-xs text-muted">
                {s.until ? `Até ${new Date(s.until).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "Até a regularização"} — {s.reason}
              </span>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void lift(s.id)}>
              Retirar
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Fila de aprovação (Fase 6): o Admin analisa cada solicitação, aloca a sala
// mais adequada e aprova, ou rejeita com justificativa.
export function RequestsAdmin() {
  const toast = useToast();
  const navigate = useNavigate();
  const [reservations, setReservations] = useState<AdminReservation[] | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [status, setStatus] = useState<Filter>("PENDING");
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Carrega tudo de uma vez: os filtros e as contagens ficam instantâneos.
  async function load() {
    try {
      const { reservations: list } = await api<{ reservations: AdminReservation[] }>("/admin/reservations");
      setReservations(list);
    } catch (e) {
      toast.error("Não foi possível carregar as solicitações.", e instanceof Error ? e.message : undefined);
      setReservations([]);
    }
  }

  useEffect(() => {
    void load();
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(message: string) {
    toast.success(message, "O solicitante foi avisado por e-mail.");
    setOpenKey(null);
    notifyReservationsChanged();
    void load();
  }

  const all = reservations ?? [];
  const groupsByStatus = (s: Filter) => groupBySeries(all.filter((r) => matchesFilter(r, s)));
  const statusGroups = groupsByStatus(status);
  const needle = query.trim().toLowerCase();
  const groups = needle
    ? statusGroups.filter(([first]) =>
        `${first!.protocol} ${first!.title} ${first!.user.name} ${first!.user.email}`.toLowerCase().includes(needle),
      )
    : statusGroups;
  const openGroup = openKey ? statusGroups.find((g) => groupKey(g) === openKey) : undefined;
  const filter = STATUS_FILTERS.find((f) => f.value === status)!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitações"
        description="Analise os pedidos, escolha a sala mais adequada e aprove ou rejeite."
        actions={
          <Button icon={CalendarPlusIcon} onClick={() => navigate("/admin/reservar?voltar=/admin/solicitacoes")}>
            Nova reserva
          </Button>
        }
      />

      <ActiveSuspensions />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setOpenKey(null);
          }}
          options={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label, icon: f.icon, count: groupsByStatus(f.value).length }))}
        />
        <div className="relative lg:w-72">
          <Input
            type="search"
            aria-label="Buscar por protocolo, título ou solicitante"
            placeholder="Protocolo, título ou solicitante"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
      </div>

      {reservations === null ? (
        <CardListSkeleton />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={needle ? MagnifyingGlassIcon : TrayIcon}
          title={needle ? "Nada encontrado" : `Sem solicitações ${filter.label.toLowerCase()}`}
          description={needle ? `Nenhuma solicitação ${filter.label.toLowerCase().replace(/s$/, "")} com "${query}".` : filter.empty}
        />
      ) : (
        <ul className="space-y-4">
          {groups.map((group, index) => {
            const first = group[0]!;
            const key = groupKey(group);
            const isPending = first.status === "PENDING";
            const ActivityIcon = first.activityType ? ACTIVITY_ICONS[first.activityType] : CalendarBlankIcon;
            const rooms = [...new Set(group.flatMap((r) => (r.room ? [r.room.name] : [])))];
            const last = group[group.length - 1]!;
            // Numa série, "Alterar"/"Cancelar" partem da próxima data que ainda pode mudar.
            const actionTarget = group.find((r) => isAdminActionable(r));
            return (
              <li key={key} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
                <Card className="p-4 transition-shadow duration-200 hover:shadow-md sm:p-5">
                  <div className="flex items-start gap-4">
                    <IconTile icon={ActivityIcon} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <h2 className="min-w-0 text-base font-semibold sm:text-lg">{first.title}</h2>
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge status={first.status} />
                          {isModifiedPending(first) && (
                            <Badge tone="info" icon={PencilSimpleLineIcon}>
                              Alterada
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted">
                        <Avatar name={first.user.name} size="sm" className="size-6 text-[10px]" />
                        <span className="truncate">
                          {first.user.name} · {first.user.email}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Chip icon={HashIcon}>Protocolo {first.protocol}</Chip>
                    {(() => {
                      const priority = priorityOf(first.activityType, first.activityDetails);
                      return (
                        <span title={`Art. 7º: ${PRIORITY_LABELS[priority]}`}>
                          <Chip icon={ListNumbersIcon}>Prioridade {priority}</Chip>
                        </span>
                      );
                    })()}
                    {group.length === 1 ? (
                      <Chip icon={CalendarBlankIcon}>{formatDateTimeRange(first.startTime, first.endTime)}</Chip>
                    ) : (
                      <Chip icon={RepeatIcon}>
                        {plural(group.length, "data", "datas")} · {formatShortDate(first.startTime)} a {formatShortDate(last.startTime)} ·{" "}
                        {formatTimeRange(first.startTime, first.endTime)}
                      </Chip>
                    )}
                    {isModifiedPending(first) && first.previousSnapshot && (
                      <Chip icon={ClockCounterClockwiseIcon}>
                        Antes: {formatDateTimeRange(first.previousSnapshot.startTime, first.previousSnapshot.endTime)}
                        {first.previousSnapshot.roomName ? ` · ${first.previousSnapshot.roomName.split(" — ")[0]}` : ""}
                      </Chip>
                    )}
                    <Chip icon={UsersIcon}>{plural(first.expectedAttendees, "pessoa", "pessoas")}</Chip>
                    {first.activityType && <Chip icon={ActivityIcon}>{ACTIVITY_TYPE_LABELS[first.activityType]}</Chip>}
                    {first.requestedResources.length > 0 && (
                      <Chip icon={WrenchIcon}>{plural(first.requestedResources.length, "recurso", "recursos")}</Chip>
                    )}
                    {rooms.length > 0 && <Chip icon={MapPinIcon}>{isPending ? `Indicada: ${rooms.join(", ")}` : rooms.join(", ")}</Chip>}
                    {first.setupMinutes > 0 && <Chip icon={HammerIcon}>Montagem de {formatMinutes(first.setupMinutes)}</Chip>}
                    {first.outsideRegularHours && <Chip icon={MoonIcon}>Horário extraordinário</Chip>}
                    {reservationWarnings(first).length > 0 && (
                      <span title={reservationWarnings(first).map((w) => `${w.rule}: ${w.message}`).join("\n")}>
                        <Chip icon={WarningIcon}>Fora das portarias</Chip>
                      </span>
                    )}
                    {group.some((r) => r.noShowAt) && <Chip icon={UserMinusIcon}>Ausência registrada</Chip>}
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted">{first.description}</p>
                  {first.status === "CANCELLED" && first.cancellationReason && (
                    <p className="mt-2 text-sm">
                      <span className="font-medium">Cancelada pelo SAD:</span> <span className="text-muted">{first.cancellationReason}</span>
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="text-xs text-muted">
                      {isModifiedPending(first) && first.modifiedByRequesterAt
                        ? `Alterada pelo solicitante em ${new Date(first.modifiedByRequesterAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                        : first.modifiedByAdminAt
                          ? `Alterada pelo SAD em ${new Date(first.modifiedByAdminAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                          : `Enviada em ${new Date(first.createdAt).toLocaleDateString("pt-BR")}`}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {actionTarget && (
                        <AdminReservationActions reservation={actionTarget} returnTo="/admin/solicitacoes" onChanged={() => void load()} />
                      )}
                      <Button
                        size="sm"
                        variant={isPending ? "primary" : "secondary"}
                        iconRight={ArrowRightIcon}
                        onClick={() => setOpenKey(key)}
                      >
                        {isPending ? "Analisar" : "Ver detalhes"}
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {openGroup && (
        <ReviewDrawer
          key={openKey}
          group={openGroup}
          resources={resources}
          onClose={() => setOpenKey(null)}
          onDone={handleDone}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
