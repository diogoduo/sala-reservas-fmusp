import {
  ArrowSquareOutIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  DoorOpenIcon,
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
  ProhibitIcon,
  StampIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/cn";
import {
  AUTHORIZATION_LABELS,
  businessDaysFromToday,
  dateTimeText,
  dayLabel,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_TONES,
  spaceText,
  type CandidateSpace,
  type EventManagement,
  type EventQuoteRow,
  type EventRequest,
  type EventStatus,
} from "../../lib/events";
import { ROLE_LABELS, type UserRole } from "../../lib/permissions";
import { formatDateKey } from "../../lib/prices";
import { useToast } from "../../lib/toast";
import type { QuoteEstimate } from "../../lib/types";
import { QuoteBreakdown } from "../quotes/QuoteBreakdown";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert } from "../ui/Feedback";
import { Input, Switch, Textarea } from "../ui/Field";
import { Card } from "../ui/Surface";

// Fase 12 — gestão do evento. NUCEV: análise, orçamento, Diretoria, recusa.
// SAD: salas e pré-reserva (com a validade que ele define), liberar, cancelar.
// Solicitante: responde ao orçamento. Todos: a conversa.

const CLOSED: EventStatus[] = ["CANCELLED", "REJECTED", "EXPIRED"];
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** O próximo passo, para a equipe. */
const NEXT_STEP: Partial<Record<EventStatus, string>> = {
  SUBMITTED: "NUCEV: inicie a análise.",
  IN_REVIEW: "SAD: escolha as salas e faça a pré-reserva. NUCEV: confira o pedido e, se precisar, peça a autorização da Diretoria.",
  PRE_RESERVED: "NUCEV: emita o orçamento das salas pré-reservadas.",
  QUOTE_SENT: "Aguardando o solicitante responder ao orçamento.",
  CHANGES_REQUESTED: "O solicitante pediu alteração: SAD revisa as salas, NUCEV emite uma nova versão.",
  QUOTE_APPROVED: "Orçamento aprovado: aguardando o pagamento.",
  PAYMENT_SUBMITTED: "NUCEV: confira o comprovante.",
  PAYMENT_VALIDATED: "SAD: confirme a reserva.",
};

function ReasonDialog({
  title,
  description,
  label,
  confirmLabel,
  danger,
  optional,
  onClose,
  onSubmit,
}: {
  title: string;
  description?: string;
  label: string;
  confirmLabel: string;
  danger?: boolean;
  optional?: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const formId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button type="submit" form={formId} variant={danger ? "danger" : "primary"} loading={busy} disabled={!optional && !text.trim()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <Textarea label={label} required={!optional} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </Dialog>
  );
}

/** O SAD escolhe as salas de cada pedido e a validade da pré-reserva. */
function PreReserveDialog({ event, onClose, onDone }: { event: EventRequest; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [spaces, setSpaces] = useState<CandidateSpace[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [validUntil, setValidUntil] = useState(businessDaysFromToday(5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ spaces: CandidateSpace[] }>(`/events/${event.id}/candidates`)
      .then((res) => {
        setSpaces(res.spaces);
        // Começa com as salas já pré-reservadas ou, sem elas, as primeiras livres.
        setChosen(
          Object.fromEntries(
            res.spaces.map((s) => {
              const selected = s.rooms.filter((r) => r.selected).map((r) => r.id);
              return [s.spaceId, selected.length > 0 ? selected : s.rooms.filter((r) => r.busyDates.length === 0).slice(0, s.needed).map((r) => r.id)];
            }),
          ),
        );
      })
      .catch((e) => setError(errorText(e, "Não foi possível carregar as salas.")));
  }, [event.id]);

  const toggle = (spaceId: string, roomId: string) =>
    setChosen((c) => ({ ...c, [spaceId]: c[spaceId]?.includes(roomId) ? c[spaceId]!.filter((x) => x !== roomId) : [...(c[spaceId] ?? []), roomId] }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/events/${event.id}/pre-reserve`, {
        method: "POST",
        body: JSON.stringify({ validUntil, allocations: Object.entries(chosen).map(([spaceId, roomIds]) => ({ spaceId, roomIds })) }),
      });
      toast.success("Espaços pré-reservados", `Válida até ${formatDateKey(validUntil)}.`);
      onDone();
    } catch (e) {
      setError(errorText(e, "Não foi possível pré-reservar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      variant="drawer"
      onClose={onClose}
      title="Escolher salas e pré-reservar"
      description="As salas ficam bloqueadas até a validade. Sem pagamento até lá, o sistema libera sozinho."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button icon={DoorOpenIcon} loading={busy} disabled={!spaces || Object.values(chosen).every((ids) => ids.length === 0)} onClick={() => void submit()}>
            Pré-reservar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Input
          label="Pré-reserva válida até"
          type="date"
          min={new Date().toLocaleDateString("en-CA")}
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          hint="Sugestão: 5 dias úteis. O SAD define o prazo de cada evento."
          containerClassName="sm:max-w-xs"
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {!spaces ? (
          <p className="text-sm text-muted">Carregando as salas…</p>
        ) : (
          spaces.map((s) => {
            const request = event.spaces.find((x) => x.id === s.spaceId)!;
            const ids = chosen[s.spaceId] ?? [];
            return (
              <section key={s.spaceId} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {spaceText(request)}
                    {request.purpose && <span className="font-normal text-muted"> · {request.purpose}</span>}
                  </h3>
                  <span className={cn("text-xs font-medium tabular-nums", ids.length >= s.needed ? "text-success-foreground" : "text-warning-foreground")}>
                    {ids.length} de {s.needed} escolhida{s.needed === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="text-xs text-muted">{s.dates.map(dayLabel).join(", ")}</p>
                {s.rooms.length === 0 ? (
                  <Alert tone="warning">Nenhuma sala ativa serve para este pedido.</Alert>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {s.rooms.map((r) => {
                      const busyRoom = r.busyDates.length > 0;
                      return (
                        <li key={r.id}>
                          <label className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", busyRoom ? "opacity-60" : "cursor-pointer")}>
                            <input
                              type="checkbox"
                              disabled={busyRoom}
                              checked={ids.includes(r.id)}
                              onChange={() => toggle(s.spaceId, r.id)}
                              className="size-4 accent-[var(--primary)]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{r.name}</span>
                              <span className="text-muted">
                                {" "}
                                · {r.building}, {r.floor} · {r.capacity === null ? "sem limite cadastrado" : `${r.capacity} lugares`}
                              </span>
                              {r.requiresBoardApproval && <span className="block text-xs text-warning-foreground">Exige autorização da Diretoria</span>}
                            </span>
                            {busyRoom && <Badge tone="danger">Ocupada {r.busyDates.map(dayLabel).join(", ")}</Badge>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </Dialog>
  );
}

/** O NUCEV confere o cálculo (das salas pré-reservadas), marca a isenção se houver e envia. */
function QuoteDialog({ event, possiblyExempt, onClose, onDone }: { event: EventRequest; possiblyExempt: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [exempt, setExempt] = useState(false);
  const [reason, setReason] = useState(possiblyExempt ? "Evento institucional da FMUSP, sem inscrição e sem patrocínio (Portaria 2794, Art. 4º I)." : "");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<QuoteEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exemptionReason = exempt && reason.trim() ? reason.trim() : undefined;

  useEffect(() => {
    setPreview(null);
    api<QuoteEstimate>(`/events/${event.id}/quotes/preview`, { method: "POST", body: JSON.stringify({ exemptionReason }) })
      .then(setPreview)
      .catch((e) => setError(errorText(e, "Não foi possível calcular.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, exemptionReason]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/events/${event.id}/quotes`, { method: "POST", body: JSON.stringify({ exemptionReason, notes: notes.trim() || undefined }) });
      toast.success("Orçamento enviado", "O solicitante foi avisado.");
      onDone();
    } catch (e) {
      setError(errorText(e, "Não foi possível enviar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      variant="drawer"
      onClose={onClose}
      title="Emitir orçamento"
      description="Calculado pela Portaria 2794 sobre as salas pré-reservadas (sem pré-reserva, sobre o que foi pedido). Cada envio vira uma versão."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button icon={PaperPlaneTiltIcon} loading={busy} disabled={!preview || (exempt && !reason.trim())} onClick={() => void send()}>
            Enviar ao solicitante
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border border-border p-4">
          <Switch checked={exempt} onChange={setExempt} label="Isento" description="Portaria 2794, Art. 4º I e II. O total fica zerado e o motivo vai para o solicitante." />
          {exempt && <Textarea label="Motivo da isenção" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </div>
        {possiblyExempt && !exempt && <Alert tone="info">Evento da FMUSP sem inscrição e sem patrocínio: pode ser isento (Art. 4º I).</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {preview ? <QuoteBreakdown estimate={preview} /> : <p className="text-sm text-muted">Calculando…</p>}
        <Textarea label="Observações para o solicitante" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: valores da equipe técnica de áudio e vídeo à parte." />
      </div>
    </Dialog>
  );
}

type Dialogs = "prereserve" | "quote" | "release" | "reject" | "cancel" | "authorization" | null;

/** Ações da equipe, conforme a situação e o papel. */
export function StaffActions({
  event,
  management,
  possiblyExempt,
  onChanged,
}: {
  event: EventRequest;
  management: EventManagement;
  possiblyExempt: boolean;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const sad = user?.role === "ADMIN";
  const nucev = user?.role === "NUCEV" || sad;
  const s = event.status;
  const closed = CLOSED.includes(s) || s === "CONFIRMED";
  const hasReservations = management.reservations.length > 0;
  // Átrios e outros espaços marcados no cadastro: pedidos pelo nome ou pré-reservados.
  const boardNeeded = event.spaces.some((x) => x.room?.requiresBoardApproval) || management.reservations.some((r) => r.room?.requiresBoardApproval);
  const boardOpen = management.authorizations.some((a) => a.status !== "DENIED");

  async function post(path: string, body: unknown, success: string) {
    setBusy(true);
    try {
      await api(`/events/${event.id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      toast.success(success, event.protocol);
      setDialog(null);
      onChanged();
    } catch (e) {
      toast.error("Não foi possível concluir.", errorText(e, ""));
    } finally {
      setBusy(false);
    }
  }

  const done = () => {
    setDialog(null);
    onChanged();
  };

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-base font-semibold">Gestão</h2>
        <p className="text-sm text-muted">{NEXT_STEP[s] ?? "Sem ações pendentes."}</p>
        {event.assigneeName && <p className="mt-1 text-xs text-muted">Responsável no NUCEV: {event.assigneeName}</p>}
      </div>
      <div className="flex flex-col gap-2">
        {nucev && (s === "SUBMITTED" || s === "CHANGES_REQUESTED") && (
          <Button loading={busy} onClick={() => void post("review", {}, "Análise iniciada")}>
            Iniciar análise
          </Button>
        )}
        {sad && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "PRE_RESERVED", "QUOTE_SENT", "QUOTE_APPROVED"].includes(s) && (
          <Button variant={s === "IN_REVIEW" || s === "CHANGES_REQUESTED" ? "primary" : "secondary"} icon={DoorOpenIcon} onClick={() => setDialog("prereserve")}>
            {hasReservations ? "Refazer a pré-reserva" : "Escolher salas e pré-reservar"}
          </Button>
        )}
        {nucev && ["IN_REVIEW", "PRE_RESERVED", "CHANGES_REQUESTED", "QUOTE_SENT"].includes(s) && (
          <Button variant={s === "PRE_RESERVED" ? "primary" : "secondary"} icon={PaperPlaneTiltIcon} onClick={() => setDialog("quote")}>
            {management.quotes.length > 0 ? "Emitir nova versão do orçamento" : "Emitir orçamento"}
          </Button>
        )}
        {nucev && !closed && boardNeeded && !boardOpen && (
          <Button variant="secondary" icon={StampIcon} onClick={() => setDialog("authorization")}>
            Pedir autorização da Diretoria
          </Button>
        )}
        {sad && hasReservations && ["PRE_RESERVED", "QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED"].includes(s) && (
          <Button variant="ghost" onClick={() => setDialog("release")}>
            Liberar a pré-reserva
          </Button>
        )}
        {nucev && !closed && !["PAYMENT_SUBMITTED", "PAYMENT_VALIDATED"].includes(s) && (
          <Button variant="ghost" icon={XCircleIcon} onClick={() => setDialog("reject")}>
            Recusar o pedido
          </Button>
        )}
        {sad && !CLOSED.includes(s) && (
          <Button variant="ghost" icon={ProhibitIcon} onClick={() => setDialog("cancel")}>
            Cancelar o evento
          </Button>
        )}
      </div>

      {dialog === "prereserve" && <PreReserveDialog event={event} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "quote" && <QuoteDialog event={event} possiblyExempt={possiblyExempt} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "release" && (
        <ReasonDialog
          title="Liberar a pré-reserva?"
          description="As salas ficam livres e o evento volta para a análise."
          label="Motivo"
          confirmLabel="Liberar"
          danger
          onClose={() => setDialog(null)}
          onSubmit={(reason) => post("release", { reason }, "Pré-reserva liberada")}
        />
      )}
      {dialog === "reject" && (
        <ReasonDialog
          title="Recusar o pedido?"
          description="O solicitante recebe o motivo, e as salas pré-reservadas são liberadas."
          label="Motivo"
          confirmLabel="Recusar"
          danger
          onClose={() => setDialog(null)}
          onSubmit={(reason) => post("reject", { reason }, "Pedido recusado")}
        />
      )}
      {dialog === "cancel" && (
        <ReasonDialog
          title="Cancelar o evento?"
          description="As salas são liberadas e o solicitante recebe o motivo."
          label="Motivo"
          confirmLabel="Cancelar o evento"
          danger
          onClose={() => setDialog(null)}
          onSubmit={(reason) => post("staff-cancel", { reason }, "Evento cancelado")}
        />
      )}
      {dialog === "authorization" && (
        <ReasonDialog
          title="Pedir autorização da Diretoria Executiva"
          description="A Diretoria recebe um e-mail com o evento e um link para autorizar ou negar, sem precisar entrar no sistema."
          label="Observação para a Diretoria"
          confirmLabel="Enviar pedido"
          optional
          onClose={() => setDialog(null)}
          onSubmit={(note) => post("authorization", { note: note || undefined }, "Pedido enviado à Diretoria")}
        />
      )}
    </Card>
  );
}

/** As salas pré-reservadas (ou confirmadas), por sala. */
export function ReservedRooms({ event, management }: { event: EventRequest; management: EventManagement }) {
  if (management.reservations.length === 0) return null;
  const byRoom = new Map<string, { name: string; place: string; days: string[] }>();
  for (const r of management.reservations) {
    const key = r.room?.id ?? "?";
    const entry = byRoom.get(key) ?? { name: r.room?.name ?? "Sala removida", place: r.room ? `${r.room.building}, ${r.room.floor}` : "", days: [] };
    entry.days.push(`${dayLabel(r.date)} ${r.start}–${r.end}`);
    byRoom.set(key, entry);
  }
  const until = event.preReservedUntil;
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{event.status === "CONFIRMED" ? "Salas reservadas" : "Salas pré-reservadas"}</h2>
        {until && event.status !== "CONFIRMED" && <Badge tone="warning">Válida até {new Date(until).toLocaleDateString("pt-BR")}</Badge>}
      </div>
      <p className="text-sm text-muted">
        {event.status === "CONFIRMED" ? "Reserva confirmada." : "Bloqueadas para o evento. A reserva só fica confirmada depois do pagamento validado."}
      </p>
      <ul className="mt-3 divide-y divide-border">
        {[...byRoom.values()].map((room) => (
          <li key={room.name} className="py-2.5 text-sm">
            <p className="font-medium">
              {room.name} <span className="font-normal text-muted">· {room.place}</span>
            </p>
            <p className="text-muted">{room.days.join(" · ")}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** O orçamento emitido (a versão mais recente) e a resposta de quem pediu. */
export function QuotePanel({ event, quotes, onChanged }: { event: EventRequest; quotes: EventQuoteRow[]; onChanged: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [dialog, setDialog] = useState<"CHANGES" | "REJECT" | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = quotes[0];
  if (!latest) return null;
  const canAnswer = event.userId === user?.id && event.status === "QUOTE_SENT" && latest.status === "SENT";

  async function decide(decision: "APPROVE" | "CHANGES" | "REJECT", note?: string) {
    setBusy(true);
    try {
      await api(`/events/${event.id}/quotes/${latest!.id}/decision`, { method: "POST", body: JSON.stringify({ decision, note }) });
      toast.success(decision === "APPROVE" ? "Orçamento aprovado" : decision === "CHANGES" ? "Alteração pedida" : "Orçamento recusado", event.protocol);
      setDialog(null);
      onChanged();
    } catch (e) {
      toast.error("Não foi possível responder.", errorText(e, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Orçamento · versão {latest.version}</h2>
        <Badge tone={QUOTE_STATUS_TONES[latest.status]}>{QUOTE_STATUS_LABELS[latest.status]}</Badge>
      </div>
      <p className="text-xs text-muted">
        Enviado em {dateTimeText(latest.createdAt)}
        {latest.createdByName ? ` por ${latest.createdByName}` : ""}
      </p>
      <QuoteBreakdown estimate={latest.estimate} />
      {latest.notes && <p className="text-sm whitespace-pre-line text-muted">Observações: {latest.notes}</p>}
      {latest.decisionNote && (
        <p className="text-sm text-muted">
          Resposta{latest.decidedByName ? ` de ${latest.decidedByName}` : ""}: {latest.decisionNote}
        </p>
      )}
      {canAnswer && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Button icon={CheckCircleIcon} loading={busy} onClick={() => void decide("APPROVE")}>
            Aprovar o orçamento
          </Button>
          <Button variant="secondary" onClick={() => setDialog("CHANGES")}>
            Pedir alteração
          </Button>
          <Button variant="ghost" onClick={() => setDialog("REJECT")}>
            Recusar
          </Button>
        </div>
      )}
      {quotes.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">Versões anteriores</summary>
          <ul className="mt-2 space-y-1">
            {quotes.slice(1).map((q) => (
              <li key={q.id} className="flex justify-between gap-2 text-muted">
                <span>
                  Versão {q.version} · {dateTimeText(q.createdAt)} · {QUOTE_STATUS_LABELS[q.status]}
                </span>
                <span className="tabular-nums">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(q.totalCents / 100)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {dialog === "CHANGES" && (
        <ReasonDialog
          title="Pedir alteração no orçamento"
          description="Diga o que precisa mudar (espaços, datas, valores). O NUCEV e o SAD revisam e enviam uma nova versão."
          label="O que precisa mudar"
          confirmLabel="Enviar pedido de alteração"
          onClose={() => setDialog(null)}
          onSubmit={(note) => decide("CHANGES", note)}
        />
      )}
      {dialog === "REJECT" && (
        <ReasonDialog
          title="Recusar o orçamento?"
          description="O pedido de evento é cancelado e as salas pré-reservadas são liberadas."
          label="Motivo (opcional)"
          confirmLabel="Recusar e cancelar"
          danger
          optional
          onClose={() => setDialog(null)}
          onSubmit={(note) => decide("REJECT", note || undefined)}
        />
      )}
    </Card>
  );
}

/** Pedidos de autorização à Diretoria Executiva e as respostas. */
export function AuthorizationPanel({ management }: { management: EventManagement }) {
  const latest = management.authorizations[0];
  if (!latest) return null;
  const tone = latest.status === "AUTHORIZED" ? "success" : latest.status === "DENIED" ? "danger" : "warning";
  return (
    <Card className="space-y-2 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Autorização da Diretoria</h2>
        <Badge tone={tone}>{AUTHORIZATION_LABELS[latest.status]}</Badge>
      </div>
      <p className="text-sm text-muted">
        {latest.spaces} · pedido em {dateTimeText(latest.requestedAt)}
        {latest.requestedByName ? ` por ${latest.requestedByName}` : ""}
      </p>
      {latest.respondedAt && (
        <p className="text-sm">
          Resposta em {dateTimeText(latest.respondedAt)}
          {latest.responseNote ? `: ${latest.responseNote}` : "."}
        </p>
      )}
    </Card>
  );
}

/** Conversa do evento: solicitante, SAD e NUCEV. */
export function Conversation({ event, management, onChanged }: { event: EventRequest; management: EventManagement; onChanged: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api(`/events/${event.id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      setBody("");
      onChanged();
    } catch (err) {
      toast.error("Não foi possível enviar.", errorText(err, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <ChatCircleTextIcon size={20} aria-hidden /> Conversa
      </h2>
      <p className="text-sm text-muted">Entre quem pediu, o SAD e o NUCEV. Cada mensagem avisa o outro lado por e-mail.</p>
      {management.messages.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nenhuma mensagem ainda.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {management.messages.map((m) => {
            const mine = m.authorId === user?.id;
            return (
              <li key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
                <Avatar name={m.authorName} size="sm" />
                <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm", mine ? "bg-primary-soft" : "bg-surface-muted")}>
                  <p className="text-xs text-muted">
                    {m.authorName} · {m.authorRole === "USER" ? "Solicitante" : ROLE_LABELS[m.authorRole as UserRole]} · {dateTimeText(m.createdAt)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line">{m.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={send} className="mt-4 space-y-2">
        <Textarea aria-label="Mensagem" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva uma mensagem" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" icon={PaperPlaneTiltIcon} loading={busy} disabled={!body.trim()}>
            Enviar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** E-mails do evento: o que foi (ou, com o e-mail desligado, seria) enviado. */
export function NoticesPanel({ management }: { management: EventManagement }) {
  if (management.notices.length === 0) return null;
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <EnvelopeSimpleIcon size={20} aria-hidden /> E-mails do evento
      </h2>
      <p className="text-sm text-muted">O que o sistema enviou. Na demonstração, o envio está desligado e o e-mail fica registrado aqui.</p>
      <ul className="mt-3 divide-y divide-border">
        {management.notices.map((n) => (
          <li key={n.id} className="py-2.5 text-sm">
            <details>
              <summary className="cursor-pointer list-none">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{n.subject}</span>
                  <Badge tone={n.sentAt ? "success" : "neutral"}>{n.sentAt ? "Enviado" : "Registrado"}</Badge>
                </span>
                <span className="block text-xs text-muted">
                  Para {n.to.join(", ")} · {dateTimeText(n.createdAt)}
                </span>
              </summary>
              <p className="mt-2 rounded-xl bg-surface-muted p-3 whitespace-pre-line text-muted">{n.body}</p>
            </details>
            {n.link && (
              <a href={n.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Abrir o link do e-mail <ArrowSquareOutIcon size={14} aria-hidden />
              </a>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
