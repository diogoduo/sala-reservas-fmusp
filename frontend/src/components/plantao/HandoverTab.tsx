import { CheckCircleIcon, HandshakeIcon, MagicWandIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { plural } from "../../lib/format";
import { SITUATION_LABELS, SITUATION_TONES, type DayOverview, type Handover, type HandoverSituation } from "../../lib/plantao";
import { shortDateTime } from "../../lib/tasks";
import { useToast } from "../../lib/toast";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Alert, CardListSkeleton } from "../ui/Feedback";
import { Input, Select, Textarea } from "../ui/Field";
import { Card } from "../ui/Surface";
import { longDay } from "./ChecklistTab";
import { DayEvents, useDayOverview } from "./NextDayTab";

// Fase 17 — passagem de plantão (documento SAD/NUCEV, 5.4): a geral (resumo do
// dia, pendências, prioridades, quem assume) e a de cada evento (o que foi
// feito e por quem, o que falta, a situação e o próximo responsável). Quem
// assume confirma que recebeu. O sistema preenche o resumo com o retrato do dia.

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "");

interface EventDraft {
  include: boolean;
  situation: HandoverSituation;
  done: string;
  doneBy: string;
  pending: string;
  nextResponsibleName: string;
  notes: string;
}

const emptyEvent = (): EventDraft => ({ include: false, situation: "ON_TRACK", done: "", doneBy: "", pending: "", nextResponsibleName: "", notes: "" });

/** Textos prontos a partir do retrato do dia (a equipe revisa antes de salvar). */
function autoSummary(d: DayOverview) {
  const lines = [
    d.events.length > 0 ? `Eventos: ${d.events.map((e) => `${e.start ?? ""}${e.start ? "–" : ""}${e.end ?? ""} ${e.title}${e.rooms.length ? ` (${e.rooms.join(", ")})` : ""}`).join("; ")}.` : "Sem eventos no dia.",
    `Reservas: ${plural(d.reservations.confirmed.length, "confirmada", "confirmadas")}, ${plural(d.reservations.awaiting.length, "aguardando confirmação", "aguardando confirmação")}.`,
    d.tasks.doneToday.length > 0 ? `Concluído: ${d.tasks.doneToday.map((t) => `${t.title} (${t.doneByName})`).join("; ")}.` : "Nenhuma tarefa concluída ainda.",
  ];
  return lines.join("\n");
}
const autoPending = (d: DayOverview) =>
  d.tasks.due
    .filter((t) => t.status === "OPEN")
    .map((t) => `- ${t.title} (${t.assigneeName ?? "sem responsável"})`)
    .join("\n") + (d.tasks.overdue > 0 ? `\n- ${plural(d.tasks.overdue, "tarefa atrasada", "tarefas atrasadas")} de dias anteriores` : "");
const autoPriorities = (d: DayOverview) => d.tasks.priority.map((t) => `- ${t.title} (${t.assigneeName ?? "sem responsável"})`).join("\n");

function HandoverCard({ handover, me, onAcknowledged }: { handover: Handover; me: string | undefined; onAcknowledged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function acknowledge() {
    setBusy(true);
    try {
      await api(`/plantao/handovers/${handover.id}/acknowledge`, { method: "POST", body: "{}" });
      toast.success("Plantão recebido");
      onAcknowledged();
    } catch (e) {
      toast.error("Não foi possível confirmar.", errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const block = (label: string, value: string | null) =>
    value && (
      <div>
        <p className="text-xs font-semibold text-muted">{label}</p>
        <p className="text-sm whitespace-pre-line">{value}</p>
      </div>
    );
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {longDay(handover.date)}
            {handover.shiftLabel && <span className="font-normal text-muted"> · {handover.shiftLabel}</span>}
          </p>
          <p className="text-xs text-muted">
            Passado por {handover.createdByName} em {shortDateTime(handover.createdAt)}
            {handover.nextResponsibleName && ` · para ${handover.nextResponsibleName}`}
          </p>
        </div>
        {handover.acknowledgedAt ? (
          <Badge tone="success" icon={CheckCircleIcon}>
            Recebido por {handover.acknowledgedByName} · {shortDateTime(handover.acknowledgedAt)}
          </Badge>
        ) : handover.createdById !== me ? (
          <Button size="sm" icon={HandshakeIcon} loading={busy} onClick={() => void acknowledge()}>
            Recebi o plantão
          </Button>
        ) : (
          <Badge tone="warning">Aguardando quem assume</Badge>
        )}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium text-primary">Ver a passagem</summary>
        <div className="mt-3 space-y-3">
          {block("Resumo das atividades", handover.summary)}
          {block("Pendências gerais", handover.pending)}
          {block("Atividades prioritárias", handover.priorities)}
          {block("Observações", handover.notes)}
          {handover.events.map((e) => (
            <div key={e.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{e.eventLabel}</p>
                <Badge tone={SITUATION_TONES[e.situation]}>{SITUATION_LABELS[e.situation]}</Badge>
              </div>
              <div className="mt-2 space-y-2">
                {block(`Já realizado${e.doneBy ? ` (por ${e.doneBy})` : ""}`, e.done)}
                {block("Pendente", e.pending)}
                {block("Próximo responsável", e.nextResponsibleName)}
                {block("Observações", e.notes)}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">
            Retrato do dia na passagem: {plural(handover.snapshot.events.length, "evento", "eventos")}, {plural(handover.snapshot.reservations.confirmed.length, "reserva confirmada", "reservas confirmadas")},{" "}
            {plural(handover.snapshot.tasks.doneToday.length, "tarefa concluída", "tarefas concluídas")}, {plural(handover.snapshot.tasks.open, "aberta", "abertas")}.
          </p>
        </div>
      </details>
    </Card>
  );
}

export function HandoverTab({ date }: { date: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const overview = useDayOverview(date);
  const [list, setList] = useState<{ handovers: Handover[]; team: { id: string; name: string }[] } | null>(null);
  const [form, setForm] = useState({ shiftLabel: "", summary: "", pending: "", priorities: "", nextResponsibleId: "", notes: "" });
  const [events, setEvents] = useState<Record<string, EventDraft>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setEvent = (id: string, patch: Partial<EventDraft>) => setEvents((all) => ({ ...all, [id]: { ...(all[id] ?? emptyEvent()), ...patch } }));

  const loadList = useCallback(() => {
    api<{ handovers: Handover[]; team: { id: string; name: string }[] }>("/plantao/handovers")
      .then(setList)
      .catch((e) => toast.error("Não foi possível carregar as passagens.", errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => loadList(), [loadList]);

  async function save() {
    setBusy(true);
    try {
      await api("/plantao/handovers", {
        method: "POST",
        body: JSON.stringify({
          date,
          ...form,
          nextResponsibleId: form.nextResponsibleId || null,
          events: Object.entries(events)
            .filter(([, e]) => e.include)
            .map(([eventId, { include: _include, ...e }]) => ({ eventId, ...e })),
        }),
      });
      toast.success("Passagem de plantão registrada", "Quem assume confirma que recebeu.");
      setForm({ shiftLabel: "", summary: "", pending: "", priorities: "", nextResponsibleId: "", notes: "" });
      setEvents({});
      loadList();
    } catch (e) {
      toast.error("Não foi possível registrar.", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const fill = (label: string, onClick: () => void) => (
    <Button size="sm" variant="ghost" icon={MagicWandIcon} onClick={onClick} disabled={!overview}>
      {label}
    </Button>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        <Card className="space-y-4 p-4 sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Nova passagem de plantão</h2>
            <p className="text-sm text-muted">{longDay(date)}. O sistema sugere os textos com o retrato do dia: revise antes de registrar.</p>
          </div>
          {overview && (
            <Alert tone="info">
              Hoje: {plural(overview.events.length, "evento", "eventos")} · {plural(overview.reservations.confirmed.length, "reserva confirmada", "reservas confirmadas")} ·{" "}
              {plural(overview.reservations.awaiting.length, "aguardando", "aguardando")} · {plural(overview.tasks.doneToday.length, "tarefa concluída", "tarefas concluídas")} ·{" "}
              {plural(overview.tasks.open, "pendência aberta", "pendências abertas")}
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Turno" value={form.shiftLabel} onChange={(e) => set({ shiftLabel: e.target.value })} placeholder="Ex.: Manhã → Tarde" />
            <Select label="Quem assume" value={form.nextResponsibleId} onChange={(e) => set({ nextResponsibleId: e.target.value })}>
              <option value="">Escolha</option>
              {(list?.team ?? []).filter((p) => p.id !== user?.id).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Textarea label="Resumo das atividades do dia" rows={4} value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
            {fill("Preencher com o retrato do dia", () => overview && set({ summary: autoSummary(overview) }))}
          </div>
          <div>
            <Textarea label="Pendências gerais" rows={3} value={form.pending} onChange={(e) => set({ pending: e.target.value })} />
            {fill("Preencher com as pendências abertas", () => overview && set({ pending: autoPending(overview) }))}
          </div>
          <div>
            <Textarea label="Atividades prioritárias" rows={3} value={form.priorities} onChange={(e) => set({ priorities: e.target.value })} />
            {fill("Preencher com as prioritárias", () => overview && set({ priorities: autoPriorities(overview) }))}
          </div>
          <Textarea label="Observações" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Passagem por evento</h3>
            {!overview ? (
              <CardListSkeleton />
            ) : overview.events.length === 0 ? (
              <p className="text-sm text-muted">Nenhum evento neste dia.</p>
            ) : (
              overview.events.map((ev) => {
                const d = events[ev.id] ?? emptyEvent();
                return (
                  <div key={ev.id} className="rounded-xl border border-border p-3">
                    <label className="flex items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" checked={d.include} onChange={(e) => setEvent(ev.id, { include: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                      {ev.title} <span className="font-normal text-muted">· {ev.start}–{ev.end}</span>
                    </label>
                    {d.include && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Select label="Situação atual" value={d.situation} onChange={(e) => setEvent(ev.id, { situation: e.target.value as HandoverSituation })}>
                          {(Object.keys(SITUATION_LABELS) as HandoverSituation[]).map((s) => (
                            <option key={s} value={s}>
                              {SITUATION_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                        <Input label="Quem realizou" value={d.doneBy} onChange={(e) => setEvent(ev.id, { doneBy: e.target.value })} />
                        <Textarea label="O que já foi realizado" rows={2} value={d.done} onChange={(e) => setEvent(ev.id, { done: e.target.value })} containerClassName="sm:col-span-2" />
                        <Textarea label="O que está pendente" rows={2} value={d.pending} onChange={(e) => setEvent(ev.id, { pending: e.target.value })} containerClassName="sm:col-span-2" />
                        <Input label="Próximo responsável" value={d.nextResponsibleName} onChange={(e) => setEvent(ev.id, { nextResponsibleName: e.target.value })} />
                        <Input label="Observações" value={d.notes} onChange={(e) => setEvent(ev.id, { notes: e.target.value })} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <Button icon={HandshakeIcon} loading={busy} onClick={() => void save()} className="w-full sm:w-auto">
            Registrar a passagem
          </Button>
        </Card>
        {overview && (
          <Card className="p-4 sm:p-6">
            <h2 className="mb-2 text-base font-semibold">Eventos do dia</h2>
            <DayEvents data={overview} />
          </Card>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <h2 className="text-base font-semibold">Passagens anteriores</h2>
        {!list ? (
          <CardListSkeleton />
        ) : list.handovers.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma passagem registrada ainda.</p>
        ) : (
          list.handovers.map((h) => <HandoverCard key={h.id} handover={h} me={user?.id} onAcknowledged={loadList} />)
        )}
      </div>
    </div>
  );
}
