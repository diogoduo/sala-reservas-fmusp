import {
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  PencilSimpleLineIcon,
  SealCheckIcon,
  SparkleIcon,
  WarningIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ACTIVITY_TYPE_LABELS, activityDetailRows, PRIORITY_LABELS, priorityOf } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDateTimeRange, formatShortDate, formatTimeRange, plural } from "../../lib/format";
import { activityStart, formatMinutes } from "../../lib/reservations";
import { useToast } from "../../lib/toast";
import { RESERVATION_STATUS_LABELS, ROOM_TYPE_LABELS } from "../../lib/types";
import type { AdminReservation, ApprovalChecklist, RequestedResource, Resource, ReviewScope, RoomOption } from "../../lib/types";
import { FeeEstimate } from "../solicitante/FeeEstimate";
import { NoShowButton } from "./ReservationActions";
import { RequesterStanding } from "./RequesterStanding";
import { StatusBadge } from "../StatusBadge";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { RoomThumb } from "../rooms/RoomPhotos";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, Skeleton } from "../ui/Feedback";
import { Select, Textarea } from "../ui/Field";

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
export function RequestDetails({ group, resources }: { group: AdminReservation[]; resources: Resource[] }) {
  const first = group[0]!;
  const rooms = [...new Set(group.flatMap((r) => (r.room ? [`${r.room.name} — ${r.room.building}, ${r.room.floor}`] : [])))];
  const priority = priorityOf(first.activityType, first.activityDetails);
  const checklist = first.approvalChecklist;
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

      <RequesterStanding userId={first.user.id} />

      {first.previousSnapshot && first.modifiedByRequesterAt && first.status === "PENDING" && (
        <ChangeSummary reservation={first} />
      )}

      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
        <DetailRow label="Protocolo">
          <span className="font-semibold tabular-nums">{first.protocol}</span>
        </DetailRow>
        {first.activityType && <DetailRow label="Atividade">{ACTIVITY_TYPE_LABELS[first.activityType]}</DetailRow>}
        <DetailRow label="Prioridade">
          {priority}ª — {PRIORITY_LABELS[priority]} <span className="text-muted">(Art. 7º)</span>
        </DetailRow>
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
        {first.setupMinutes > 0 && (
          <DetailRow label="Montagem">
            {formatMinutes(first.setupMinutes)} antes da atividade, que começa às{" "}
            {activityStart(first).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} (Art. 19; equipe técnica obrigatória)
          </DetailRow>
        )}
        {first.outsideRegularHours && (
          <DetailRow label="Horário">Extraordinário — domingo, feriado ou fora das 07h–22h (Art. 6º §1º)</DetailRow>
        )}
        {first.coffeeBreak && <DetailRow label="Coffee break">Sim — só em sala que permite (Portaria 2794, Art. 5º)</DetailRow>}
        <DetailRow label="Bebidas alcoólicas">
          {first.noAlcoholCommitment ? "Compromisso de não haver comércio nem consumo assumido (Art. 23)" : "Pedido anterior às portarias de 2026"}
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
        {checklist && (
          <DetailRow label="Conferência">
            {[
              checklist.ccexAuthorized && "autorização da CCEx",
              checklist.academicDivisionApproved && "aprovação da Divisão Acadêmica",
              checklist.feeSettled && "taxa paga ou isenção",
              checklist.directorateHomologated && "homologação da Diretoria",
            ]
              .filter(Boolean)
              .join("; ")}
          </DetailRow>
        )}
        {first.noShowAt && (
          <DetailRow label="Ausência">
            Registrada em {new Date(first.noShowAt).toLocaleString("pt-BR")}
            {first.noShowBy ? ` por ${first.noShowBy.name}` : ""} (Art. 9º §2º)
          </DetailRow>
        )}
        {first.cancelledAt && (
          <DetailRow label="Cancelada em">
            {new Date(first.cancelledAt).toLocaleString("pt-BR")}
            {first.cancelledBy && first.cancelledBy.id !== first.user.id ? ` pelo SAD (${first.cancelledBy.name})` : " pelo solicitante"}
          </DetailRow>
        )}
        {first.cancellationReason && <DetailRow label="Motivo">{first.cancellationReason}</DetailRow>}
        {first.modifiedByAdminAt && (
          <DetailRow label="Alterada pelo SAD">{new Date(first.modifiedByAdminAt).toLocaleString("pt-BR")}</DetailRow>
        )}
        <DetailRow label="Enviada em">{new Date(first.createdAt).toLocaleString("pt-BR")}</DetailRow>
      </dl>
    </section>
  );
}

/** Antes × depois de uma reserva alterada pelo solicitante. */
function ChangeSummary({ reservation: r }: { reservation: AdminReservation }) {
  const before = r.previousSnapshot!;
  const rows: { label: string; before: string; after: string }[] = [
    {
      label: "Data e horário",
      before: formatDateTimeRange(before.startTime, before.endTime),
      after: formatDateTimeRange(r.startTime, r.endTime),
    },
    { label: "Participantes", before: String(before.expectedAttendees), after: String(r.expectedAttendees) },
    { label: "Sala", before: before.roomName ?? "—", after: "a definir" },
    { label: "Status", before: RESERVATION_STATUS_LABELS[before.status], after: "Pendente" },
  ];
  return (
    <div className="rounded-xl border border-info-foreground/25 bg-info-soft p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-info-foreground">
        <PencilSimpleLineIcon size={18} weight="fill" aria-hidden />
        Alterada pelo solicitante em {new Date(r.modifiedByRequesterAt!).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
      </p>
      <table className="mt-3 w-full text-left">
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="pb-1 font-medium">
              <span className="sr-only">Campo</span>
            </th>
            <th scope="col" className="pb-1 font-medium">Antes</th>
            <th scope="col" className="pb-1 font-medium">Agora</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const changed = row.before !== row.after;
            return (
              <tr key={row.label} className="align-top">
                <th scope="row" className="py-1 pr-3 font-normal text-muted">
                  {row.label}
                </th>
                <td className={cn("py-1 pr-3", changed && "text-muted line-through decoration-muted/50")}>{row.before}</td>
                <td className={cn("py-1", changed && "font-semibold")}>{row.after}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  /** Recarregar a lista depois de registrar uma ausência (pedidos já revisados). */
  onChanged?: () => void;
}

/**
 * Painel de análise: dados do pedido + salas ativas já ordenadas da mais para
 * a menos adequada (GET .../room-options). Aprovar aloca a sala; rejeitar pede
 * justificativa. Numa série, dá para decidir todas as datas ou uma específica.
 * Para pedidos já revisados, mostra só os dados.
 */
export function ReviewDrawer({ group, resources, onClose, onDone, onChanged }: ReviewDrawerProps) {
  const toast = useToast();
  const first = group[0]!;
  const isPending = first.status === "PENDING";

  const [target, setTarget] = useState<string>(group.length > 1 ? ALL : first.id);
  const [options, setOptions] = useState<RoomOption[] | null>(null);
  const [occurrenceCount, setOccurrenceCount] = useState(0);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [rejectReason, setRejectReason] = useState("");
  // Cultura e Extensão: etapas do Art. 20 §3º e taxa (Art. 14 §3º / Art. 21 §2º) antes de confirmar.
  const needsChecklist = first.activityType === "CULTURE_EXTENSION";
  const [checklist, setChecklist] = useState<ApprovalChecklist>({
    ccexAuthorized: false,
    academicDivisionApproved: false,
    feeSettled: false,
    directorateHomologated: false,
  });
  const checklistOk = !needsChecklist || (checklist.ccexAuthorized && checklist.academicDivisionApproved && checklist.feeSettled);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const scope: ReviewScope = target === ALL ? "series" : "single";
  const previousRoomId = first.previousSnapshot?.roomId ?? null;
  const reservationId = target === ALL ? first.id : target;

  useEffect(() => {
    if (!isPending) return;
    setOptions(null);
    setSelectedRoomId(null);
    api<{ occurrences: unknown[]; options: RoomOption[] }>(`/admin/reservations/${reservationId}/room-options?scope=${scope}`)
      .then((res) => {
        setOptions(res.options);
        setOccurrenceCount(res.occurrences.length);
        // Numa alteração, se a sala em que estava aprovada ainda serve, ela vem marcada;
        // senão, a mais adequada (a API já devolve essa primeiro).
        const usable = (o: RoomOption) => o.fitsCapacity && o.coffeeBreakAllowed && o.conflictingDates.length < res.occurrences.length;
        const previous = res.options.find((o) => o.room.id === previousRoomId && usable(o));
        const best = res.options[0];
        if (previous) setSelectedRoomId(previous.room.id);
        else if (best && usable(best)) setSelectedRoomId(best.room.id);
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
  const recommendedId = options?.find((o) => o.fitsCapacity && o.coffeeBreakAllowed && o.conflictingDates.length < occurrenceCount)?.room.id;
  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? "recurso removido";

  async function approve() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api<{ approved: AdminReservation[]; skipped: unknown[] }>(`/admin/reservations/${reservationId}/approve`, {
        method: "POST",
        body: JSON.stringify({
          roomId: selected.room.id,
          scope,
          skipConflicting: partial,
          approvalChecklist: needsChecklist ? checklist : undefined,
        }),
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
    <>
      {onChanged && <NoShowButton reservation={first} onChanged={onChanged} />}
      <Button variant="secondary" onClick={onClose}>
        Fechar
      </Button>
    </>
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
      <Button icon={SealCheckIcon} loading={busy} disabled={!selected || !checklistOk} onClick={() => void approve()}>
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
                  const disabled = !option.fitsCapacity || !option.coffeeBreakAllowed || allBusy;
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
                      <RoomThumb room={option.room} size="sm" tone={isSelected ? "primary" : "neutral"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{option.room.name}</p>
                          {option.room.id === recommendedId && (
                            <Badge tone="primary" icon={SparkleIcon}>
                              Recomendada
                            </Badge>
                          )}
                          {option.room.id === previousRoomId && (
                            <Badge tone="info" icon={ClockCounterClockwiseIcon}>
                              Sala anterior
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
                              Comporta só {option.room.capacity} (pedido: {first.expectedAttendees}; sem cadeiras extras)
                            </Check>
                          )}
                          {!option.coffeeBreakAllowed && <Check state="bad">Coffee break não permitido</Check>}
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

            {needsChecklist && first.activityDetails && (
              <div className="space-y-4 rounded-xl border border-border p-4">
                <div>
                  <h3 className="text-base font-semibold">Antes de confirmar</h3>
                  <p className="text-sm text-muted">Atividade de Cultura e Extensão (Portaria 2793, Art. 20 §3º, Art. 14 §3º e Art. 21 §2º).</p>
                </div>
                <FeeEstimate
                  type="CULTURE_EXTENSION"
                  details={first.activityDetails}
                  reservedMinutes={(new Date(first.endTime).getTime() - new Date(first.startTime).getTime()) / 60_000}
                  dates={Math.max(occurrenceCount, 1)}
                  firstDate={new Date(first.startTime)}
                  coffeeBreak={first.coffeeBreak}
                  room={selected?.room ?? null}
                  compact
                />
                <div className="space-y-2.5 text-sm">
                  {(
                    [
                      ["ccexAuthorized", "Autorização da CCEx conferida (Art. 20 §3º, a)", true],
                      ["academicDivisionApproved", "Aprovação da Divisão Acadêmica (Art. 20 §3º, c)", true],
                      ["feeSettled", "Comprovante de pagamento da taxa entregue ao SAD/NE, ou atividade isenta", true],
                      ["directorateHomologated", "Homologação da Diretoria, quando aplicável (Art. 20 §3º, d)", false],
                    ] as [keyof ApprovalChecklist, string, boolean][]
                  ).map(([key, label, required]) => (
                    <label key={key} className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0"
                        checked={Boolean(checklist[key])}
                        onChange={(e) => setChecklist((c) => ({ ...c, [key]: e.target.checked }))}
                      />
                      <span>
                        {label}
                        {!required && <span className="text-muted"> — opcional</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
