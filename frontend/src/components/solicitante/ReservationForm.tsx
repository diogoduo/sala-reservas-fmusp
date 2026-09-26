import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { validateReservationTimes } from "../../lib/reservationValidation";
import type { ActivityType, Reservation, Resource } from "../../lib/types";
import { ActivityFields, INITIAL_DETAIL_VALUES, type DetailValues } from "./ActivityFields";

const WEEKDAYS: { code: string; label: string }[] = [
  { code: "MO", label: "Seg" },
  { code: "TU", label: "Ter" },
  { code: "WE", label: "Qua" },
  { code: "TH", label: "Qui" },
  { code: "FR", label: "Sex" },
  { code: "SA", label: "Sáb" },
  { code: "SU", label: "Dom" },
];

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Mensagens do VALIDATION_ERROR da API ({ formErrors, fieldErrors } do zod `flatten()`). */
function validationMessages(details: unknown): string[] {
  const flat = details as { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | undefined;
  return [...new Set([...(flat?.formErrors ?? []), ...Object.values(flat?.fieldErrors ?? {}).flat()])];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="mt-3 px-1">{children}</div>
    </section>
  );
}

interface Props {
  onDone: () => void;
}

/**
 * Formulário de solicitação de reserva. Começa pela escolha do tipo de
 * atividade (Graduação, Pós, Cultura e Extensão, Concurso, Defesa): cada tipo
 * tem seus próprios campos em "Informações da reserva"; datas e recursos são
 * iguais para todos. Não pede sala — o Admin aloca a mais adequada ao aprovar.
 */
export function ReservationForm({ onDone }: Props) {
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
  const [endTimeStr, setEndTimeStr] = useState("15:00");

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [interval, setInterval_] = useState<1 | 2>(1);
  const [weekdays, setWeekdays] = useState<Set<string>>(new Set());
  const [until, setUntil] = useState(todayPlus(30));

  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [result, setResult] = useState<Reservation[] | null>(null);

  useEffect(() => {
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources));
  }, []);

  const startDate = useMemo(() => (date && startTimeStr ? new Date(`${date}T${startTimeStr}:00`) : null), [date, startTimeStr]);
  const endDate = useMemo(() => (date && endTimeStr ? new Date(`${date}T${endTimeStr}:00`) : null), [date, endTimeStr]);

  const clientErrors = useMemo(() => validateReservationTimes(startDate, endDate), [startDate, endDate]);

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

  async function submit() {
    setSubmitting(true);
    setSubmitErrors([]);
    try {
      const rrule =
        recurrenceEnabled && weekdays.size > 0
          ? `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${Array.from(weekdays).join(",")}`
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
    } catch (e) {
      const messages = e instanceof ApiError && e.code === "VALIDATION_ERROR" ? validationMessages(e.details) : [];
      setSubmitErrors(messages.length > 0 ? messages : [e instanceof Error ? e.message : "Falha ao enviar a solicitação."]);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <h3 className="font-medium text-emerald-800">Solicitação enviada!</h3>
        <p className="mt-1 text-sm text-emerald-700">
          {result.length === 1 ? "1 solicitação foi registrada" : `${result.length} solicitações foram registradas`} com status{" "}
          <strong>Pendente</strong>. A Secretaria/TI vai alocar uma sala e aprovar ou rejeitar em breve.
        </p>
        <ul className="mt-2 text-sm text-emerald-700">
          {result.map((r) => (
            <li key={r.id}>
              {new Date(r.startTime).toLocaleString("pt-BR")} – {new Date(r.endTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </li>
          ))}
        </ul>
        <button onClick={onDone} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          Nova solicitação
        </button>
      </div>
    );
  }

  const activitySelect = (
    <select
      required
      value={activityType ?? ""}
      onChange={(e) => setActivityType(e.target.value as ActivityType)}
      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
    >
      <option value="" disabled>
        Clique para selecionar…
      </option>
      {ACTIVITY_TYPES.map((t) => (
        <option key={t} value={t}>
          {ACTIVITY_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );

  // 1º passo: escolher o tipo de atividade, que define o formulário.
  if (!activityType) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-slate-200 p-8">
        <h3 className="text-center text-lg font-semibold">Reservar uma sala</h3>
        <p className="text-center text-sm text-slate-500">Faculdade de Medicina da USP</p>
        <label className="mt-6 block">
          <span className="text-sm font-medium text-slate-700">Selecione a atividade</span>
          {activitySelect}
        </label>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-6"
    >
      <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        Você descreve o que precisa; a Secretaria/TI escolhe a sala disponível mais adequada ao aprovar.
      </p>

      <Section title="Agendamento de datas">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700">Data</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Início</label>
            <input type="time" required value={startTimeStr} onChange={(e) => setStartTimeStr(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Término</label>
            <input type="time" required value={endTimeStr} onChange={(e) => setEndTimeStr(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={recurrenceEnabled} onChange={(e) => setRecurrenceEnabled(e.target.checked)} />
            Repetir esta reserva
          </label>
          {recurrenceEnabled && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((w) => (
                  <button
                    type="button"
                    key={w.code}
                    onClick={() => toggleWeekday(w.code)}
                    className={`rounded-md border px-3 py-1 text-sm ${weekdays.has(w.code) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={interval === 1} onChange={() => setInterval_(1)} /> Semanal
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={interval === 2} onChange={() => setInterval_(2)} /> Quinzenal
                </label>
                <label className="ml-auto flex items-center gap-2 text-sm">
                  Até <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
              </div>
              {weekdays.size === 0 && <p className="text-xs text-amber-600">Selecione ao menos um dia da semana.</p>}
            </div>
          )}
        </div>
      </Section>

      <Section title="Informações da reserva">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Atividade</span>
            {activitySelect}
          </label>
          <label className="col-span-2 block">
            <span className="text-sm font-medium text-slate-700">Descrição</span>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição completa da sua atividade. Se precisar de um tipo específico de espaço (ex.: auditório, laboratório), mencione aqui."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <ActivityFields
            type={activityType}
            values={details}
            onChange={(name, value) => setDetails((prev) => ({ ...prev, [name]: value }))}
          />
        </div>
      </Section>

      <Section title="Recursos para reserva">
        <div className="grid grid-cols-2 gap-2">
          {resources.map((r) => {
            const selected = selectedResources[r.id];
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2 text-sm">
                <label className="flex flex-1 items-center gap-2" title={r.description ?? undefined}>
                  <input type="checkbox" checked={!!selected} onChange={() => toggleResource(r.id)} />
                  {r.name}
                </label>
                {r.requestsQuantity && (
                  <input
                    type="number"
                    min={1}
                    required={!!selected}
                    disabled={!selected}
                    aria-label={`Quantidade de ${r.name}`}
                    value={selected?.quantity ?? "1"}
                    onChange={(e) => updateResource(r.id, { quantity: e.target.value })}
                    className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                  />
                )}
                {r.detailOptions.length > 0 ? (
                  <select
                    required={!!selected}
                    disabled={!selected}
                    aria-label={`Detalhe de ${r.name}`}
                    value={selected?.detail ?? ""}
                    onChange={(e) => updateResource(r.id, { detail: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                  >
                    <option value="" disabled>
                      {r.detailPrompt ?? "Selecione"}
                    </option>
                    {r.detailOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  r.detailPrompt && (
                    <input
                      disabled={!selected}
                      aria-label={`Detalhe de ${r.name}`}
                      placeholder={r.detailPrompt}
                      maxLength={200}
                      value={selected?.detail ?? ""}
                      onChange={(e) => updateResource(r.id, { detail: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                    />
                  )
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">Não precisa de nenhum equipamento? É só não marcar nada.</p>
        <label className="mt-3 block">
          <span className="text-sm font-medium text-slate-700">Observações para TI/infraestrutura (opcional)</span>
          <textarea rows={2} value={supportNotes} onChange={(e) => setSupportNotes(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </Section>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-0.5" />
        Li e concordo com o Regulamento de Uso dos Espaços da FMUSP.
      </label>

      {clientErrors.length > 0 && (
        <ul className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {clientErrors.map((err) => (
            <li key={err}>• {err}</li>
          ))}
        </ul>
      )}

      {submitErrors.length > 0 && (
        <ul className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {submitErrors.map((err) => (
            <li key={err}>• {err}</li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={submitting || clientErrors.length > 0 || !termsAccepted || (recurrenceEnabled && weekdays.size === 0)}
        className="rounded-md bg-slate-900 px-6 py-2 text-sm text-white disabled:opacity-50"
      >
        {submitting ? "Enviando…" : "Enviar solicitação"}
      </button>
    </form>
  );
}
