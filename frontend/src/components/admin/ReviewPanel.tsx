import {
  CheckCircleIcon,
  SealCheckIcon,
  SparkleIcon,
  WarningIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ACTIVITY_TYPE_LABELS, activityDetailRows } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDateTimeRange, formatShortDate, formatTimeRange, plural } from "../../lib/format";
import { ROOM_TYPE_ICONS } from "../../lib/icons";
import { useToast } from "../../lib/toast";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { AdminReservation, RequestedResource, Resource, ReviewScope, RoomOption } from "../../lib/types";
import { StatusBadge } from "../StatusBadge";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, Skeleton } from "../ui/Feedback";
import { Select, Textarea } from "../ui/Field";
import { IconTile } from "../ui/Surface";

const ALL = "all";

/** "Computador de Apoio (2)", "Webconferência: Zoom" */
export function describeResource(resources: Resource[], { resourceId, quantity, detail }: RequestedResource): string {
  const name = resources.find((r) => r.id === resourceId)?.name ?? "recurso removido";
  return `${name}${quantity ? ` (${quantity})` : ""}${detail ? `: ${detail}` : ""}`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-line">{children}</dd>
    </>
  );
}

/** Todos os dados do pedido, em lista rótulo/valor. */
function RequestDetails({ group, resources }: { group: AdminReservation[]; resources: Resource[] }) {
  const first = group[0]!;
  const rooms = [...new Set(group.flatMap((r) => (r.room ? [`${r.room.name} — ${r.room.building}, ${r.room.floor}`] : [])))];
  return (
    <section aria-label="Dados da solicitação" className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-surface-muted p-3">
        <Avatar name={first.user.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{first.user.name}</p>
          <p className="truncate text-sm text-muted">{first.user.email}</p>
        </div>
        <StatusBadge status={first.status} />
      </div>

      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
        {first.activityType && <DetailRow label="Atividade">{ACTIVITY_TYPE_LABELS[first.activityType]}</DetailRow>}
        <DetailRow label="Participantes">{first.expectedAttendees}</DetailRow>
        <DetailRow label={group.length > 1 ? `Datas (${group.length})` : "Data"}>
          {group.length === 1 ? (
            formatDateTimeRange(first.startTime, first.endTime)
          ) : (
            <>
              <span className="tabular-nums">{formatTimeRange(first.startTime, first.endTime)}</span>
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {group.map((r) => (
                  <li key={r.id} className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums">
                    {formatShortDate(r.startTime)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </DetailRow>
        <DetailRow label="Descrição">{first.description}</DetailRow>
        {first.activityType &&
          first.activityDetails &&
          activityDetailRows(first.activityType, first.activityDetails).map((row) => (
            <Fragment key={row.label}>
              <DetailRow label={row.label}>{row.value}</DetailRow>
            </Fragment>
          ))}
        {first.requestedResources.length > 0 && (
          <DetailRow label="Recursos">{first.requestedResources.map((r) => describeResource(resources, r)).join("; ")}</DetailRow>
        )}
        {first.supportNotes && <DetailRow label="Obs. para TI">{first.supportNotes}</DetailRow>}
        {rooms.length > 0 && (
          <DetailRow label={first.status === "PENDING" ? "Sala indicada" : "Sala"}>{rooms.join("; ")}</DetailRow>
        )}
        {first.rejectionReason && <DetailRow label="Justificativa">{first.rejectionReason}</DetailRow>}
        {first.reviewedBy && first.reviewedAt && (
          <DetailRow label="Revisada por">
            {first.reviewedBy.name} em {new Date(first.reviewedAt).toLocaleString("pt-BR")}
          </DetailRow>
        )}
        {first.cancelledAt && <DetailRow label="Cancelada em">{new Date(first.cancelledAt).toLocaleString("pt-BR")}</DetailRow>}
        <DetailRow label="Enviada em">{new Date(first.createdAt).toLocaleString("pt-BR")}</DetailRow>
      </dl>
    </section>
  );
}

function Check({ state, children }: { state: "ok" | "warn" | "bad"; children: ReactNode }) {
  const { icon: CheckIcon, className }: { icon: Icon; className: string } = {
    ok: { icon: CheckCircleIcon, className: "text-success-foreground" },
    warn: { icon: WarningIcon, className: "text-warning-foreground" },
    bad: { icon: XCircleIcon, className: "text-danger-foreground" },
  }[state];
  return (
    <li className={cn("flex items-center gap-1", className)}>
      <CheckIcon size={14} weight="fill" aria-hidden />
      {children}
    </li>
  );
}

interface ReviewDrawerProps {
  group: AdminReservation[];
  resources: Resource[];
  onClose: () => void;
  onDone: (message: string) => void;
}

/**
 * Painel de análise: dados do pedido + salas ativas já ordenadas da mais para
 * a menos adequada (GET .../room-options). Aprovar aloca a sala; rejeitar pede
 * justificativa. Numa série, dá para decidir todas as datas ou uma específica.
 * Para pedidos já revisados, mostra só os dados.
 */
export function ReviewDrawer({ group, resources, onClose, onDone }: ReviewDrawerProps) {
  const toast = useToast();
  const first = group[0]!;
  const isPending = first.status === "PENDING";

  const [target, setTarget] = useState<string>(group.length > 1 ? ALL : first.id);
  const [options, setOptions] = useState<RoomOption[] | null>(null);
  const [occurrenceCount, setOccurrenceCount] = useState(0);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const scope: ReviewScope = target === ALL ? "series" : "single";
  const reservationId = target === ALL ? first.id : target;

  useEffect(() => {
    if (!isPending) return;
    setOptions(null);
    setSelectedRoomId(null);
    api<{ occurrences: unknown[]; options: RoomOption[] }>(`/admin/reservations/${reservationId}/room-options?scope=${scope}`)
      .then((res) => {
        setOptions(res.options);
        setOccurrenceCount(res.occurrences.length);
        // A API já devolve a mais adequada primeiro; só pré-seleciona se ela for utilizável.
        const best = res.options[0];
        if (best && best.fitsCapacity && best.conflictingDates.length < res.occurrences.length) setSelectedRoomId(best.room.id);
      })
      .catch((e: Error) => {
        toast.error("Não foi possível carregar as salas.", e.message);
        setOptions([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, reservationId, scope, reloadKey]);

  const selected = options?.find((o) => o.room.id === selectedRoomId) ?? null;
  const partial = selected !== null && selected.conflictingDates.length > 0;
  const freeCount = selected ? occurrenceCount - selected.conflictingDates.length : 0;
  const recommendedId = options?.find((o) => o.fitsCapacity && o.conflictingDates.length < occurrenceCount)?.room.id;
  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? "recurso removido";

  async function approve() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api<{ approved: AdminReservation[]; skipped: unknown[] }>(`/admin/reservations/${reservationId}/approve`, {
        method: "POST",
        body: JSON.stringify({ roomId: selected.room.id, scope, skipConflicting: partial }),
      });
      onDone(
        `${plural(res.approved.length, "data aprovada", "datas aprovadas")} em ${selected.room.name}` +
          (res.skipped.length > 0 ? ` · ${plural(res.skipped.length, "continua pendente", "continuam pendentes")}` : ""),
      );
    } catch (e) {
      toast.error("Não foi possível aprovar.", e instanceof Error ? e.message : undefined);
      // Conflito ou revisão simultânea: a ocupação das salas mudou, então recarrega as opções.
      if (e instanceof ApiError && e.status === 409) setReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      const res = await api<{ rejectedIds: string[] }>(`/admin/reservations/${reservationId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason, scope }),
      });
      onDone(plural(res.rejectedIds.length, "data rejeitada", "datas rejeitadas"));
    } catch (e) {
      toast.error("Não foi possível rejeitar.", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  let approveLabel = "Aprovar";
  if (selected) {
    approveLabel = occurrenceCount > 1 ? `Aprovar ${plural(freeCount, "data", "datas")}` : "Aprovar";
  }

  const footer = !isPending ? (
    <Button variant="secondary" onClick={onClose}>
      Fechar
    </Button>
  ) : mode === "reject" ? (
    <>
      <Button variant="secondary" onClick={() => setMode("approve")} disabled={busy}>
        Voltar
      </Button>
      <Button variant="danger" icon={XCircleIcon} loading={busy} disabled={!rejectReason.trim()} onClick={() => void reject()}>
        Confirmar rejeição
      </Button>
    </>
  ) : (
    <>
      <Button variant="danger-soft" icon={XCircleIcon} onClick={() => setMode("reject")} disabled={busy} className="sm:mr-auto">
        Rejeitar
      </Button>
      <Button icon={SealCheckIcon} loading={busy} disabled={!selected} onClick={() => void approve()}>
        {/* Um só nó de texto: o gap do botão não entra entre "Aprovar" e "em …". */}
        <span>
          {approveLabel}
          {selected && <span className="hidden sm:inline"> em {selected.room.name}</span>}
        </span>
      </Button>
    </>
  );

  return (
    <Dialog open variant="drawer" onClose={onClose} title={first.title} description={isPending ? "Escolha a sala e aprove, ou rejeite com uma justificativa." : "Solicitação já revisada."} footer={footer}>
      <div className="space-y-8">
        <RequestDetails group={group} resources={resources} />

        {isPending && mode === "reject" && (
          <section className="animate-fade-in space-y-3" aria-label="Rejeitar">
            <Alert tone="warning">
              {occurrenceCount > 1 ? `As ${occurrenceCount} datas selecionadas serão rejeitadas.` : "A solicitação será rejeitada."} O
              solicitante recebe a justificativa por e-mail.
            </Alert>
            <Textarea
              label="Justificativa"
              required
              autoFocus
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex.: não há sala com essa capacidade disponível nesse horário."
            />
          </section>
        )}

        {isPending && mode === "approve" && (
          <section className="space-y-4" aria-label="Alocar sala">
            {group.length > 1 && (
              <Select label="Aplicar a" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value={ALL}>Todas as {group.length} datas pendentes da série</option>
                {group.map((r) => (
                  <option key={r.id} value={r.id}>
                    Só {formatDateTimeRange(r.startTime, r.endTime)}
                  </option>
                ))}
              </Select>
            )}

            <div>
              <h3 className="text-base font-semibold">Escolha a sala</h3>
              <p className="text-sm text-muted">Ordenadas da mais para a menos adequada.</p>
            </div>

            {options === null ? (
              <div className="space-y-2" role="status" aria-label="Carregando salas">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : options.length === 0 ? (
              <Alert tone="warning">Nenhuma sala ativa cadastrada.</Alert>
            ) : (
              <div role="radiogroup" aria-label="Sala" className="space-y-2">
                {options.map((option) => {
                  const conflicts = option.conflictingDates.length;
                  const allBusy = conflicts >= occurrenceCount;
                  const disabled = !option.fitsCapacity || allBusy;
                  const isSelected = selectedRoomId === option.room.id;
                  return (
                    <label
                      key={option.room.id}
                      className={cn(
                        "flex gap-3 rounded-xl border p-3.5 transition-[border-color,background-color] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        isSelected ? "border-primary bg-primary-soft/50" : "border-border",
                        disabled ? "cursor-not-allowed opacity-55" : !isSelected && "hover:border-border-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name={`sala-${first.id}`}
                        className="sr-only"
                        disabled={disabled}
                        checked={isSelected}
                        onChange={() => setSelectedRoomId(option.room.id)}
                      />
                      <IconTile icon={ROOM_TYPE_ICONS[option.room.roomType]} size="sm" tone={isSelected ? "primary" : "neutral"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{option.room.name}</p>
                          {option.room.id === recommendedId && (
                            <Badge tone="primary" icon={SparkleIcon}>
                              Recomendada
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted">
                          {option.room.building}, {option.room.floor} · {ROOM_TYPE_LABELS[option.room.roomType]} · até {option.room.capacity}
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                          {option.fitsCapacity ? (
                            <Check state="ok">Comporta {first.expectedAttendees}</Check>
                          ) : (
                            <Check state="bad">
                              Comporta só {option.room.capacity} (pedido: {first.expectedAttendees})
                            </Check>
                          )}
                          {conflicts === 0 ? (
                            <Check state="ok">{occurrenceCount > 1 ? "Livre em todas as datas" : "Livre no horário"}</Check>
                          ) : occurrenceCount === 1 ? (
                            <Check state="bad">Ocupada no horário</Check>
                          ) : (
                            <Check state={allBusy ? "bad" : "warn"}>
                              Ocupada em {conflicts} de {occurrenceCount} ({option.conflictingDates.map(formatShortDate).join(", ")})
                            </Check>
                          )}
                          {option.missingResources.map((m) => (
                            <Check key={m.resourceId} state="warn">
                              {m.available === 0
                                ? `Sem ${resourceName(m.resourceId)}`
                                : `${resourceName(m.resourceId)}: só ${m.available} (pedido: ${m.requested})`}
                            </Check>
                          ))}
                        </ul>
                      </div>
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 size-5 shrink-0 rounded-full border-2 transition-colors",
                          isSelected ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--surface)]" : "border-border-strong",
                        )}
                      />
                    </label>
                  );
                })}
              </div>
            )}

            {partial && (
              <Alert tone="warning">
                {plural(selected.conflictingDates.length, "data já está ocupada", "datas já estão ocupadas")} nesta sala e vai continuar
                pendente — dá para alocar em outra sala depois.
              </Alert>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
