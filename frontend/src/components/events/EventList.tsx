import { CalendarStarIcon, MagnifyingGlassIcon, PlusIcon, UsersIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, eventPeriod, eventStatusText, type EventRequest, type EventStatus } from "../../lib/events";
import { formatMoney } from "../../lib/prices";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Alert, CardListSkeleton, EmptyState } from "../ui/Feedback";
import { Input } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";

function EventCard({ event, to, showRequester }: { event: EventRequest; to: string; showRequester?: boolean }) {
  const total = event.estimate?.quote.totalCents;
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
            Estimativa
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

const FILTERS: (EventStatus | "ALL")[] = ["ALL", "SUBMITTED", "IN_REVIEW", "QUOTE_SENT", "PRE_RESERVED", "CONFIRMED", "CANCELLED"];

/** Eventos para o SAD e o NUCEV (Fase 11: a lista; a gestão entra na Fase 12). */
export function EventsAdmin() {
  const [events, setEvents] = useState<EventRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EventStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api<{ events: EventRequest[] }>("/events")
      .then((res) => setEvents(res.events))
      .catch((e) => setError(e instanceof Error ? e.message : "Não foi possível carregar os eventos."));
  }, []);

  const count = (status: EventStatus | "ALL") => (events ?? []).filter((e) => status === "ALL" || e.status === status).length;
  const visible = (events ?? []).filter((e) => {
    const text = `${e.title} ${e.protocol} ${e.responsible} ${e.user.name}`.toLowerCase();
    return (filter === "ALL" || e.status === filter) && (!query || text.includes(query.toLowerCase()));
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Eventos" description="Pedidos de evento: dias, espaços, coffee break e o orçamento estimado." />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Situação" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                filter === f ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border-strong text-muted hover:text-foreground",
              )}
            >
              {f === "ALL" ? "Todos" : EVENT_STATUS_LABELS[f]} <span className="tabular-nums">{count(f)}</span>
            </button>
          ))}
        </div>
        <div className="relative lg:w-72">
          <Input type="search" aria-label="Buscar evento" placeholder="Nome, protocolo ou pessoa" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
      </div>
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : events === null ? (
        <CardListSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState icon={CalendarStarIcon} title="Nenhum evento aqui" description="Os pedidos feitos em 'Solicitar evento' aparecem nesta lista." />
      ) : (
        <div className="space-y-3">
          {visible.map((e) => (
            <EventCard key={e.id} event={e} to={`/admin/eventos/${e.id}`} showRequester />
          ))}
        </div>
      )}
    </div>
  );
}
