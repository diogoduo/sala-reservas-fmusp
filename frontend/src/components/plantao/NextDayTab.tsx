import { CalendarStarIcon, CarIcon, CheckCircleIcon, ForkKnifeIcon, HourglassMediumIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { eventStatusText } from "../../lib/events";
import { formatTimeRange, plural } from "../../lib/format";
import type { DayOverview } from "../../lib/plantao";
import { useToast } from "../../lib/toast";
import { Badge } from "../ui/Badge";
import { CardListSkeleton } from "../ui/Feedback";
import { Card } from "../ui/Surface";
import { longDay } from "./ChecklistTab";

// Fase 17 — visão do dia seguinte (documento SAD/NUCEV, 5.4): os eventos de
// amanhã, o checklist (concluído e pendente), as reservas confirmadas e as que
// aguardam confirmação, e quem cuida de quê.

export function useDayOverview(date: string) {
  const toast = useToast();
  const [data, setData] = useState<DayOverview | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    api<DayOverview>(`/plantao/day?date=${date}`)
      .then((d) => alive && setData(d))
      .catch((e) => toast.error("Não foi possível carregar o dia.", e instanceof ApiError ? e.message : ""));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  return data;
}

function Block({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-base font-semibold">
        {title} {count !== undefined && <span className="font-normal text-muted">({count})</span>}
      </h2>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

export function DayEvents({ data }: { data: DayOverview }) {
  if (data.events.length === 0) return <p className="text-sm text-muted">Nenhum evento no dia.</p>;
  return (
    <ul className="divide-y divide-border">
      {data.events.map((e) => (
        <li key={e.id} className="py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/admin/eventos/${e.id}?aba=organizacao`} className="font-semibold text-primary hover:underline">
              <CalendarStarIcon size={15} className="mr-1 inline align-[-2px]" aria-hidden />
              {e.title}
            </Link>
            <Badge tone={e.status === "CONFIRMED" ? "success" : "warning"}>{eventStatusText({ status: e.status, days: [], closedAt: e.closedAt })}</Badge>
          </div>
          <p className="mt-0.5 text-muted">
            {e.start && e.end ? `${e.start}–${e.end}` : "horário a definir"} · {e.rooms.length > 0 ? e.rooms.join(", ") : "salas a definir"} · {e.expectedAttendees} pessoas
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>Responsável no NUCEV: {e.assigneeName ?? "—"}</span>
            <span className={cn(e.openTasks > 0 && "font-medium text-warning-foreground")}>{plural(e.openTasks, "pendência aberta", "pendências abertas")}</span>
            {e.buffet && (
              <span className="inline-flex items-center gap-1">
                <ForkKnifeIcon size={12} aria-hidden /> buffet
              </span>
            )}
            {e.parking && (
              <span className="inline-flex items-center gap-1">
                <CarIcon size={12} aria-hidden /> estacionamento ({plural(e.vehicles, "veículo", "veículos")})
              </span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function NextDayTab({ date }: { date: string }) {
  const data = useDayOverview(date);
  if (!data) return <CardListSkeleton />;
  const pending = data.tasks.due.filter((t) => t.status === "OPEN");
  const done = data.tasks.due.filter((t) => t.status === "DONE");

  return (
    <div className="space-y-5">
      <p className="text-base font-semibold sm:text-lg">{longDay(date)}</p>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Block title="Eventos" count={data.events.length}>
          <DayEvents data={data} />
        </Block>
        <Block title="Reservas" count={data.reservations.confirmed.length + data.reservations.awaiting.length}>
          <div className="space-y-4">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-success-foreground">
                <CheckCircleIcon size={16} aria-hidden /> Confirmadas ({data.reservations.confirmed.length})
              </h3>
              <ul className="mt-1 space-y-1 text-sm">
                {data.reservations.confirmed.map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <span className="w-24 shrink-0 tabular-nums text-muted">{formatTimeRange(r.startTime, r.endTime)}</span>
                    <span className="min-w-0">
                      {r.title} <span className="text-muted">· {r.room?.name ?? "sala a definir"}</span>
                    </span>
                  </li>
                ))}
                {data.reservations.confirmed.length === 0 && <li className="text-muted">Nenhuma.</li>}
              </ul>
            </div>
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-warning-foreground">
                <HourglassMediumIcon size={16} aria-hidden /> Aguardando confirmação ({data.reservations.awaiting.length})
              </h3>
              <ul className="mt-1 space-y-1 text-sm">
                {data.reservations.awaiting.map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <span className="w-24 shrink-0 tabular-nums text-muted">{formatTimeRange(r.startTime, r.endTime)}</span>
                    <span className="min-w-0">
                      {r.title} <span className="text-muted">· {r.user.name}</span>
                    </span>
                  </li>
                ))}
                {data.reservations.awaiting.length === 0 && <li className="text-muted">Nenhuma.</li>}
              </ul>
              {data.reservations.awaiting.length > 0 && (
                <Link to="/admin/solicitacoes" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
                  Ver nas Solicitações
                </Link>
              )}
            </div>
          </div>
        </Block>
        <Block title="Checklist do dia" count={data.tasks.due.length}>
          <ul className="space-y-1.5 text-sm">
            {pending.map((t) => (
              <li key={t.id} className="flex items-start gap-2">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning-foreground" aria-hidden />
                <span>
                  {t.title} <span className="text-muted">· {t.assigneeName ?? "sem responsável"}</span>
                  {t.priority && <Badge tone="danger" className="ml-1.5">Prioritária</Badge>}
                </span>
              </li>
            ))}
            {done.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-muted line-through">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-success-foreground" aria-hidden />
                {t.title}
              </li>
            ))}
            {data.tasks.due.length === 0 && <li className="text-muted">Nenhuma tarefa com prazo neste dia.</li>}
          </ul>
          <p className="mt-3 text-xs text-muted">
            {plural(pending.length, "pendente", "pendentes")} · {plural(done.length, "concluída", "concluídas")}
            {data.tasks.overdue > 0 && ` · ${plural(data.tasks.overdue, "atrasada de antes", "atrasadas de antes")}`}
          </p>
        </Block>
        <Block title="Responsáveis">
          {data.people.length === 0 ? (
            <p className="text-sm text-muted">Ninguém com tarefa ou evento.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.people.map((p) => (
                <li key={p.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <UsersThreeIcon size={15} className="text-muted" aria-hidden /> {p.name}
                  </span>
                  <span className="text-muted">
                    {plural(p.tasks, "tarefa aberta", "tarefas abertas")}
                    {p.events.length > 0 && ` · ${p.events.join(", ")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}
