import { ArrowLeftIcon, CoffeeIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { CULTURE_KIND_LABELS, ORGANIZER_ENTITY_LABELS } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useConfirm } from "../../lib/confirm";
import {
  dayLabel,
  EVENT_STATUS_HINTS,
  EVENT_STATUS_TONES,
  eventPeriod,
  eventStatusText,
  spaceText,
  type EventManagement,
  type EventRequest,
  type EventStatus,
} from "../../lib/events";
import { isStaff } from "../../lib/permissions";
import { useToast } from "../../lib/toast";
import { QuoteBreakdown } from "../quotes/QuoteBreakdown";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Alert, CardListSkeleton } from "../ui/Feedback";
import { Card, PageHeader } from "../ui/Surface";
import { AuthorizationPanel, Conversation, NoticesPanel, QuotePanel, ReservedRooms, StaffActions } from "./EventManagement";

const REQUESTER_CANCELLABLE: EventStatus[] = ["SUBMITTED", "IN_REVIEW", "PRE_RESERVED", "QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED"];
const hoursText = (minutes: number) => `${(minutes / 60).toLocaleString("pt-BR")} h`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

interface EventResponse {
  event: EventRequest;
  possiblyExempt: boolean;
  management: EventManagement;
}

/** Um evento, para quem pediu (/eventos/:id) e para o SAD e o NUCEV (/admin/eventos/:id). */
export function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<EventResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const staff = isStaff(user?.role);

  const load = useCallback(() => {
    api<EventResponse>(`/events/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Não foi possível carregar o evento."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel() {
    if (!data) return;
    const ok = await confirm({
      tone: "danger",
      title: "Cancelar o pedido de evento?",
      description: "O NUCEV e o SAD são avisados, e as salas pré-reservadas são liberadas. Para voltar atrás, será preciso fazer um pedido novo.",
      confirmLabel: "Cancelar pedido",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      await api(`/events/${data.event.id}/cancel`, { method: "POST", body: "{}" });
      toast.success("Pedido cancelado", data.event.protocol);
      load();
    } catch (e) {
      toast.error("Não foi possível cancelar.", e instanceof ApiError ? e.message : undefined);
    }
  }

  const back = staff ? "/admin/eventos" : "/eventos";
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <CardListSkeleton />;
  const { event, management, possiblyExempt } = data;
  const mine = event.userId === user?.id;
  const quotes = management.quotes;

  return (
    <div className="space-y-6">
      <Link to={back} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeftIcon size={16} aria-hidden /> {staff ? "Eventos" : "Meus eventos"}
      </Link>
      <PageHeader
        title={event.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{event.protocol}</span> · {eventPeriod(event.days)}
            <Badge tone={EVENT_STATUS_TONES[event.status]}>{eventStatusText(event)}</Badge>
          </span>
        }
        actions={
          mine && REQUESTER_CANCELLABLE.includes(event.status) ? (
            <Button variant="secondary" icon={ProhibitIcon} onClick={() => void cancel()}>
              Cancelar pedido
            </Button>
          ) : undefined
        }
      />

      <Alert tone={event.status === "REJECTED" ? "danger" : event.status === "CANCELLED" || event.status === "EXPIRED" ? "warning" : "info"}>
        {EVENT_STATUS_HINTS[event.status]}
        {event.rejectionReason && ` Motivo: ${event.rejectionReason}`}
        {event.cancellationReason && ` Motivo: ${event.cancellationReason}`}
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4 sm:p-6">
            <h2 className="text-base font-semibold">O evento</h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <Row label="Tipo">{CULTURE_KIND_LABELS[event.kind] ?? event.kind}</Row>
              <Row label="Público previsto">{event.expectedAttendees} pessoas</Row>
              <Row label="Público-alvo">{event.targetAudience}</Row>
              <Row label="Entidade organizadora">{ORGANIZER_ENTITY_LABELS[event.entity] ?? event.entity}</Row>
              <Row label="Inscrição e patrocínio">
                {event.hasRegistrationFee ? "Cobra inscrição" : "Sem inscrição"} · {event.sponsored ? "com patrocínio" : "sem patrocínio"}
              </Row>
              <Row label="Responsável">
                {event.responsible} · {event.responsibleContact}
              </Row>
              <Row label="Departamento, setor ou entidade">{event.department}</Row>
              {staff && (
                <Row label="Pedido por">
                  {event.user.name} · {event.user.email}
                </Row>
              )}
            </dl>
            <h3 className="mt-5 text-sm font-semibold">Objetivo e programação</h3>
            <p className="mt-1 text-sm whitespace-pre-line text-muted">{event.description}</p>
          </Card>

          <Card className="p-4 sm:p-6">
            <h2 className="text-base font-semibold">Dias</h2>
            <ul className="mt-3 divide-y divide-border">
              {event.days.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2.5 text-sm">
                  <span className="font-medium capitalize">{dayLabel(d.date)}</span>
                  <span className="text-muted">
                    {d.start}–{d.end}
                    {d.setupMinutes > 0 && ` · montagem ${hoursText(d.setupMinutes)}`}
                    {d.teardownMinutes > 0 && ` · desmontagem ${hoursText(d.teardownMinutes)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4 sm:p-6">
            <h2 className="text-base font-semibold">Espaços pedidos</h2>
            <p className="text-sm text-muted">O SAD define as salas na análise.</p>
            <ul className="mt-3 divide-y divide-border">
              {event.spaces.map((s) => (
                <li key={s.id} className="py-2.5 text-sm">
                  <p className="font-medium">{spaceText(s)}</p>
                  <p className="text-muted">
                    {[s.purpose, s.dates.length > 0 ? s.dates.map(dayLabel).join(", ") : "todos os dias", s.coffeeInRoom ? "coffee na própria sala" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <ReservedRooms event={event} management={management} />

          {(event.coffeeBreak || event.infrastructure || event.notes) && (
            <Card className="space-y-3 p-4 sm:p-6">
              <h2 className="text-base font-semibold">Coffee e infraestrutura</h2>
              {event.coffeeBreak && (
                <p className="flex items-center gap-1.5 text-sm">
                  <CoffeeIcon size={16} aria-hidden /> Coffee break para {event.coffeeAttendees} pessoas
                </p>
              )}
              {event.infrastructure && <p className="text-sm whitespace-pre-line text-muted">{event.infrastructure}</p>}
              {event.notes && <p className="text-sm whitespace-pre-line text-muted">Observações: {event.notes}</p>}
            </Card>
          )}

          <Conversation event={event} management={management} onChanged={load} />
        </div>

        <div className="min-w-0 space-y-6">
          {staff && <StaffActions event={event} management={management} possiblyExempt={possiblyExempt} onChanged={load} />}
          <QuotePanel event={event} quotes={quotes} onChanged={load} />
          <AuthorizationPanel management={management} />
          {quotes.length === 0 ? (
            <Card className="p-4 sm:p-6">
              <h2 className="text-base font-semibold">Orçamento estimado</h2>
              <p className="mb-4 text-sm text-muted">Calculado no envio do pedido. O NUCEV confere e envia o orçamento oficial.</p>
              {event.estimate ? <QuoteBreakdown estimate={event.estimate} /> : <p className="text-sm text-muted">Sem estimativa: não havia tabela de preços para a data.</p>}
              {possiblyExempt && (
                <Alert tone="info" className="mt-4">
                  Evento da FMUSP sem inscrição e sem patrocínio: pode ser isento (Portaria 2794, Art. 4º I).
                </Alert>
              )}
            </Card>
          ) : (
            event.estimate && (
              <details className="rounded-2xl border border-border bg-surface p-4 text-sm">
                <summary className="cursor-pointer font-medium">Estimativa feita no envio do pedido</summary>
                <div className="mt-3">
                  <QuoteBreakdown estimate={event.estimate} />
                </div>
              </details>
            )
          )}
          <NoticesPanel management={management} />
        </div>
      </div>
    </div>
  );
}
