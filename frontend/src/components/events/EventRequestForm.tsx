import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, CoffeeIcon, PaperPlaneTiltIcon, PlusIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CULTURE_KIND_LABELS, ORGANIZER_ENTITY_GROUPS } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { dayLabel, FMUSP_ENTITIES, INSTITUTIONAL_ENTITIES, type EventRequest, type SpaceAvailability } from "../../lib/events";
import { coffeeLimit, sortRooms, upToText } from "../../lib/rooms";
import { useToast } from "../../lib/toast";
import type { PriceCategory, PricesResponse, QuoteEstimate, Room } from "../../lib/types";
import { QuoteBreakdown } from "../quotes/QuoteBreakdown";
import { Button, IconButton } from "../ui/Button";
import { Alert } from "../ui/Feedback";
import { Input, Select, Switch, Textarea } from "../ui/Field";
import { TimeInput } from "../ui/TimeInput";
import { Card, PageHeader } from "../ui/Surface";

// Fase 11 — "Solicitar evento", em etapas: o evento → os dias → os espaços →
// coffee e infraestrutura → o resumo, com a disponibilidade e o orçamento estimado.

interface DayDraft {
  date: string;
  start: string;
  end: string;
  setupMinutes: string;
  teardownMinutes: string;
}

interface SpaceDraft {
  mode: "category" | "room";
  categoryId: string;
  roomId: string;
  count: string;
  minCapacity: string;
  purpose: string;
  coffeeInRoom: boolean;
  /** Vazio = todos os dias. */
  dates: string[];
}

interface Draft {
  title: string;
  kind: string;
  description: string;
  targetAudience: string;
  expectedAttendees: string;
  entity: string;
  hasRegistrationFee: boolean;
  sponsored: boolean;
  responsible: string;
  responsibleContact: string;
  department: string;
  coffeeBreak: boolean;
  coffeeAttendees: string;
  infrastructure: string;
  notes: string;
  termsAccepted: boolean;
  days: DayDraft[];
  spaces: SpaceDraft[];
}

const STEPS = ["Evento", "Dias e horários", "Espaços", "Coffee e infraestrutura", "Resumo"];
const DRAFT_KEY = "rascunho-evento";
const toKey = (d: Date) => d.toLocaleDateString("en-CA");
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

const emptySpace = (): SpaceDraft => ({ mode: "category", categoryId: "", roomId: "", count: "1", minCapacity: "", purpose: "", coffeeInRoom: false, dates: [] });

function emptyDraft(): Draft {
  const first = addDays(toKey(new Date()), 30);
  return {
    title: "",
    kind: "",
    description: "",
    targetAudience: "",
    expectedAttendees: "",
    entity: "",
    hasRegistrationFee: false,
    sponsored: false,
    responsible: "",
    responsibleContact: "",
    department: "",
    coffeeBreak: false,
    coffeeAttendees: "",
    infrastructure: "",
    notes: "",
    termsAccepted: false,
    days: [{ date: first, start: "08:00", end: "18:00", setupMinutes: "0", teardownMinutes: "0" }],
    spaces: [emptySpace()],
  };
}

function loadDraft(): Draft {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) return { ...emptyDraft(), ...(JSON.parse(saved) as Partial<Draft>), termsAccepted: false };
  } catch {
    // Sem armazenamento local (janela anônima): começa do zero.
  }
  return emptyDraft();
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

/** Horário de uso dos espaços: da montagem ao fim da desmontagem. */
const usageWindow = (d: DayDraft) => ({
  date: d.date,
  start: fromMinutes(Math.max(0, toMinutes(d.start) - (Number(d.setupMinutes) || 0))),
  end: fromMinutes(Math.min(24 * 60 - 1, toMinutes(d.end) + (Number(d.teardownMinutes) || 0))),
});

const spaceRef = (s: SpaceDraft) => (s.mode === "category" ? { categoryId: s.categoryId || undefined } : { roomId: s.roomId || undefined });
const spacePayload = (s: SpaceDraft) => ({
  ...spaceRef(s),
  count: s.mode === "category" ? Math.max(1, Number(s.count) || 1) : 1,
  minCapacity: s.mode === "category" ? num(s.minCapacity) : undefined,
  purpose: s.purpose.trim() || undefined,
  coffeeInRoom: s.mode === "room" && s.coffeeInRoom,
  dates: s.dates,
});
const dayPayload = (d: DayDraft) => ({ date: d.date, start: d.start, end: d.end, setupMinutes: Number(d.setupMinutes) || 0, teardownMinutes: Number(d.teardownMinutes) || 0 });
const spaceChosen = (s: SpaceDraft) => (s.mode === "category" ? Boolean(s.categoryId) : Boolean(s.roomId));

/** O que falta em cada etapa, em texto. */
function stepProblems(step: number, d: Draft): string[] {
  const missing: string[] = [];
  if (step === 0) {
    if (!d.title.trim()) missing.push("o nome do evento");
    if (!d.kind) missing.push("o tipo");
    if (!d.description.trim()) missing.push("o objetivo e a programação");
    if (!d.targetAudience.trim()) missing.push("o público-alvo");
    if (!(Number(d.expectedAttendees) > 0)) missing.push("o público previsto");
    if (!d.entity) missing.push("a entidade organizadora");
    if (!d.responsible.trim()) missing.push("o responsável");
    if (!d.responsibleContact.trim()) missing.push("o contato do responsável");
    if (!d.department.trim()) missing.push("o departamento, setor ou entidade");
  }
  if (step === 1) {
    if (d.days.some((day) => !day.date || !day.start || !day.end)) missing.push("a data e o horário de cada dia");
    if (d.days.some((day) => day.end <= day.start)) missing.push("um término depois do início em cada dia");
    if (new Set(d.days.map((day) => day.date)).size !== d.days.length) missing.push("dias diferentes (há datas repetidas)");
  }
  if (step === 2 && d.spaces.some((s) => !spaceChosen(s))) missing.push("a categoria ou o espaço de cada linha");
  if (step === 3 && d.coffeeBreak && !(Number(d.coffeeAttendees) > 0)) missing.push("quantas pessoas no coffee break");
  if (step === 4 && !d.termsAccepted) missing.push("o aceite do regulamento");
  return missing;
}

function Stepper({ step, onGo }: { step: number; onGo: (i: number) => void }) {
  return (
    <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Etapas">
      {STEPS.map((label, i) => (
        <li key={label} className="shrink-0">
          <button
            type="button"
            onClick={() => i < step && onGo(i)}
            disabled={i > step}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
              i === step ? "bg-primary-soft font-semibold text-primary-soft-foreground" : i < step ? "text-foreground hover:bg-surface-muted" : "text-muted",
            )}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
                i < step ? "bg-primary text-primary-foreground" : i === step ? "border-2 border-primary" : "border border-border-strong",
              )}
            >
              {i < step ? <CheckCircleIcon size={14} weight="bold" /> : i + 1}
            </span>
            {label}
          </button>
        </li>
      ))}
    </ol>
  );
}

function AvailabilityNote({ availability }: { availability: SpaceAvailability | undefined }) {
  if (!availability) return null;
  if (availability.candidates === 0) {
    return <p className="flex items-center gap-1.5 text-sm text-warning-foreground"><WarningIcon size={16} aria-hidden /> Nenhum espaço desse tipo comporta o que foi pedido.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {availability.days.map((d) => {
        const ok = d.free >= d.needed;
        return (
          <li key={d.date} className={cn("flex flex-wrap items-center gap-x-1.5", ok ? "text-success-foreground" : "text-warning-foreground")}>
            {ok ? <CheckCircleIcon size={16} aria-hidden /> : <WarningIcon size={16} aria-hidden />}
            <span className="font-medium">{dayLabel(d.date)}:</span>
            {ok ? `${d.free} livre${d.free === 1 ? "" : "s"} para ${d.needed}` : `só ${d.free} livre${d.free === 1 ? "" : "s"} de ${d.needed}`}
            {!ok && d.suggestions.length > 0 && <span className="text-muted">· livres: {d.suggestions.join(", ")}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function EventRequestForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [step, setStep] = useState(0);
  const [categories, setCategories] = useState<PriceCategory[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [availability, setAvailability] = useState<SpaceAvailability[] | null>(null);
  const [estimate, setEstimate] = useState<QuoteEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api<PricesResponse>("/prices"), api<{ rooms: Room[] }>("/rooms?status=ACTIVE")])
      .then(([prices, list]) => {
        setCategories(prices.categories);
        setRooms(sortRooms(list.rooms));
      })
      .catch(() => toast.error("Não foi possível carregar os espaços."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rascunho no navegador: recarregar a página não perde o que foi preenchido.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Sem armazenamento local: segue sem rascunho.
    }
  }, [draft]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setDay = (i: number, patch: Partial<DayDraft>) => setDraft((d) => ({ ...d, days: d.days.map((day, j) => (j === i ? { ...day, ...patch } : day)) }));
  /** Tira um espaço escolhido pelo nome (ex.: a área de coffee); sem nenhum, fica uma linha em branco. */
  const removeRoom = (roomId: string) =>
    setDraft((d) => {
      const rest = d.spaces.filter((s) => !(s.mode === "room" && s.roomId === roomId));
      return { ...d, spaces: rest.length > 0 ? rest : [emptySpace()] };
    });
  const setSpace = (i: number, patch: Partial<SpaceDraft>) => setDraft((d) => ({ ...d, spaces: d.spaces.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const removeDay = (i: number) =>
    setDraft((d) => {
      const date = d.days[i]?.date;
      return { ...d, days: d.days.filter((_, j) => j !== i), spaces: d.spaces.map((s) => ({ ...s, dates: s.dates.filter((x) => x !== date) })) };
    });

  const validDays = draft.days.every((d) => d.date && d.start && d.end && d.end > d.start);
  const chosenSpaces = draft.spaces.filter(spaceChosen);
  const institutional = INSTITUTIONAL_ENTITIES.includes(draft.entity);
  const possiblyExempt = FMUSP_ENTITIES.includes(draft.entity) && !draft.hasRegistrationFee && !draft.sponsored;
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const coffeeRooms = rooms.filter((r) => r.coffeeAllowed);

  // Disponibilidade dos espaços (etapas Espaços e Resumo).
  const availabilityKey = JSON.stringify([draft.days.map(dayPayload), draft.spaces.map(spacePayload)]);
  useEffect(() => {
    if ((step !== 2 && step !== 4) || !validDays || chosenSpaces.length !== draft.spaces.length || draft.spaces.length === 0) {
      setAvailability(null);
      return;
    }
    const timer = setTimeout(() => {
      api<{ spaces: SpaceAvailability[] }>("/events/availability", {
        method: "POST",
        body: JSON.stringify({ days: draft.days.map(dayPayload), spaces: draft.spaces.map(spacePayload) }),
      })
        .then((res) => setAvailability(res.spaces))
        .catch(() => setAvailability(null));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, availabilityKey]);

  // Orçamento estimado (etapa Resumo).
  useEffect(() => {
    if (step !== 4) return;
    setEstimate(null);
    setEstimateError(null);
    api<QuoteEstimate>("/quotes/estimate", {
      method: "POST",
      body: JSON.stringify({
        days: draft.days.map(usageWindow),
        items: draft.spaces.map((s) => ({
          ...spaceRef(s),
          count: s.mode === "category" ? Math.max(1, Number(s.count) || 1) : 1,
          coffeeInRoom: s.mode === "room" && s.coffeeInRoom,
          days: s.dates.length > 0 ? draft.days.filter((d) => s.dates.includes(d.date)).map(usageWindow) : undefined,
        })),
        institutional,
      }),
    })
      .then(setEstimate)
      .catch((e) => setEstimateError(e instanceof ApiError ? e.message : "Não foi possível calcular o orçamento."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function next() {
    const missing = stepProblems(step, draft);
    setProblems(missing);
    if (missing.length === 0) {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function submit() {
    const missing = [0, 1, 2, 3, 4].flatMap((s) => stepProblems(s, draft));
    setProblems(missing);
    if (missing.length > 0) return;
    setSending(true);
    setServerError(null);
    try {
      const { event } = await api<{ event: EventRequest }>("/events", {
        method: "POST",
        body: JSON.stringify({
          title: draft.title,
          kind: draft.kind,
          description: draft.description,
          targetAudience: draft.targetAudience,
          expectedAttendees: Number(draft.expectedAttendees),
          entity: draft.entity,
          hasRegistrationFee: draft.hasRegistrationFee,
          sponsored: draft.sponsored,
          responsible: draft.responsible,
          responsibleContact: draft.responsibleContact,
          department: draft.department,
          coffeeBreak: draft.coffeeBreak,
          coffeeAttendees: draft.coffeeBreak ? Number(draft.coffeeAttendees) : undefined,
          infrastructure: draft.infrastructure || undefined,
          notes: draft.notes || undefined,
          termsAccepted: draft.termsAccepted,
          days: draft.days.map(dayPayload),
          spaces: draft.spaces.map(spacePayload),
        }),
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // nada a limpar
      }
      toast.success(`Pedido enviado: ${event.protocol}`, "O NUCEV vai analisar e enviar o orçamento.");
      navigate(`/eventos/${event.id}`);
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "Não foi possível enviar o pedido.");
    } finally {
      setSending(false);
    }
  }

  // Coffee: o espaço escolhido para o coffee comporta o público?
  const coffeeSpaces = draft.spaces.filter((s) => s.mode === "room" && roomById.get(s.roomId)?.coffeeAllowed);
  const coffeeCapacityMax = Math.max(0, ...coffeeSpaces.map((s) => {
    const limit = coffeeLimit(roomById.get(s.roomId)!);
    return limit === "sem limite" ? Number.POSITIVE_INFINITY : (limit ?? 0);
  }));
  const coffeeWarning = !draft.coffeeBreak
    ? null
    : coffeeSpaces.length === 0
      ? "Escolha onde vai ser o coffee: adicione um dos espaços abaixo."
      : Number(draft.coffeeAttendees) > coffeeCapacityMax
        ? `O espaço escolhido para o coffee comporta ${coffeeCapacityMax} pessoas, e o coffee terá ${draft.coffeeAttendees}.`
        : null;

  const isSunday = (key: string) => new Date(`${key}T12:00:00`).getDay() === 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Solicitar evento" description="Congressos, cursos, jornadas e solenidades: um ou vários dias, vários espaços, coffee break e o orçamento estimado." />
      <Stepper step={step} onGo={(i) => { setProblems([]); setStep(i); }} />

      {problems.length > 0 && (
        <Alert tone="warning" title="Falta preencher">
          {problems.join("; ")}.
        </Alert>
      )}

      {step === 0 && (
        <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
          <Input label="Nome do evento" required value={draft.title} onChange={(e) => set("title", e.target.value)} containerClassName="sm:col-span-2" />
          <Select label="Tipo de evento" required value={draft.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="">Selecione</option>
            {Object.entries(CULTURE_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input label="Público previsto" required type="number" inputMode="numeric" min={1} value={draft.expectedAttendees} onChange={(e) => set("expectedAttendees", e.target.value)} />
          <Textarea label="Objetivo e programação" required rows={5} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder={"08:30 Credenciamento\n09:00 Abertura\n10:30 Mesa-redonda"} containerClassName="sm:col-span-2" />
          <Input label="Público-alvo" required value={draft.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} placeholder="Ex.: alunos de graduação e residentes" containerClassName="sm:col-span-2" />
          <Select label="Entidade organizadora" required value={draft.entity} onChange={(e) => set("entity", e.target.value)} containerClassName="sm:col-span-2">
            <option value="">Selecione</option>
            {ORGANIZER_ENTITY_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <div className="space-y-4 rounded-xl border border-border p-4 sm:col-span-2">
            <Switch checked={draft.hasRegistrationFee} onChange={(v) => set("hasRegistrationFee", v)} label="Cobra inscrição" />
            <Switch checked={draft.sponsored} onChange={(v) => set("sponsored", v)} label="Tem patrocínio" description="Inclui cessão de produtos, serviços ou espaços por terceiros (Portaria 2794, Art. 4º)." />
          </div>
          {institutional && (
            <Alert tone="info" className="sm:col-span-2">
              Unidade da FMUSP/HC, USP, SES ou Adolfo Lutz: o orçamento já vem com o desconto institucional de 25% (Portaria 2794, Art. 4º III).
              {possiblyExempt && " Sem inscrição e sem patrocínio, o evento pode ser isento (Art. 4º I): o NUCEV confere na análise."}
            </Alert>
          )}
          <Input label="Responsável" required value={draft.responsible} onChange={(e) => set("responsible", e.target.value)} />
          <Input label="Contato do responsável" required value={draft.responsibleContact} onChange={(e) => set("responsibleContact", e.target.value)} placeholder="E-mail ou telefone" />
          <Input label="Departamento, setor ou entidade" required value={draft.department} onChange={(e) => set("department", e.target.value)} containerClassName="sm:col-span-2" />
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-4 p-4 sm:p-6">
          <p className="text-sm text-muted">
            Horário da atividade em cada dia. A montagem e a desmontagem entram na reserva dos espaços. O pedido precisa ser feito com pelo menos 3 dias de antecedência.
          </p>
          <ul className="space-y-3">
            {draft.days.map((d, i) => (
              <li key={i} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <Input label="Data" type="date" value={d.date} onChange={(e) => setDay(i, { date: e.target.value })} containerClassName="w-40" />
                  <TimeInput label="Início" value={d.start} onChange={(v) => setDay(i, { start: v })} containerClassName="w-28" />
                  <TimeInput label="Término" value={d.end} onChange={(v) => setDay(i, { end: v })} after={d.start} containerClassName="w-28" />
                  <Select label="Montagem" value={d.setupMinutes} onChange={(e) => setDay(i, { setupMinutes: e.target.value })} containerClassName="w-32">
                    {[0, 30, 60, 90, 120, 180, 240].map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? "Sem montagem" : `${m / 60} h antes`.replace(".5", ",5")}
                      </option>
                    ))}
                  </Select>
                  <Select label="Desmontagem" value={d.teardownMinutes} onChange={(e) => setDay(i, { teardownMinutes: e.target.value })} containerClassName="w-32">
                    {[0, 30, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? "Sem desmontagem" : `${m / 60} h depois`.replace(".5", ",5")}
                      </option>
                    ))}
                  </Select>
                  {draft.days.length > 1 && <IconButton icon={TrashIcon} label={`Tirar o dia ${i + 1}`} onClick={() => removeDay(i)} />}
                </div>
                {d.date && isSunday(d.date) && (
                  <p className="text-sm text-warning-foreground">Domingo: só com autorização prévia da Divisão Acadêmica (Portaria 2793, Art. 6º).</p>
                )}
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            icon={PlusIcon}
            onClick={() => {
              const last = draft.days.at(-1)!;
              set("days", [...draft.days, { ...last, date: addDays(last.date, 1) }]);
            }}
          >
            Mais um dia
          </Button>
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-4 p-4 sm:p-6">
          <p className="text-sm text-muted">
            Peça por categoria e quantidade ("10 salas para 90 pessoas") ou por nome (Teatro, um átrio). O SAD define as salas na análise. O espaço do coffee break entra aqui ou na próxima etapa.
          </p>
          <ul className="space-y-3">
            {draft.spaces.map((s, i) => {
              const room = roomById.get(s.roomId);
              return (
                <li key={i} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div role="radiogroup" aria-label={`Como pedir o espaço ${i + 1}`} className="flex gap-1 rounded-lg bg-surface-muted p-1">
                      {(["category", "room"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={s.mode === mode}
                          onClick={() => setSpace(i, { mode })}
                          className={cn("rounded-md px-3 py-1.5 text-sm font-medium", s.mode === mode ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}
                        >
                          {mode === "category" ? "Por categoria" : "Espaço específico"}
                        </button>
                      ))}
                    </div>
                    {draft.spaces.length > 1 && <IconButton icon={TrashIcon} label={`Tirar o espaço ${i + 1}`} onClick={() => set("spaces", draft.spaces.filter((_, j) => j !== i))} />}
                  </div>
                  {s.mode === "category" ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <Select label="Categoria" value={s.categoryId} onChange={(e) => setSpace(i, { categoryId: e.target.value })} containerClassName="min-w-0 flex-1 basis-64">
                        <option value="">Selecione</option>
                        {categories.filter((c) => c.rooms.length > 0).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                      <Input label="Quantos" type="number" inputMode="numeric" min={1} value={s.count} onChange={(e) => setSpace(i, { count: e.target.value })} containerClassName="w-24" />
                      <Input label="Pessoas em cada" type="number" inputMode="numeric" min={1} placeholder="Opcional" value={s.minCapacity} onChange={(e) => setSpace(i, { minCapacity: e.target.value })} containerClassName="w-36" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Select label="Espaço" value={s.roomId} onChange={(e) => setSpace(i, { roomId: e.target.value, coffeeInRoom: false })}>
                        <option value="">Selecione</option>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} — {r.building}, {upToText(r)}
                          </option>
                        ))}
                      </Select>
                      {room?.requiresBoardApproval && (
                        <p className="text-sm text-warning-foreground">Este espaço depende de autorização da Diretoria Executiva: o NUCEV pede na análise.</p>
                      )}
                      {room?.roomType === "CLASSROOM" && room.coffeeAllowed && (
                        <Switch
                          checked={s.coffeeInRoom}
                          onChange={(coffeeInRoom) => setSpace(i, { coffeeInRoom })}
                          label="Coffee break na própria sala"
                          description="Com autorização do Núcleo de Eventos e adicional de 20% (Portaria 2794, Art. 5º)."
                        />
                      )}
                    </div>
                  )}
                  <Input label="Para quê" placeholder="Ex.: sala principal, credenciamento, coffee" value={s.purpose} onChange={(e) => setSpace(i, { purpose: e.target.value })} />
                  {draft.days.length > 1 && (
                    <fieldset>
                      <legend className="text-sm font-medium">Dias</legend>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={s.dates.length === 0} onChange={() => setSpace(i, { dates: s.dates.length === 0 ? [draft.days[0]!.date] : [] })} className="size-4 accent-[var(--primary)]" />
                          Todos os dias
                        </label>
                        {s.dates.length > 0 &&
                          draft.days.map((d) => (
                            <label key={d.date} className="inline-flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={s.dates.includes(d.date)}
                                onChange={(e) => setSpace(i, { dates: e.target.checked ? [...s.dates, d.date] : s.dates.filter((x) => x !== d.date) })}
                                className="size-4 accent-[var(--primary)]"
                              />
                              {dayLabel(d.date)}
                            </label>
                          ))}
                      </div>
                    </fieldset>
                  )}
                  <AvailabilityNote availability={availability?.[i]} />
                </li>
              );
            })}
          </ul>
          <Button variant="secondary" icon={PlusIcon} onClick={() => set("spaces", [...draft.spaces, emptySpace()])}>
            Mais um espaço
          </Button>
        </Card>
      )}

      {step === 3 && (
        <Card className="space-y-5 p-4 sm:p-6">
          <div className="space-y-3 rounded-xl border border-border p-4">
            <Switch checked={draft.coffeeBreak} onChange={(v) => set("coffeeBreak", v)} label="Vai ter coffee break" />
            {draft.coffeeBreak && (
              <Input label="Pessoas no coffee break" type="number" inputMode="numeric" min={1} value={draft.coffeeAttendees} onChange={(e) => set("coffeeAttendees", e.target.value)} containerClassName="sm:max-w-xs" />
            )}
          </div>
          {draft.coffeeBreak && (
            <section className="space-y-3">
              {coffeeWarning ? <Alert tone="warning">{coffeeWarning}</Alert> : <Alert tone="success">O espaço escolhido comporta o coffee break.</Alert>}
              <h3 className="text-sm font-semibold">Espaços que podem ter coffee break</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {coffeeRooms.map((r) => {
                  const limit = coffeeLimit(r);
                  const added = draft.spaces.some((s) => s.mode === "room" && s.roomId === r.id);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-medium"><CoffeeIcon size={16} aria-hidden /> {r.name}</p>
                        <p className="text-sm text-muted">
                          {limit === "sem limite" ? "sem limite cadastrado" : `até ${limit} pessoas`}
                          {r.recommendedAbove ? ` · indicado para mais de ${r.recommendedAbove}` : ""}
                          {r.requiresBoardApproval ? " · autorização da Diretoria" : ""}
                        </p>
                      </div>
                      {added ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="flex items-center gap-1 text-sm font-medium text-success-foreground">
                            <CheckCircleIcon size={16} aria-hidden /> Escolhido
                          </span>
                          <Button size="sm" variant="ghost" icon={TrashIcon} aria-label={`Tirar ${r.name}`} onClick={() => removeRoom(r.id)}>
                            Tirar
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => set("spaces", [...draft.spaces.filter(spaceChosen), { ...emptySpace(), mode: "room", roomId: r.id, purpose: "Coffee break" }])}
                        >
                          Usar
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <Textarea label="Equipamentos e infraestrutura" rows={3} value={draft.infrastructure} onChange={(e) => set("infrastructure", e.target.value)} placeholder="Ex.: 4 microfones sem fio, transmissão ao vivo, mesas de credenciamento" />
          <Textarea label="Observações" rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
        </Card>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <Card className="space-y-4 p-4 sm:p-6">
            <h2 className="text-lg font-semibold">{draft.title}</h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Tipo</dt><dd>{CULTURE_KIND_LABELS[draft.kind] ?? "—"}</dd></div>
              <div><dt className="text-muted">Público previsto</dt><dd>{draft.expectedAttendees} pessoas</dd></div>
              <div><dt className="text-muted">Responsável</dt><dd>{draft.responsible} · {draft.responsibleContact}</dd></div>
              <div><dt className="text-muted">Coffee break</dt><dd>{draft.coffeeBreak ? `Sim, ${draft.coffeeAttendees} pessoas` : "Não"}</dd></div>
            </dl>
            <section>
              <h3 className="text-sm font-semibold">Dias</h3>
              <ul className="mt-1 text-sm">
                {draft.days.map((d) => (
                  <li key={d.date}>
                    {dayLabel(d.date)}: {d.start}–{d.end}
                    {Number(d.setupMinutes) > 0 ? ` · montagem ${Number(d.setupMinutes) / 60} h` : ""}
                    {Number(d.teardownMinutes) > 0 ? ` · desmontagem ${Number(d.teardownMinutes) / 60} h` : ""}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Espaços</h3>
              <ul className="mt-1 space-y-2 text-sm">
                {draft.spaces.map((s, i) => {
                  const category = categories.find((c) => c.id === s.categoryId);
                  const label =
                    s.mode === "room"
                      ? (roomById.get(s.roomId)?.name ?? "—")
                      : `${Number(s.count) > 1 ? `${s.count} × ` : ""}${category?.name ?? "—"}${s.minCapacity ? ` (para ${s.minCapacity} pessoas)` : ""}`;
                  return (
                    <li key={i}>
                      <p className="font-medium">
                        {label}
                        {s.purpose ? <span className="font-normal text-muted"> · {s.purpose}</span> : null}
                        {s.dates.length > 0 ? <span className="font-normal text-muted"> · {s.dates.map(dayLabel).join(", ")}</span> : null}
                      </p>
                      <AvailabilityNote availability={availability?.[i]} />
                    </li>
                  );
                })}
              </ul>
            </section>
          </Card>

          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold">Orçamento estimado</h2>
            <p className="mb-4 text-sm text-muted">Pela Portaria 2794. O NUCEV confere e envia o orçamento oficial; os espaços só ficam garantidos com a pré-reserva do SAD.</p>
            {estimateError ? <Alert tone="warning">{estimateError}</Alert> : estimate ? <QuoteBreakdown estimate={estimate} /> : <p className="text-sm text-muted">Calculando…</p>}
            {possiblyExempt && <Alert tone="info" className="mt-4">Evento da FMUSP sem inscrição e sem patrocínio: pode ser isento (Portaria 2794, Art. 4º I). O NUCEV confere.</Alert>}
          </Card>

          <Card className="space-y-4 p-4 sm:p-6">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={draft.termsAccepted} onChange={(e) => set("termsAccepted", e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span>
                Li e aceito o{" "}
                <Link to="/regulamento" className="font-medium text-primary underline-offset-2 hover:underline">
                  Regulamento de Uso dos Espaços da FMUSP
                </Link>{" "}
                (Portarias 2793 e 2794), inclusive a proibição de comércio e de bebidas alcoólicas.
              </span>
            </label>
            {serverError && <Alert tone="danger">{serverError}</Alert>}
          </Card>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" icon={ArrowLeftIcon} disabled={step === 0} onClick={() => { setProblems([]); setStep((s) => s - 1); }}>
          Voltar
        </Button>
        {step < STEPS.length - 1 ? (
          <Button iconRight={ArrowRightIcon} onClick={next}>
            Continuar
          </Button>
        ) : (
          <Button icon={PaperPlaneTiltIcon} loading={sending} onClick={() => void submit()}>
            Enviar pedido
          </Button>
        )}
      </div>
    </div>
  );
}
