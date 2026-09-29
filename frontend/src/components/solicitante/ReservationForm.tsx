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
  PencilSimpleLineIcon,
  PlusIcon,
  UsersIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { capitalizeFirst, formatShortDate, plural } from "../../lib/format";
import { ACTIVITY_ICONS, resourceIcon } from "../../lib/icons";
import { previewWeeklyDates } from "../../lib/recurrence";
import { isEditable, notifyReservationsChanged } from "../../lib/reservations";
import { sortRooms } from "../../lib/rooms";
import { validateReservationTimes } from "../../lib/reservationValidation";
import { useToast } from "../../lib/toast";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { ActivityType, Reservation, Resource, ReviewScope, Room } from "../../lib/types";
import { isAdminActionable } from "../admin/ReservationActions";
import { RegulationDialog, useRegulationTitle } from "../regulation/Regulation";
import { RoomsPreview } from "../rooms/RoomsPreview";
import { Button } from "../ui/Button";
import { Alert, CardListSkeleton, EmptyState } from "../ui/Feedback";
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

/** Tela "Alterar reserva" (/minhas-reservas/:id/editar): o mesmo formulário, pré-preenchido. */
export function EditReservationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ reservation: Reservation }>(`/reservations/${id}`)
      .then((res) => setReservation(res.reservation))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const back = (
    <Button variant="secondary" icon={ArrowLeftIcon} onClick={() => navigate("/minhas-reservas")}>
      Minhas reservas
    </Button>
  );
  if (error) return <EmptyState icon={CalendarBlankIcon} title="Reserva não encontrada" description={error} action={back} />;
  if (!reservation) return <CardListSkeleton count={2} />;
  if (!isEditable(reservation)) {
    return (
      <EmptyState
        icon={CalendarBlankIcon}
        title="Esta reserva não pode mais ser alterada"
        description="Só dá para alterar reservas pendentes ou aprovadas com pelo menos 3 dias de antecedência. Se precisar, cancele e faça uma nova solicitação."
        action={back}
      />
    );
  }
  return <ReservationForm editing={reservation} />;
}

/**
 * "Alterar reserva" do SAD (/admin/reservas/:id/editar?voltar=…): o mesmo
 * formulário, sem as travas do solicitante. Ao salvar, volta para `voltar`.
 */
export function AdminEditReservationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("voltar")?.startsWith("/admin/") ? params.get("voltar")! : "/admin/solicitacoes";
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ reservation: Reservation }>(`/reservations/${id}`)
      .then((res) => setReservation(res.reservation))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const back = (
    <Button variant="secondary" icon={ArrowLeftIcon} onClick={() => navigate(returnTo)}>
      Voltar
    </Button>
  );
  if (error) return <EmptyState icon={CalendarBlankIcon} title="Reserva não encontrada" description={error} action={back} />;
  if (!reservation) return <CardListSkeleton count={2} />;
  if (!isAdminActionable(reservation)) {
    return (
      <EmptyState
        icon={CalendarBlankIcon}
        title="Esta reserva não pode ser alterada"
        description="Só dá para alterar reservas pendentes ou aprovadas que ainda não terminaram."
        action={back}
      />
    );
  }
  return <ReservationForm editing={reservation} asAdmin={{ returnTo }} />;
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
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Converte uma reserva salva nos valores do formulário (para alterá-la). */
function formValuesFrom(r: Reservation) {
  const details: DetailValues = { ...INITIAL_DETAIL_VALUES };
  for (const [key, value] of Object.entries(r.activityDetails ?? {})) {
    if (typeof value === "boolean") details[key] = value;
    else if (value !== null && value !== undefined) details[key] = String(value);
  }
  const start = new Date(r.startTime);
  const end = new Date(r.endTime);
  return {
    activityType: r.activityType,
    details,
    description: r.description,
    supportNotes: r.supportNotes ?? "",
    selectedResources: Object.fromEntries(
      r.requestedResources.map((x) => [x.resourceId, { quantity: String(x.quantity ?? 1), detail: x.detail ?? "" }]),
    ),
    date: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
    start: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
    end: `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
  };
}

interface ReservationFormProps {
  onReset?: () => void;
  /** Reserva existente a alterar (em vez de criar uma nova). */
  editing?: Reservation;
  /**
   * Alteração feita pelo SAD: sem a antecedência de 3 dias, pode trocar o tipo
   * de atividade e a sala (de uma aprovada), não volta para análise e, ao
   * salvar, retorna para `returnTo`.
   */
  asAdmin?: { returnTo: string };
}

function ReservationForm({ onReset, editing, asAdmin }: ReservationFormProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [initial] = useState(() => (editing ? formValuesFrom(editing) : null));

  const [activityType, setActivityType] = useState<ActivityType | null>(initial?.activityType ?? null);
  const [details, setDetails] = useState<DetailValues>(initial?.details ?? INITIAL_DETAIL_VALUES);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [supportNotes, setSupportNotes] = useState(initial?.supportNotes ?? "");
  // Numa alteração, o regulamento já tinha sido aceito no pedido original.
  const [termsAccepted, setTermsAccepted] = useState(editing !== undefined);
  // Recursos marcados (a chave é o id), com a quantidade/detalhe como digitados.
  const [selectedResources, setSelectedResources] = useState<Record<string, { quantity: string; detail: string }>>(
    initial?.selectedResources ?? {},
  );

  // Tudo começa em branco numa reserva nova (nada de data/horário sugeridos).
  const [date, setDate] = useState(initial?.date ?? "");
  const [startTimeStr, setStartTimeStr] = useState(initial?.start ?? "");
  const [endTimeStr, setEndTimeStr] = useState(initial?.end ?? "");
  // Alteração de uma data de série: só ela, ou ela e as próximas.
  const [scope, setScope] = useState<ReviewScope>("single");
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [showRegulation, setShowRegulation] = useState(false);
  const regulationTitle = useRegulationTitle();
  // Só o SAD troca a sala, e só de uma reserva aprovada.
  const [roomId, setRoomId] = useState(editing?.roomId ?? "");
  const [activeRooms, setActiveRooms] = useState<Room[]>([]);

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [interval, setInterval_] = useState<"1" | "2">("1");
  const [weekdays, setWeekdays] = useState<Set<string>>(new Set());
  const [until, setUntil] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [result, setResult] = useState<Reservation[] | null>(null);

  useEffect(() => {
    if (asAdmin && editing?.status === "APPROVED") {
      api<{ rooms: Room[] }>("/rooms?status=ACTIVE").then((res) => setActiveRooms(sortRooms(res.rooms)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Itens só de inventário (nobreak, splitter…) não são pedidos pelo solicitante.
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources.filter((r) => r.requestable)));
  }, []);

  const startDate = useMemo(() => (date && startTimeStr ? new Date(`${date}T${startTimeStr}:00`) : null), [date, startTimeStr]);
  const endDate = useMemo(() => (date && endTimeStr ? new Date(`${date}T${endTimeStr}:00`) : null), [date, endTimeStr]);
  const clientErrors = useMemo(
    () => validateReservationTimes(startDate, endDate, { requireAdvance: !asAdmin }),
    [startDate, endDate, asAdmin],
  );
  // O aviso de horário só aparece depois que data, início e término foram preenchidos.
  const timesFilled = Boolean(date && startTimeStr && endTimeStr);

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

      const payload = {
        activityType,
        description,
        details,
        requestedResources: resources
          .filter((r) => selectedResources[r.id])
          .map((r) => ({
            resourceId: r.id,
            quantity: r.requestsQuantity ? Number(selectedResources[r.id]!.quantity) : undefined,
            detail: r.detailPrompt || r.detailOptions.length > 0 ? selectedResources[r.id]!.detail.trim() || undefined : undefined,
          })),
        supportNotes: supportNotes || undefined,
        termsAccepted: true,
        startTime: startDate!.toISOString(),
        endTime: endDate!.toISOString(),
      };

      if (editing && asAdmin) {
        const res = await api<{ updatedIds: string[] }>(`/admin/reservations/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...payload, scope, roomId: roomId || null }),
        });
        toast.success(
          res.updatedIds.length === 1 ? "Reserva alterada" : `${res.updatedIds.length} datas alteradas`,
          "O solicitante foi avisado por e-mail.",
        );
        notifyReservationsChanged();
        navigate(asAdmin.returnTo);
        return;
      } else if (editing) {
        const res = await api<{ updatedIds: string[] }>(`/reservations/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...payload, scope }),
        });
        setSavedCount(res.updatedIds.length);
      } else {
        const res = await api<{ reservations: Reservation[] }>("/reservations", {
          method: "POST",
          body: JSON.stringify({ ...payload, recurrence: rrule ? { rrule, until: new Date(`${until}T23:59:59`).toISOString() } : undefined }),
        });
        setResult(res.reservations);
      }
      window.scrollTo({ top: 0 });
    } catch (e) {
      const messages = e instanceof ApiError && e.code === "VALIDATION_ERROR" ? validationMessages(e.details) : [];
      const list = messages.length > 0 ? messages : [e instanceof Error ? e.message : "Falha ao enviar a solicitação."];
      setSubmitErrors(list);
      toast.error(editing ? "Não foi possível salvar a alteração." : "Não foi possível enviar a solicitação.", list[0]);
    } finally {
      setSubmitting(false);
    }
  }

  if (savedCount !== null) {
    return (
      <Card className="mx-auto max-w-lg animate-fade-in-up p-8 text-center">
        <span className="mx-auto grid size-16 animate-pop place-items-center rounded-full bg-info-soft text-info-foreground">
          <PencilSimpleLineIcon size={36} weight="fill" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Alteração enviada!</h1>
        <p className="mt-2 text-muted">
          {savedCount === 1 ? "A reserva voltou" : `As ${savedCount} datas voltaram`} para análise do SAD e{" "}
          {savedCount === 1 ? "aparece" : "aparecem"} como <strong className="text-foreground">alterada</strong>. Você recebe um
          e-mail quando o SAD aprovar ou rejeitar.
        </p>
        <div className="mt-8 flex justify-center">
          <Button icon={CalendarCheckIcon} onClick={() => navigate("/minhas-reservas")}>
            Ver minhas reservas
          </Button>
        </div>
      </Card>
    );
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
  const dayOnly = date ? new Date(`${date}T12:00:00`) : null;
  const dateLabel =
    dayOnly && !Number.isNaN(dayOnly.getTime())
      ? capitalizeFirst(dayOnly.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))
      : "Data a definir";

  // O tipo de atividade não muda numa alteração (só nas reservas antigas, que ainda não tinham tipo).
  const activityLocked = !asAdmin && editing?.activityType != null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {asAdmin ? (
          <Button variant="ghost" size="sm" icon={ArrowLeftIcon} onClick={() => navigate(asAdmin.returnTo)} className="-ml-3">
            Voltar
          </Button>
        ) : editing ? (
          <Button variant="ghost" size="sm" icon={ArrowLeftIcon} onClick={() => navigate("/minhas-reservas")} className="-ml-3">
            Minhas reservas
          </Button>
        ) : (
          <Button variant="ghost" size="sm" icon={ArrowLeftIcon} onClick={() => setActivityType(null)} className="-ml-3">
            Tipos de atividade
          </Button>
        )}
      </div>
      <PageHeader
        title={asAdmin ? "Alterar reserva (SAD)" : editing ? "Alterar reserva" : "Reservar uma sala"}
        description={
          editing
            ? `${ACTIVITY_TYPE_LABELS[activityType]} — ${editing.title}${asAdmin && editing.user ? ` · de ${editing.user.name}` : ""}`
            : `${ACTIVITY_TYPE_LABELS[activityType]} — preencha os dados e envie para o SAD.`
        }
      />
      {asAdmin && editing && (
        <Alert tone="info" title="O solicitante recebe um e-mail com a alteração">
          {editing.status === "APPROVED"
            ? "A reserva continua aprovada. Se mudar a sala ou o horário, o sistema confere se a sala está livre antes de salvar."
            : "A reserva continua em análise; a sala é escolhida na aprovação."}
        </Alert>
      )}
      {editing && !asAdmin && (
        <Alert tone={editing.status === "APPROVED" ? "warning" : "info"} title="Ao salvar, a reserva volta para análise do SAD">
          {editing.status === "APPROVED" && editing.room
            ? `Ela está aprovada na ${editing.room.name}. Com a alteração, fica marcada como alterada e a sala é liberada até o SAD aprovar de novo.`
            : "Ela fica marcada como alterada até o SAD aprovar ou rejeitar."}
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form
          id={FORM_ID}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
          className="min-w-0 space-y-6"
        >
          <FormSection
            step={1}
            title="Quando"
            description={asAdmin ? "Funcionamento das 07:30 às 22:30." : "Funcionamento das 07:30 às 22:30, com no mínimo 3 dias de antecedência."}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Data" type="date" required value={date} min={asAdmin ? todayPlus(0) : todayPlus(3)} onChange={(e) => setDate(e.target.value)} />
              <Input label="Início" type="time" required step={300} value={startTimeStr} onChange={(e) => setStartTimeStr(e.target.value)} />
              <Input label="Término" type="time" required step={300} value={endTimeStr} onChange={(e) => setEndTimeStr(e.target.value)} />
            </div>

            {asAdmin && editing?.status === "APPROVED" && (
              <Select
                label="Sala"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                hint="Trocar a sala vale para todas as datas alteradas. Se ela estiver ocupada, o sistema avisa ao salvar."
                containerClassName="mt-4"
              >
                {editing.room && !activeRooms.some((r) => r.id === editing.room!.id) && (
                  <option value={editing.room.id}>{editing.room.name} (atual)</option>
                )}
                {activeRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.id === editing.roomId ? " (atual)" : ""} — {ROOM_TYPE_LABELS[r.roomType]}, até {r.capacity ?? "?"} pessoas
                  </option>
                ))}
              </Select>
            )}

            {timesFilled && clientErrors.length > 0 && (
              <Alert tone="warning" className="mt-4">
                <ul className="space-y-0.5">
                  {clientErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {editing?.seriesId && (
              <div className="mt-5 space-y-2 rounded-xl border border-border p-4">
                <span className="text-sm font-medium">Esta reserva faz parte de uma série. Alterar:</span>
                <SegmentedControl
                  label="Aplicar a alteração a"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: "single", label: "Só esta data" },
                    { value: "series", label: "Esta e as próximas" },
                  ]}
                />
                {scope === "series" && (
                  <p className="text-xs text-muted">
                    Mudar a data ou o horário aqui muda todas as próximas datas do mesmo jeito (ex.: das 10h para as 14h).
                  </p>
                )}
              </div>
            )}

            <div className={cn("mt-5 rounded-xl border border-border p-4", editing && "hidden")}>
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
                    <Input label="Repetir até" type="date" required value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
                  </div>
                  {weekdays.size === 0 ? (
                    <Alert tone="warning">Escolha ao menos um dia da semana.</Alert>
                  ) : !until ? (
                    <Alert tone="info">Escolha até quando a reserva se repete.</Alert>
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
              {!activityLocked && (
                <Button variant="ghost" size="sm" icon={ArrowsLeftRightIcon} onClick={() => setActivityType(null)}>
                  Trocar
                </Button>
              )}
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

          {!asAdmin && (
            <RoomsPreview attendees={Number(attendees) || 0} date={startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined} />
          )}

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
                    {startTimeStr && endTimeStr ? `${startTimeStr}–${endTimeStr}` : "Horário a definir"}
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
                {editing ? "Salvar alteração" : "Enviar solicitação"}
              </Button>
            </div>
          </Card>
        </aside>

        <Card className="space-y-4 p-5 sm:p-6 lg:col-start-1">
          {!asAdmin && (
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
                Li e concordo com o{" "}
                <button
                  type="button"
                  onClick={() => setShowRegulation(true)}
                  className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {regulationTitle}
                </button>
                .
              </span>
            </label>
          )}
          {showRegulation && (
            <RegulationDialog
              onClose={() => setShowRegulation(false)}
              onAccept={() => {
                setTermsAccepted(true);
                setShowRegulation(false);
              }}
            />
          )}
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
              {editing ? "Salvar alteração" : "Enviar solicitação"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
