import { CalendarStarIcon, MagnifyingGlassIcon, PlusIcon, UsersIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { EVENT_STATUS_TONES, eventPeriod, eventStatusText, type EventRequest, type EventStatus } from "../../lib/events";
import { formatMoney } from "../../lib/prices";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Alert, CardListSkeleton, EmptyState } from "../ui/Feedback";
import { Input } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";

/** O valor do evento: o último orçamento emitido ou, sem ele, a estimativa do pedido. */
const eventValue = (e: EventRequest) => e.quotes?.[0]?.totalCents ?? e.estimate?.quote.totalCents;

function EventCard({ event, to, showRequester }: { event: EventRequest; to: string; showRequester?: boolean }) {
  const total = eventValue(event);
  return (
    <Link to={to} className="block rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <Card className="flex flex-col gap-2 p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{event.title}</p>
            <Badge tone={EVENT_STATUS_TONES[event.status]}>{eventStatusText(event)}</Badge>
          </div>
          <p className="text-sm text-muted">
            <span className="tabular-nums">{event.protocol}</span> · {eventPeriod(event.days)} · {event.days.length === 1 ? "1 dia" : `${event.days.length} dias`} ·{" "}
            {event.spaces.length === 1 ? "1 pedido de espaço" : `${event.spaces.length} pedidos de espaço`}
          </p>
          {showRequester && (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <UsersIcon size={14} aria-hidden /> {event.expectedAttendees} pessoas · {event.user.name}
            </p>
          )}
        </div>
        {total !== undefined && (
          <p className="shrink-0 text-sm text-muted sm:text-right">
            {event.quotes?.length ? `Orçamento v${event.quotes[0]!.version}` : "Estimativa"}
            <span className="block font-semibold text-foreground tabular-nums">{formatMoney(total)}</span>
          </p>
        )}
      </Card>
    </Link>
  );
}

/** "Meus eventos": os pedidos de evento de quem está logado. */
export function MyEvents() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ events: EventRequest[] }>("/events/mine")
      .then((res) => setEvents(res.events))
      .catch((e) => setError(e instanceof Error ? e.message : "Não foi possível carregar os eventos."));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meus eventos"
        description="Pedidos de evento com vários dias e espaços, do envio à confirmação."
        actions={
          <Button icon={PlusIcon} onClick={() => navigate("/eventos/novo")}>
            Solicitar evento
          </Button>
        }
      />
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : events === null ? (
        <CardListSkeleton />
      ) : events.length === 0 ? (
        <EmptyState
          icon={CalendarStarIcon}
          title="Nenhum evento ainda"
          description="Congressos, cursos, jornadas e solenidades: peça vários espaços de uma vez e veja o orçamento estimado."
          action={<Button onClick={() => navigate("/eventos/novo")}>Solicitar evento</Button>}
        />
      ) : (
        <div className="space-y-3">
          {events.map((e) => (
            <EventCard key={e.id} event={e} to={`/eventos/${e.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}

const today = () => new Date().toLocaleDateString("en-CA");
const lastDay = (e: EventRequest) => e.days.map((d) => d.date).sort().at(-1) ?? "";
const firstDay = (e: EventRequest) => e.days.map((d) => d.date).sort()[0] ?? "";
const CLOSED: EventStatus[] = ["CANCELLED", "REJECTED", "EXPIRED"];

/** Etapas do quadro (inspirado no Monday): cada coluna junta situações parecidas. */
const STAGES: { key: string; label: string; statuses: EventStatus[] }[] = [
  { key: "received", label: "Recebidos", statuses: ["SUBMITTED"] },
  { key: "review", label: "Em análise", statuses: ["IN_REVIEW", "CHANGES_REQUESTED"] },
  { key: "prereserved", label: "Pré-reservados", statuses: ["PRE_RESERVED"] },
  { key: "quote", label: "Orçamento enviado", statuses: ["QUOTE_SENT"] },
  { key: "payment", label: "Pagamento", statuses: ["QUOTE_APPROVED", "PAYMENT_SUBMITTED", "PAYMENT_VALIDATED"] },
  { key: "confirmed", label: "Confirmados", statuses: ["CONFIRMED"] },
  { key: "closed", label: "Encerrados", statuses: CLOSED },
];

/** Os indicadores do painel (documento SAD/NUCEV, 4.1). */
function indicators(events: EventRequest[]) {
  const count = (fn: (e: EventRequest) => boolean) => events.filter(fn).length;
  const t = today();
  return [
    { label: "Recebidos", value: count((e) => e.status === "SUBMITTED") },
    { label: "Em análise", value: count((e) => e.status === "IN_REVIEW" || e.status === "CHANGES_REQUESTED") },
    { label: "Pré-reservas ativas", value: count((e) => e.preReservedUntil !== null && !CLOSED.includes(e.status) && e.status !== "CONFIRMED") },
    { label: "Orçamentos enviados", value: count((e) => e.status === "QUOTE_SENT") },
    { label: "Aguardando pagamento", value: count((e) => e.status === "QUOTE_APPROVED") },
    { label: "Pagamento em validação", value: count((e) => e.status === "PAYMENT_SUBMITTED" || e.status === "PAYMENT_VALIDATED") },
    { label: "Confirmados", value: count((e) => e.status === "CONFIRMED" && firstDay(e) > t) },
    { label: "Em andamento", value: count((e) => e.status === "CONFIRMED" && firstDay(e) <= t && lastDay(e) >= t) },
    { label: "Finalizados", value: count((e) => e.status === "CONFIRMED" && lastDay(e) < t) },
    { label: "Cancelados ou recusados", value: count((e) => CLOSED.includes(e.status)) },
  ];
}

function BoardCard({ event }: { event: EventRequest }) {
  const value = eventValue(event);
  return (
    <Link
      to={`/admin/eventos/${event.id}`}
      className="block rounded-xl border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <p className="text-sm leading-snug font-semibold">{event.title}</p>
      <p className="mt-0.5 text-xs text-muted">{eventPeriod(event.days)}</p>
      <p className="text-xs text-muted">
        {event.expectedAttendees} pessoas · {event.user.name}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
        <Badge tone={EVENT_STATUS_TONES[event.status]}>{eventStatusText(event)}</Badge>
        {value !== undefined && <span className="text-xs font-semibold tabular-nums">{formatMoney(value)}</span>}
      </div>
      {event.assigneeName && <p className="mt-1.5 text-[11px] text-muted">NUCEV: {event.assigneeName}</p>}
    </Link>
  );
}

/** Painel de eventos do SAD e do NUCEV: indicadores, quadro por etapas e lista. */
export function EventsAdmin() {
  const [events, setEvents] = useState<EventRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api<{ events: EventRequest[] }>("/events")
      .then((res) => setEvents(res.events))
      .catch((e) => setError(e instanceof Error ? e.message : "Não foi possível carregar os eventos."));
  }, []);

  const visible = (events ?? []).filter((e) => {
    const text = `${e.title} ${e.protocol} ${e.responsible} ${e.user.name} ${e.assigneeName ?? ""}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Eventos" description="Do pedido à confirmação: análise e orçamento pelo NUCEV, salas e pré-reserva pelo SAD." />
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : events === null ? (
        <CardListSkeleton />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {indicators(events).map((i) => (
              <li key={i.label} className="rounded-xl border border-border bg-surface px-3 py-2.5">
                <p className="text-2xl font-bold tabular-nums">{i.value}</p>
                <p className="text-xs text-muted">{i.label}</p>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="tablist" aria-label="Visualização" className="flex w-fit gap-1 rounded-lg bg-surface-muted p-1">
              {(["board", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn("rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}
                >
                  {v === "board" ? "Quadro" : "Lista"}
                </button>
              ))}
            </div>
            <div className="relative sm:w-72">
              <Input type="search" aria-label="Buscar evento" placeholder="Nome, protocolo ou pessoa" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
              <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={CalendarStarIcon} title="Nenhum evento aqui" description="Os pedidos feitos em “Solicitar evento” aparecem neste painel." />
          ) : view === "board" ? (
            <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
              <div className="flex gap-3">
                {STAGES.map((stage) => {
                  const items = visible.filter((e) => stage.statuses.includes(e.status));
                  return (
                    <section key={stage.key} aria-label={stage.label} className="w-64 shrink-0 rounded-2xl bg-surface-muted p-2">
                      <h2 className="flex items-center justify-between px-1.5 pt-1 pb-2 text-sm font-semibold">
                        {stage.label} <span className="text-muted tabular-nums">{items.length}</span>
                      </h2>
                      <div className="space-y-2">
                        {items.map((e) => (
                          <BoardCard key={e.id} event={e} />
                        ))}
                        {items.length === 0 && <p className="px-1.5 pb-2 text-xs text-muted">Nada nesta etapa.</p>}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((e) => (
                <EventCard key={e.id} event={e} to={`/admin/eventos/${e.id}`} showRequester />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
