import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsLeftRightIcon,
  CalendarBlankIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  UsersIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { capitalizeFirst, formatShortDate, plural } from "../../lib/format";
import { ACTIVITY_ICONS, resourceIcon } from "../../lib/icons";
import { previewWeeklyDates } from "../../lib/recurrence";
import { validateReservationTimes } from "../../lib/reservationValidation";
import { useToast } from "../../lib/toast";
import type { ActivityType, Reservation, Resource } from "../../lib/types";
import { Button } from "../ui/Button";
import { Alert } from "../ui/Feedback";
import { Input, Select, Switch, Textarea } from "../ui/Field";
import { QuantityStepper } from "../ui/QuantityStepper";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card, IconTile, PageHeader } from "../ui/Surface";
import { ActivityFields, attendeesOf, INITIAL_DETAIL_VALUES, type DetailValues } from "./ActivityFields";

const WEEKDAYS: { code: string; label: string; full: string }[] = [
  { code: "MO", label: "Seg", full: "Segunda" },
  { code: "TU", label: "Ter", full: "Terça" },
  { code: "WE", label: "Qua", full: "Quarta" },
  { code: "TH", label: "Qui", full: "Quinta" },
  { code: "FR", label: "Sex", full: "Sexta" },
  { code: "SA", label: "Sáb", full: "Sábado" },
  { code: "SU", label: "Dom", full: "Domingo" },
];

const ACTIVITY_DESCRIPTIONS: Record<ActivityType, string> = {
  UNDERGRADUATE: "Aulas, provas e atividades das disciplinas de graduação.",
  GRADUATE: "Disciplinas e seminários dos programas de pós-graduação.",
  CULTURE_EXTENSION: "Congressos, cursos, palestras, ligas e eventos.",
  PUBLIC_EXAM: "Concursos docentes e processos seletivos.",
  DEFENSE: "Defesas de mestrado e doutorado.",
};

const FORM_ID = "formulario-reserva";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mensagens do VALIDATION_ERROR da API ({ formErrors, fieldErrors } do zod `flatten()`). */
function validationMessages(details: unknown): string[] {
  const flat = details as { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | undefined;
  return [...new Set([...(flat?.formErrors ?? []), ...Object.values(flat?.fieldErrors ?? {}).flat()])];
}

/** Envolve o formulário com uma `key`: "Nova solicitação" remonta tudo do zero. */
export function ReservationPage() {
  const [formKey, setFormKey] = useState(0);
  return <ReservationForm key={formKey} onReset={() => setFormKey((k) => k + 1)} />;
}

function ActivityPicker({ onPick }: { onPick: (type: ActivityType) => void }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Reservar uma sala" description="Comece pelo tipo de atividade — cada uma tem um formulário próprio." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ACTIVITY_TYPES.map((type, index) => (
          <button
            key={type}
            type="button"
            onClick={() => onPick(type)}
            style={{ animationDelay: `${index * 50}ms` }}
            className="group flex animate-fade-in-up flex-col gap-4 rounded-2xl border border-border bg-surface p-5 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <IconTile icon={ACTIVITY_ICONS[type]} size="lg" />
              <ArrowRightIcon
                size={20}
                aria-hidden
                className="text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary"
              />
            </div>
            <div>
              <p className="font-display text-lg font-semibold">{ACTIVITY_TYPE_LABELS[type]}</p>
              <p className="mt-1 text-sm text-muted">{ACTIVITY_DESCRIPTIONS[type]}</p>
            </div>
          </button>
        ))}
      </div>
      <Alert tone="info" title="Como funciona">
        Você descreve o que precisa; o SAD (Serviço de Apoio Didático) escolhe a sala disponível mais adequada ao aprovar, e você
        recebe a resposta por e-mail.
      </Alert>
    </div>
  );
}

function FormSection({ step, title, description, children }: { step: number; title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {step}
        </span>
        <div className="pt-0.5">
          <h2 className="text-lg leading-tight font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function ChecklistItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={cn("flex items-center gap-2 text-sm", ok ? "text-success-foreground" : "text-muted")}>
      {ok ? <CheckCircleIcon size={18} weight="fill" aria-hidden /> : <CircleIcon size={18} aria-hidden />}
      <span>
        {children}
        <span className="sr-only">{ok ? " — ok" : " — pendente"}</span>
      </span>
    </li>
  );
}

/**
 * Formulário de solicitação de reserva. Começa pela escolha do tipo de
 * atividade (Graduação, Pós, Cultura e Extensão, Concurso, Defesa): cada tipo
 * tem seus próprios campos; datas e recursos são iguais para todos. Não pede
 * sala — o Admin aloca a mais adequada ao aprovar.
 */
function ReservationForm({ onReset }: { onReset: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [resources, setResources] = useState<Resource[]>([]);

  const [activityType, setActivityType] = useState<ActivityType | null>(null);
  const [details, setDetails] = useState<DetailValues>(INITIAL_DETAIL_VALUES);
  const [description, setDescription] = useState("");
  const [supportNotes, setSupportNotes] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  // Recursos marcados (a chave é o id), com a quantidade/detalhe como digitados.
  const [selectedResources, setSelectedResources] = useState<Record<string, { quantity: string; detail: string }>>({});

  const [date, setDate] = useState(todayPlus(4));
  const [startTimeStr, setStartTimeStr] = useState("14:00");
  const [endTimeStr, setEndTimeStr] = useState("16:00");

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [interval, setInterval_] = useState<"1" | "2">("1");
  const [weekdays, setWeekdays] = useState<Set<string>>(new Set());
  const [until, setUntil] = useState(todayPlus(60));

  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [result, setResult] = useState<Reservation[] | null>(null);

  useEffect(() => {
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources));
  }, []);

  const startDate = useMemo(() => (date && startTimeStr ? new Date(`${date}T${startTimeStr}:00`) : null), [date, startTimeStr]);
  const endDate = useMemo(() => (date && endTimeStr ? new Date(`${date}T${endTimeStr}:00`) : null), [date, endTimeStr]);
  const clientErrors = useMemo(() => validateReservationTimes(startDate, endDate), [startDate, endDate]);

  const previewDates = useMemo(
    () => (recurrenceEnabled ? previewWeeklyDates(date, until, weekdays, Number(interval)) : []),
    [recurrenceEnabled, date, until, weekdays, interval],
  );

  // Ao ligar a recorrência, já marca o dia da semana da data escolhida.
  function toggleRecurrence(enabled: boolean) {
    setRecurrenceEnabled(enabled);
    if (enabled && weekdays.size === 0 && date) {
      const code = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date(`${date}T12:00:00`).getDay()]!;
      setWeekdays(new Set([code]));
    }
  }

  function toggleWeekday(code: string) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleResource(id: string) {
    setSelectedResources((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = { quantity: "1", detail: "" };
      return next;
    });
  }

  function updateResource(id: string, patch: Partial<{ quantity: string; detail: string }>) {
    setSelectedResources((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  const recurrenceOk = !recurrenceEnabled || (weekdays.size > 0 && previewDates.length > 0);
  const canSubmit = clientErrors.length === 0 && recurrenceOk && termsAccepted && !submitting;

  async function submit() {
    setSubmitting(true);
    setSubmitErrors([]);
    try {
      const rrule = recurrenceEnabled
        ? `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${WEEKDAYS.filter((w) => weekdays.has(w.code))
            .map((w) => w.code)
            .join(",")}`
        : null;

      const res = await api<{ reservations: Reservation[] }>("/reservations", {
        method: "POST",
        body: JSON.stringify({
          activityType,
          description,
          details,
          requestedResources: resources
            .filter((r) => selectedResources[r.id])
            .map((r) => ({
              resourceId: r.id,
              quantity: r.requestsQuantity ? Number(selectedResources[r.id]!.quantity) : undefined,
              detail:
                r.detailPrompt || r.detailOptions.length > 0 ? selectedResources[r.id]!.detail.trim() || undefined : undefined,
            })),
          supportNotes: supportNotes || undefined,
          termsAccepted: true,
          startTime: startDate!.toISOString(),
          endTime: endDate!.toISOString(),
          recurrence: rrule ? { rrule, until: new Date(`${until}T23:59:59`).toISOString() } : undefined,
        }),
      });
      setResult(res.reservations);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const messages = e instanceof ApiError && e.code === "VALIDATION_ERROR" ? validationMessages(e.details) : [];
      const list = messages.length > 0 ? messages : [e instanceof Error ? e.message : "Falha ao enviar a solicitação."];
      setSubmitErrors(list);
      toast.error("Não foi possível enviar a solicitação.", list[0]);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Card className="mx-auto max-w-lg animate-fade-in-up p-8 text-center">
        <span className="mx-auto grid size-16 animate-pop place-items-center rounded-full bg-success-soft text-success-foreground">
          <CheckCircleIcon size={40} weight="fill" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Solicitação enviada!</h1>
        <p className="mt-2 text-muted">
          {result.length === 1 ? "Sua solicitação foi registrada" : `${result.length} datas foram registradas`} como{" "}
          <strong className="text-foreground">pendente</strong>. Você recebe um e-mail quando o SAD aprovar ou rejeitar.
        </p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2">
          {result.slice(0, 12).map((r) => (
            <li key={r.id} className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary-soft-foreground tabular-nums">
              {formatShortDate(r.startTime)}
            </li>
          ))}
          {result.length > 12 && <li className="px-2 py-1 text-xs text-muted">+{result.length - 12}</li>}
        </ul>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button icon={CalendarCheckIcon} onClick={() => navigate("/minhas-reservas")}>
            Ver minhas reservas
          </Button>
          <Button variant="secondary" icon={PlusIcon} onClick={onReset}>
            Nova solicitação
          </Button>
        </div>
      </Card>
    );
  }

  // 1º passo: escolher o tipo de atividade, que define o formulário.
  if (!activityType) return <ActivityPicker onPick={setActivityType} />;

  const ActivityIcon = ACTIVITY_ICONS[activityType];
  const attendees = attendeesOf(activityType, details);
  const chosenResources = resources.filter((r) => selectedResources[r.id]);
  const dateLabel =
    startDate && !Number.isNaN(startDate.getTime())
      ? capitalizeFirst(startDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))
      : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={ArrowLeftIcon} onClick={() => setActivityType(null)} className="-ml-3">
          Tipos de atividade
        </Button>
      </div>
      <PageHeader title="Reservar uma sala" description={`${ACTIVITY_TYPE_LABELS[activityType]} — preencha os dados e envie para o SAD.`} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form
          id={FORM_ID}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
          className="space-y-6"
        >
          <FormSection step={1} title="Quando" description="Funcionamento das 07:30 às 22:30, com no mínimo 3 dias de antecedência.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Data" type="date" required value={date} min={todayPlus(3)} onChange={(e) => setDate(e.target.value)} />
              <Input label="Início" type="time" required step={300} value={startTimeStr} onChange={(e) => setStartTimeStr(e.target.value)} />
              <Input label="Término" type="time" required step={300} value={endTimeStr} onChange={(e) => setEndTimeStr(e.target.value)} />
            </div>

            {clientErrors.length > 0 && (
              <Alert tone="warning" className="mt-4">
                <ul className="space-y-0.5">
                  {clientErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <div className="mt-5 rounded-xl border border-border p-4">
              <Switch
                checked={recurrenceEnabled}
                onChange={toggleRecurrence}
                label="Repetir esta reserva"
                description="Para aulas e encontros que se repetem toda semana ou a cada 15 dias."
              />
              {recurrenceEnabled && (
                <div className="mt-5 animate-fade-in space-y-5 border-t border-border pt-5">
                  <fieldset>
                    <legend className="text-sm font-medium">Dias da semana</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WEEKDAYS.map((w) => {
                        const on = weekdays.has(w.code);
                        return (
                          <button
                            key={w.code}
                            type="button"
                            aria-pressed={on}
                            aria-label={w.full}
                            onClick={() => toggleWeekday(w.code)}
                            className={cn(
                              "h-11 min-w-12 rounded-lg border px-3 text-sm font-semibold transition-colors",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border-strong text-muted hover:border-primary/50 hover:text-foreground",
                            )}
                          >
                            {w.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Frequência</span>
                      <SegmentedControl
                        label="Frequência"
                        value={interval}
                        onChange={setInterval_}
                        options={[
                          { value: "1", label: "Semanal" },
                          { value: "2", label: "Quinzenal" },
                        ]}
                      />
                    </div>
                    <Input label="Repetir até" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
                  </div>
                  {weekdays.size === 0 ? (
                    <Alert tone="warning">Escolha ao menos um dia da semana.</Alert>
                  ) : previewDates.length === 0 ? (
                    <Alert tone="warning">Nenhuma data cai nesse período. Ajuste o "Repetir até" ou os dias.</Alert>
                  ) : (
                    <div>
                      <p className="text-sm font-medium">{plural(previewDates.length, "data", "datas")} nesta série</p>
                      <ul className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                        {previewDates.map((d) => (
                          <li
                            key={d}
                            className="rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary-soft-foreground tabular-nums"
                          >
                            {formatShortDate(`${d}T12:00:00`)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </FormSection>

          <FormSection step={2} title="Sobre a atividade">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-soft p-3">
              <div className="flex items-center gap-3">
                <IconTile icon={ActivityIcon} size="sm" />
                <div className="leading-tight">
                  <p className="text-xs text-primary-soft-foreground/80">Atividade</p>
                  <p className="font-semibold text-primary-soft-foreground">{ACTIVITY_TYPE_LABELS[activityType]}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" icon={ArrowsLeftRightIcon} onClick={() => setActivityType(null)}>
                Trocar
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Textarea
                label="Descrição"
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva a atividade. Se precisar de um tipo específico de espaço (auditório, laboratório…), mencione aqui."
                containerClassName="sm:col-span-2"
              />
              <ActivityFields type={activityType} values={details} onChange={(name, value) => setDetails((prev) => ({ ...prev, [name]: value }))} />
            </div>
          </FormSection>

          <FormSection step={3} title="Recursos" description="Marque o que vai precisar. Não precisa de nada? É só seguir em frente.">
            <div className="grid gap-3 sm:grid-cols-2">
              {resources.map((r) => {
                const selected = selectedResources[r.id];
                const ResourceIcon = resourceIcon(r.name);
                const hasExtra = r.requestsQuantity || r.detailPrompt || r.detailOptions.length > 0;
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "min-w-0 rounded-xl border p-3 transition-[border-color,background-color] duration-150 has-[input[type=checkbox]:focus-visible]:ring-2 has-[input[type=checkbox]:focus-visible]:ring-ring",
                      selected ? "border-primary bg-primary-soft/50" : "border-border hover:border-border-strong",
                    )}
                  >
                    <label className="flex items-center gap-3">
                      <input type="checkbox" className="sr-only" checked={!!selected} onChange={() => toggleResource(r.id)} />
                      <span
                        className={cn(
                          "grid size-10 shrink-0 place-items-center rounded-lg transition-colors",
                          selected ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted",
                        )}
                      >
                        <ResourceIcon size={20} weight={selected ? "fill" : "duotone"} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{r.name}</span>
                        {r.description && <span className="block truncate text-xs text-muted">{r.description}</span>}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                          selected ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
                        )}
                      >
                        {selected && <CheckIcon size={14} weight="bold" />}
                      </span>
                    </label>
                    {selected && hasExtra && (
                      <div className="mt-3 flex animate-fade-in flex-wrap items-center gap-2">
                        {r.requestsQuantity && (
                          <QuantityStepper
                            label={`Quantidade de ${r.name}`}
                            value={selected.quantity}
                            onChange={(quantity) => updateResource(r.id, { quantity })}
                          />
                        )}
                        {r.detailOptions.length > 0 ? (
                          <Select
                            aria-label={`${r.detailPrompt ?? "Detalhe"} (${r.name})`}
                            required
                            value={selected.detail}
                            onChange={(e) => updateResource(r.id, { detail: e.target.value })}
                            containerClassName="min-w-0 flex-1"
                          >
                            <option value="" disabled>
                              {r.detailPrompt ?? "Selecione"}
                            </option>
                            {r.detailOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          r.detailPrompt && (
                            <Input
                              aria-label={`Detalhe de ${r.name}`}
                              placeholder={r.detailPrompt}
                              maxLength={200}
                              value={selected.detail}
                              onChange={(e) => updateResource(r.id, { detail: e.target.value })}
                              containerClassName="min-w-0 flex-1"
                            />
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Textarea
              label="Observações para TI/infraestrutura"
              rows={2}
              value={supportNotes}
              onChange={(e) => setSupportNotes(e.target.value)}
              hint="Opcional. Ex.: chegar 15 minutos antes para testar a transmissão."
              containerClassName="mt-5"
            />
          </FormSection>
        </form>

        {/* Resumo (fica fixo ao rolar no computador) */}
        <aside className="lg:sticky lg:top-10 lg:row-span-2">
          <Card className="p-5">
            <h2 className="text-base font-semibold">Resumo</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex gap-3">
                <dt className="sr-only">Atividade</dt>
                <ActivityIcon size={20} className="shrink-0 text-muted" aria-hidden />
                <dd className="font-medium">{ACTIVITY_TYPE_LABELS[activityType]}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="sr-only">Quando</dt>
                <CalendarBlankIcon size={20} className="shrink-0 text-muted" aria-hidden />
                <dd>
                  <span>{dateLabel}</span>
                  <span className="block text-muted tabular-nums">
                    {startTimeStr}–{endTimeStr}
                    {recurrenceEnabled && previewDates.length > 0 && ` · ${plural(previewDates.length, "data", "datas")}`}
                  </span>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="sr-only">Pessoas</dt>
                <UsersIcon size={20} className="shrink-0 text-muted" aria-hidden />
                <dd>{attendees ? plural(Number(attendees), "pessoa", "pessoas") : <span className="text-muted">Nº de pessoas a informar</span>}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="sr-only">Recursos</dt>
                <WrenchIcon size={20} className="shrink-0 text-muted" aria-hidden />
                <dd className={chosenResources.length === 0 ? "text-muted" : undefined}>
                  {chosenResources.length === 0
                    ? "Nenhum recurso"
                    : chosenResources
                        .map((r) => `${r.name}${r.requestsQuantity ? ` (${selectedResources[r.id]!.quantity})` : ""}`)
                        .join(", ")}
                </dd>
              </div>
            </dl>
            <ul className="mt-5 space-y-2 border-t border-border pt-4">
              <ChecklistItem ok={clientErrors.length === 0}>Data e horário dentro das regras</ChecklistItem>
              {recurrenceEnabled && <ChecklistItem ok={recurrenceOk}>Datas da série definidas</ChecklistItem>}
              <ChecklistItem ok={termsAccepted}>Regulamento aceito</ChecklistItem>
            </ul>
            {/* No celular o botão fica no fim do formulário; aqui só no computador. */}
            <div className="mt-5 hidden lg:block">
              <Button type="submit" form={FORM_ID} size="lg" icon={PaperPlaneTiltIcon} loading={submitting} disabled={!canSubmit} className="w-full">
                Enviar solicitação
              </Button>
            </div>
          </Card>
        </aside>

        <Card className="space-y-4 p-5 sm:p-6 lg:col-start-1">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              form={FORM_ID}
              required
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 size-5 shrink-0"
            />
            <span>
              Li e concordo com o <strong>Regulamento de Uso dos Espaços da FMUSP</strong>.
            </span>
          </label>
          {submitErrors.length > 0 && (
            <Alert tone="danger" title="Revise a solicitação">
              <ul className="list-disc space-y-0.5 pl-4">
                {submitErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="lg:hidden">
            <Button type="submit" form={FORM_ID} size="lg" icon={PaperPlaneTiltIcon} loading={submitting} disabled={!canSubmit} className="w-full">
              Enviar solicitação
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
