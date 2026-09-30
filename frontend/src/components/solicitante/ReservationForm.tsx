import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsLeftRightIcon,
  CalendarBlankIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  HammerIcon,
  HashIcon,
  KeyIcon,
  MapPinIcon,
  PaperPlaneTiltIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  ProhibitIcon,
  ScrollIcon,
  UsersIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { formatDayMonth, holidayName, weekdayOf } from "../../lib/calendar";
import { cn } from "../../lib/cn";
import { capitalizeFirst, formatShortDate, plural } from "../../lib/format";
import { ACTIVITY_ICONS, resourceIcon } from "../../lib/icons";
import { previewWeeklyDates } from "../../lib/recurrence";
import { formatMinutes, isEditable, notifyReservationsChanged } from "../../lib/reservations";
import { sortRooms } from "../../lib/rooms";
import { validateReservationTimes } from "../../lib/reservationValidation";
import { useToast } from "../../lib/toast";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { ActivityType, ApprovalChecklist, Reservation, Resource, ReviewScope, Room } from "../../lib/types";
import {
  capacityWarning,
  checklistWarnings,
  HOLIDAYS_WARNING,
  NO_ALCOHOL_WARNING,
  RELOCATION_WARNING,
  scheduleWarning,
  type PortariaWarning,
} from "../../lib/portarias";
import { PortariaWarnings } from "../admin/PortariaWarnings";
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
  CULTURE_EXTENSION: "Congressos, cursos, palestras, ligas e eventos (precisam de autorização da CCEx).",
  PUBLIC_EXAM: "Concursos docentes e processos seletivos.",
  DEFENSE: "Defesas de mestrado e doutorado.",
  ADMINISTRATIVE: "Reuniões administrativas, atividades da Diretoria e da Representação dos Funcionários.",
};

/** Montagem antes da atividade (Portaria 2793, Art. 19). */
const SETUP_OPTIONS = [0, 30, 60, 90, 120, 180, 240];

const FORM_ID = "formulario-reserva";

const EMPTY_CHECKLIST: ApprovalChecklist = { ccexAuthorized: false, academicDivisionApproved: false, feeSettled: false, directorateHomologated: false };

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
        description="Pelo sistema, só dá para alterar reservas pendentes ou aprovadas até 3 dias úteis antes da data (Portaria 2793, Art. 9º). Fale com o SAD/NE."
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

/**
 * "Nova reserva" do SAD (/admin/reservar): a reserva já sai aprovada. Aceita
 * preencher sala, data e horário pela URL (?sala=&data=&inicio=&fim=), vindo de
 * Salas livres ou da Agenda, e volta para `voltar` ao reservar.
 */
export function AdminNewReservationPage() {
  const [params] = useSearchParams();
  const date = params.get("data") ?? undefined;
  const fallback = date ? `/admin/agenda?data=${date}` : "/admin/agenda";
  const returnTo = params.get("voltar")?.startsWith("/admin/") ? params.get("voltar")! : fallback;
  const prefill = {
    date,
    start: params.get("inicio") ?? undefined,
    end: params.get("fim") ?? undefined,
    roomId: params.get("sala") ?? undefined,
  };
  return <ReservationForm key={params.toString()} asAdmin={{ returnTo, prefill }} />;
}

/** Envolve o formulário com uma `key`: "Nova solicitação" remonta tudo do zero. */
export function ReservationPage() {
  const [formKey, setFormKey] = useState(0);
  return <ReservationForm key={formKey} onReset={() => setFormKey((k) => k + 1)} />;
}

interface Standing {
  suspension: { until: string | null; reason: string } | null;
  noShowCount: number;
}

/** Suspensão de novas reservas em vigor (Portaria 2793, Arts. 9º, 11, 17 e 22). */
function SuspensionNotice({ suspension }: { suspension: NonNullable<Standing["suspension"]> }) {
  const until = suspension.until ? `até ${new Date(suspension.until).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "até a regularização";
  return (
    <Alert tone="danger" title={`Suas novas reservas estão suspensas ${until}`}>
      Motivo: {suspension.reason}. Enquanto isso não é possível fazer nem alterar pedidos. Fale com o SAD/NE.
    </Alert>
  );
}

/** O essencial das Portarias 2793 e 2794, antes de escolher o tipo de atividade. */
function RulesSummary() {
  const rules: { icon: typeof KeyIcon; text: ReactNode }[] = [
    { icon: CalendarBlankIcon, text: "Dias úteis e sábados, das 07h às 22h. Domingos, feriados e outros horários só com autorização da Divisão Acadêmica." },
    { icon: HashIcon, text: "O pedido só vale depois de gerado o número de protocolo — anote-o." },
    { icon: ProhibitIcon, text: "Cancelamento pelo sistema até 3 dias úteis antes. Faltar sem cancelar 3 vezes em 12 meses gera sanções." },
    { icon: KeyIcon, text: "No dia, o responsável vai ao SAD/NE 10 minutos antes para orientações e retirada das chaves." },
    { icon: UsersIcon, text: "Sem cadeiras sobressalentes: todos os participantes precisam caber nas cadeiras da sala." },
    { icon: HammerIcon, text: "A montagem de eventos é reservada junto e faz parte do uso do espaço." },
    { icon: ScrollIcon, text: "Eventos (Cultura e Extensão) precisam de autorização prévia da CCEx." },
    { icon: ProhibitIcon, text: "Proibidos o comércio e o consumo de bebidas alcoólicas." },
  ];
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Regras das Portarias FMUSP nº 2793 e 2794</h2>
      <ul className="mt-3 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
        {rules.map(({ icon: RuleIcon, text }, i) => (
          <li key={i} className="flex gap-2.5">
            <RuleIcon size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityPicker({ onPick, standing, asAdmin }: { onPick: (type: ActivityType) => void; standing: Standing | null; asAdmin: boolean }) {
  const suspended = !asAdmin && standing?.suspension;
  return (
    <div className="space-y-6">
      <PageHeader title="Reservar uma sala" description="Comece pelo tipo de atividade — cada uma tem um formulário próprio." />
      {suspended && <SuspensionNotice suspension={standing.suspension!} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ACTIVITY_TYPES.map((type, index) => (
          <button
            key={type}
            type="button"
            disabled={Boolean(suspended)}
            onClick={() => onPick(type)}
            style={{ animationDelay: `${index * 50}ms` }}
            className="group flex animate-fade-in-up flex-col gap-4 rounded-2xl border border-border bg-surface p-5 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
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
      {!asAdmin && <RulesSummary />}
      <Alert tone="info" title="Como funciona">
        Você descreve o que precisa e recebe um número de protocolo; o SAD (Serviço de Apoio Didático) escolhe a sala disponível mais
        adequada ao aprovar, e você recebe a resposta por e-mail.
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

/** Caixa de confirmação obrigatória (compromissos e autorizações das portarias). */
function Confirm({ checked, onChange, children, required = true }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; required?: boolean }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        form={FORM_ID}
        required={required}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0"
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * Formulário de solicitação de reserva. Começa pela escolha do tipo de
 * atividade (Graduação, Pós, Cultura e Extensão, Concurso, Defesa,
 * Reunião/Administrativo): cada tipo tem seus próprios campos; datas e recursos
 * são iguais para todos. Não pede sala — o Admin aloca a mais adequada ao aprovar.
 */
const pad2 = (n: number) => String(n).padStart(2, "0");
const timeOf = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Converte uma reserva salva nos valores do formulário (para alterá-la). */
function formValuesFrom(r: Reservation) {
  const details: DetailValues = { ...INITIAL_DETAIL_VALUES };
  for (const [key, value] of Object.entries(r.activityDetails ?? {})) {
    if (typeof value === "boolean") details[key] = value;
    else if (value !== null && value !== undefined) details[key] = String(value);
  }
  // A reserva começa na montagem; o formulário mostra o início da atividade.
  const start = new Date(new Date(r.startTime).getTime() + r.setupMinutes * 60_000);
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
    start: timeOf(start),
    end: timeOf(end),
    setupMinutes: String(r.setupMinutes),
    noAlcoholCommitment: r.noAlcoholCommitment,
  };
}

interface ReservationFormProps {
  onReset?: () => void;
  /** Reserva existente a alterar (em vez de criar uma nova). */
  editing?: Reservation;
  /**
   * Modo SAD. Com `editing`: alteração sem a antecedência de 3 dias, podendo
   * trocar o tipo de atividade e a sala (de uma aprovada), sem voltar para
   * análise. Sem `editing`: reserva feita pelo próprio SAD, que escolhe a sala
   * e já sai aprovada. Ao salvar, volta para `returnTo`.
   */
  asAdmin?: { returnTo: string; prefill?: { date?: string; start?: string; end?: string; roomId?: string } };
}

interface CreatedResult {
  protocol: string;
  reservations: Reservation[];
  skippedDates: { date: string; holiday: string }[];
}

function ReservationForm({ onReset, editing, asAdmin }: ReservationFormProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [initial] = useState(() => (editing ? formValuesFrom(editing) : null));
  // O SAD reservando (e não alterando): escolhe a sala e a reserva já sai aprovada.
  const adminCreating = Boolean(asAdmin && !editing);
  const prefill = asAdmin?.prefill;

  const [activityType, setActivityType] = useState<ActivityType | null>(initial?.activityType ?? null);
  const [details, setDetails] = useState<DetailValues>(initial?.details ?? INITIAL_DETAIL_VALUES);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [supportNotes, setSupportNotes] = useState(initial?.supportNotes ?? "");
  // Numa alteração, o regulamento já tinha sido aceito no pedido original; o SAD não precisa aceitar.
  const [termsAccepted, setTermsAccepted] = useState(editing !== undefined || Boolean(asAdmin));
  // Portaria 2793, Art. 23: compromisso no formulário (o SAD também assume ao reservar).
  const [noAlcohol, setNoAlcohol] = useState(initial?.noAlcoholCommitment ?? false);
  // Recursos marcados (a chave é o id), com a quantidade/detalhe como digitados.
  const [selectedResources, setSelectedResources] = useState<Record<string, { quantity: string; detail: string }>>(
    initial?.selectedResources ?? {},
  );

  // Tudo começa em branco numa reserva nova (nada de data/horário sugeridos).
  const [date, setDate] = useState(initial?.date ?? prefill?.date ?? "");
  const [startTimeStr, setStartTimeStr] = useState(initial?.start ?? prefill?.start ?? "");
  const [endTimeStr, setEndTimeStr] = useState(initial?.end ?? prefill?.end ?? "");
  const [setupMinutes, setSetupMinutes] = useState(initial?.setupMinutes ?? "0");
  // Alteração de uma data de série: só ela, ou ela e as próximas.
  const [scope, setScope] = useState<ReviewScope>("single");
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [showRegulation, setShowRegulation] = useState(false);
  const regulationTitle = useRegulationTitle();
  // Só o SAD escolhe a sala: ao reservar, ou ao alterar uma reserva aprovada.
  const [roomId, setRoomId] = useState(editing?.roomId ?? prefill?.roomId ?? "");
  const [activeRooms, setActiveRooms] = useState<Room[]>([]);
  const choosesRoom = adminCreating || Boolean(asAdmin && editing?.status === "APPROVED");
  // SAD: numa série, manter as datas em feriado (fora do Art. 6º) e a conferência de eventos (Art. 20 §3º).
  const [keepHolidays, setKeepHolidays] = useState(false);
  const [checklist, setChecklist] = useState<ApprovalChecklist>(EMPTY_CHECKLIST);
  const [standing, setStanding] = useState<Standing | null>(null);

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [interval, setInterval_] = useState<"1" | "2">("1");
  const [weekdays, setWeekdays] = useState<Set<string>>(new Set());
  const [until, setUntil] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [result, setResult] = useState<CreatedResult | null>(null);

  useEffect(() => {
    if (choosesRoom) {
      api<{ rooms: Room[] }>("/rooms?status=ACTIVE").then((res) => setActiveRooms(sortRooms(res.rooms)));
    }
    if (!asAdmin) {
      api<Standing>("/reservations/me/standing")
        .then(setStanding)
        .catch(() => setStanding(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Itens só de inventário (nobreak, splitter…) não são pedidos pelo solicitante.
    api<{ resources: Resource[] }>("/resources").then((res) => setResources(res.resources.filter((r) => r.requestable)));
  }, []);

  const setup = Number(setupMinutes) || 0;
  const startDate = useMemo(() => (date && startTimeStr ? new Date(`${date}T${startTimeStr}:00`) : null), [date, startTimeStr]);
  const endDate = useMemo(() => (date && endTimeStr ? new Date(`${date}T${endTimeStr}:00`) : null), [date, endTimeStr]);
  // Início do período reservado: a atividade menos a montagem (Art. 19).
  const reservedStart = useMemo(() => (startDate ? new Date(startDate.getTime() - setup * 60_000) : null), [startDate, setup]);
  const clientErrors = useMemo(() => {
    const errors = validateReservationTimes(reservedStart, endDate, { asAdmin: Boolean(asAdmin) });
    if (startDate && endDate && endDate.getTime() - startDate.getTime() < 30 * 60_000 && endDate > startDate) {
      errors.push("A atividade deve durar no mínimo 30 minutos (sem contar a montagem).");
    }
    return errors;
  }, [reservedStart, startDate, endDate, asAdmin]);
  // O aviso de horário só aparece depois que data, início e término foram preenchidos.
  const timesFilled = Boolean(date && startTimeStr && endTimeStr);
  const previewDates = useMemo(
    () => (recurrenceEnabled ? previewWeeklyDates(date, until, weekdays, Number(interval)) : []),
    [recurrenceEnabled, date, until, weekdays, interval],
  );
  // Numa série, os feriados ficam de fora (Art. 6º) — o SAD pode pedir para manter.
  const keepsHolidays = Boolean(asAdmin) && keepHolidays;
  const holidayDates = previewDates.filter((d) => holidayName(d));
  const effectiveDates = keepsHolidays ? previewDates : previewDates.filter((d) => !holidayName(d));
  const weekdayOptions = asAdmin ? WEEKDAYS : WEEKDAYS.filter((w) => w.code !== "SU");

  // Ao ligar a recorrência, já marca o dia da semana da data escolhida.
  function toggleRecurrence(enabled: boolean) {
    setRecurrenceEnabled(enabled);
    if (enabled && weekdays.size === 0 && date) {
      const code = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date(`${date}T12:00:00`).getDay()]!;
      if (asAdmin || code !== "SU") setWeekdays(new Set([code]));
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

  const chosenRoom = activeRooms.find((r) => r.id === roomId) ?? (editing?.room && editing.room.id === roomId ? editing.room : null);
  const relocating = Boolean(asAdmin && editing?.status === "APPROVED" && roomId && roomId !== editing.roomId);
  const needsChecklist = adminCreating && activityType === "CULTURE_EXTENSION";
  // O compromisso do Art. 23 é assumido em todo pedido; na alteração do SAD fica o que já foi assumido.
  const asksCommitment = !(asAdmin && editing);
  const suspended = !asAdmin && Boolean(standing?.suspension);

  // O SAD pode passar por cima das portarias: em vez de barrar, a tela diz qual
  // regra está sendo violada (o solicitante continua preso a elas).
  const unchangedSchedule =
    reservedStart?.getTime() === (editing ? new Date(editing.startTime).getTime() : NaN) && endDate?.getTime() === new Date(editing?.endTime ?? NaN).getTime();
  const warnings: PortariaWarning[] = [];
  if (asAdmin && clientErrors.length === 0 && !unchangedSchedule) {
    const schedule = scheduleWarning(reservedStart, endDate);
    if (schedule) warnings.push(schedule);
  }
  if (asAdmin && recurrenceEnabled && keepsHolidays && holidayDates.length > 0) warnings.push(HOLIDAYS_WARNING);
  if (asAdmin && activityType) {
    const capacity = capacityWarning(Number(attendeesOf(activityType, details)) || 0, choosesRoom ? chosenRoom : null);
    if (capacity) warnings.push(capacity);
  }
  if (relocating) warnings.push(RELOCATION_WARNING);
  if (needsChecklist) warnings.push(...checklistWarnings(checklist));
  if (adminCreating && !noAlcohol) warnings.push(NO_ALCOHOL_WARNING);

  const recurrenceOk = !recurrenceEnabled || (weekdays.size > 0 && effectiveDates.length > 0);
  const canSubmit =
    clientErrors.length === 0 &&
    recurrenceOk &&
    termsAccepted &&
    (asAdmin !== undefined || noAlcohol) &&
    !suspended &&
    (!adminCreating || Boolean(roomId)) &&
    !submitting;

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
        // Início e término da atividade; o back-end reserva a montagem antes.
        startTime: startDate!.toISOString(),
        endTime: endDate!.toISOString(),
        setupMinutes: setup,
      };
      const recurrence = rrule ? { rrule, until: new Date(`${until}T23:59:59`).toISOString() } : undefined;

      if (adminCreating && asAdmin) {
        const res = await api<CreatedResult>("/admin/reservations", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            roomId,
            noAlcoholCommitment: noAlcohol,
            keepHolidays: keepsHolidays,
            approvalChecklist: needsChecklist ? checklist : undefined,
            recurrence,
          }),
        });
        toast.success(
          `${res.reservations.length === 1 ? "Sala reservada" : `${res.reservations.length} datas reservadas`} · protocolo ${res.protocol}`,
          [
            "A reserva já está aprovada.",
            res.skippedDates.length > 0 ? `${plural(res.skippedDates.length, "feriado ficou", "feriados ficaram")} de fora.` : "",
            warnings.length > 0 ? `Feita fora de: ${[...new Set(warnings.map((w) => w.rule))].join("; ")}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        notifyReservationsChanged();
        navigate(asAdmin.returnTo);
        return;
      } else if (editing && asAdmin) {
        const res = await api<{ updatedIds: string[] }>(`/admin/reservations/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({
            ...payload,
            scope,
            roomId: roomId || null,
          }),
        });
        toast.success(
          res.updatedIds.length === 1 ? "Reserva alterada" : `${res.updatedIds.length} datas alteradas`,
          warnings.length > 0
            ? `O solicitante foi avisado por e-mail. Feita fora de: ${[...new Set(warnings.map((w) => w.rule))].join("; ")}.`
            : "O solicitante foi avisado por e-mail.",
        );
        notifyReservationsChanged();
        navigate(asAdmin.returnTo);
        return;
      } else if (editing) {
        const res = await api<{ updatedIds: string[] }>(`/reservations/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...payload, scope, noAlcoholCommitment: noAlcohol }),
        });
        setSavedCount(res.updatedIds.length);
      } else {
        const res = await api<CreatedResult>("/reservations", {
          method: "POST",
          body: JSON.stringify({ ...payload, noAlcoholCommitment: noAlcohol, recurrence }),
        });
        setResult(res);
      }
      window.scrollTo({ top: 0 });
    } catch (e) {
      const messages = e instanceof ApiError && e.code === "VALIDATION_ERROR" ? validationMessages(e.details) : [];
      const list = messages.length > 0 ? messages : [e instanceof Error ? e.message : "Falha ao enviar a solicitação."];
      setSubmitErrors(list);
      toast.error(
        editing ? "Não foi possível salvar a alteração." : adminCreating ? "Não foi possível reservar." : "Não foi possível enviar a solicitação.",
        list[0],
      );
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
        {editing && (
          <p className="mt-3 text-sm text-muted">
            Protocolo nº <strong className="text-foreground tabular-nums">{editing.protocol}</strong>
          </p>
        )}
        <div className="mt-8 flex justify-center">
          <Button icon={CalendarCheckIcon} onClick={() => navigate("/minhas-reservas")}>
            Ver minhas reservas
          </Button>
        </div>
      </Card>
    );
  }

  if (result) {
    const first = result.reservations[0];
    const isCulture = first?.activityType === "CULTURE_EXTENSION";
    return (
      <Card className="mx-auto max-w-xl animate-fade-in-up p-8 text-center">
        <span className="mx-auto grid size-16 animate-pop place-items-center rounded-full bg-success-soft text-success-foreground">
          <CheckCircleIcon size={40} weight="fill" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Solicitação registrada!</h1>
        <div className="mx-auto mt-4 max-w-xs rounded-xl border-2 border-dashed border-primary/40 bg-primary-soft px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-primary-soft-foreground/80 uppercase">Número de protocolo</p>
          <p className="mt-1 font-display text-2xl font-bold text-primary-soft-foreground tabular-nums" data-testid="protocolo">
            {result.protocol}
          </p>
        </div>
        <p className="mt-2 text-sm text-muted">Anote este número para acompanhar o pedido (Portaria 2793, Art. 8º).</p>
        <p className="mt-4 text-muted">
          {result.reservations.length === 1 ? "A solicitação está" : `As ${result.reservations.length} datas estão`}{" "}
          <strong className="text-foreground">{result.reservations.length === 1 ? "pendente" : "pendentes"}</strong>. Você recebe um e-mail
          quando o SAD aprovar ou rejeitar.
        </p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2">
          {result.reservations.slice(0, 12).map((r) => (
            <li key={r.id} className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary-soft-foreground tabular-nums">
              {formatShortDate(r.startTime)}
            </li>
          ))}
          {result.reservations.length > 12 && <li className="px-2 py-1 text-xs text-muted">+{result.reservations.length - 12}</li>}
        </ul>
        {result.skippedDates.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Ficaram de fora por serem feriados ou pontos facultativos:{" "}
            {result.skippedDates.map((s) => `${formatDayMonth(s.date)} (${s.holiday})`).join(", ")}.
          </p>
        )}
        <ul className="mt-6 space-y-2 rounded-xl bg-surface-muted p-4 text-left text-sm">
          <li className="flex gap-2">
            <KeyIcon size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            No dia, o responsável vai ao SAD/NE 10 minutos antes do início para orientações e retirada das chaves.
          </li>
          <li className="flex gap-2">
            <ProhibitIcon size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            Se não for usar, cancele pelo sistema até 3 dias úteis antes da data.
          </li>
          {isCulture && (
            <li className="flex gap-2">
              <ScrollIcon size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              A reserva só é confirmada depois da autorização da CCEx e da aprovação da Divisão Acadêmica.
            </li>
          )}
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
  if (!activityType) return <ActivityPicker onPick={setActivityType} standing={standing} asAdmin={Boolean(asAdmin)} />;

  const ActivityIcon = ACTIVITY_ICONS[activityType];
  const attendees = attendeesOf(activityType, details);
  const chosenResources = resources.filter((r) => selectedResources[r.id]);
  const dayOnly = date ? new Date(`${date}T12:00:00`) : null;
  const dateLabel =
    dayOnly && !Number.isNaN(dayOnly.getTime())
      ? capitalizeFirst(dayOnly.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))
      : "Data a definir";
  // Aos sábados (e, com o SAD, domingos e feriados), áudio e vídeo exige 2 técnicos (Art. 18 §1º).
  const weekendDate = date ? weekdayOf(date) === 6 || weekdayOf(date) === 0 || holidayName(date) !== null : false;

  // O tipo de atividade não muda numa alteração (só nas reservas antigas, que ainda não tinham tipo).
  const activityLocked = !asAdmin && editing?.activityType != null;
  const submitLabel = `${editing ? "Salvar alteração" : adminCreating ? "Reservar" : "Enviar solicitação"}${warnings.length > 0 ? " mesmo assim" : ""}`;
  let step = 0;
  const nextStep = () => ++step;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {asAdmin && editing ? (
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
        title={adminCreating ? "Nova reserva (SAD)" : asAdmin ? "Alterar reserva (SAD)" : editing ? "Alterar reserva" : "Reservar uma sala"}
        description={
          editing
            ? `${ACTIVITY_TYPE_LABELS[activityType]} — ${editing.title} · protocolo ${editing.protocol}${asAdmin && editing.user ? ` · de ${editing.user.name}` : ""}`
            : adminCreating
              ? `${ACTIVITY_TYPE_LABELS[activityType]} — escolha a sala; a reserva já sai aprovada.`
              : `${ACTIVITY_TYPE_LABELS[activityType]} — preencha os dados e envie para o SAD.`
        }
      />
      {suspended && <SuspensionNotice suspension={standing!.suspension!} />}
      {adminCreating && (
        <Alert tone="success" title="Reserva do SAD não passa pela fila">
          Ela é gravada já aprovada, na sala escolhida, com número de protocolo. O sistema confere se a sala está livre em todas as datas; o
          que sair das portarias aparece como aviso, e você decide se segue.
        </Alert>
      )}
      {asAdmin && editing && (
        <Alert tone="info" title="O solicitante recebe um e-mail com a alteração">
          {editing.status === "APPROVED"
            ? "A reserva continua aprovada. Se mudar a sala ou o horário, o sistema confere se a sala está livre antes de salvar; o que sair das portarias aparece como aviso."
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
            step={nextStep()}
            title="Quando"
            description={
              asAdmin
                ? "Funcionamento regular: dias úteis e sábados, das 07h às 22h. Fora disso, só com autorização da Divisão Acadêmica (Art. 6º §1º)."
                : "Dias úteis e sábados, das 07h às 22h, com no mínimo 3 dias de antecedência (Portaria 2793, Art. 6º)."
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Data" type="date" required value={date} min={asAdmin ? todayPlus(0) : todayPlus(3)} onChange={(e) => setDate(e.target.value)} />
              <Input label="Início" type="time" required step={300} value={startTimeStr} onChange={(e) => setStartTimeStr(e.target.value)} />
              <Input label="Término" type="time" required step={300} value={endTimeStr} onChange={(e) => setEndTimeStr(e.target.value)} />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Select
                label="Montagem"
                value={setupMinutes}
                onChange={(e) => setSetupMinutes(e.target.value)}
                containerClassName="sm:col-span-1"
              >
                {SETUP_OPTIONS.map((m) => (
                  <option key={m} value={String(m)}>
                    {m === 0 ? "Sem montagem" : formatMinutes(m)}
                  </option>
                ))}
              </Select>
              <p className="self-end pb-1 text-xs text-muted sm:col-span-2">
                Tempo de montagem antes do início. Em eventos, a montagem é reservada junto e faz parte do uso do espaço, com a equipe técnica
                presente (Art. 19).
                {setup > 0 && reservedStart && endDate && !Number.isNaN(reservedStart.getTime()) && (
                  <strong className="mt-0.5 block text-foreground">
                    Período reservado: {timeOf(reservedStart)}–{endTimeStr} (montagem a partir de {timeOf(reservedStart)}).
                  </strong>
                )}
              </p>
            </div>

            {choosesRoom && (
              <Select
                label="Sala"
                required={adminCreating}
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                hint={
                  adminCreating
                    ? "Vale para todas as datas. Se a sala estiver ocupada, o sistema avisa ao reservar."
                    : "Trocar a sala vale para todas as datas alteradas. Se ela estiver ocupada, o sistema avisa ao salvar."
                }
                containerClassName="mt-4"
              >
                {adminCreating && (
                  <option value="" disabled>
                    Selecione a sala
                  </option>
                )}
                {editing?.room && !activeRooms.some((r) => r.id === editing.room!.id) && (
                  <option value={editing.room.id}>{editing.room.name} (atual)</option>
                )}
                {activeRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.id === editing?.roomId ? " (atual)" : ""} — {ROOM_TYPE_LABELS[r.roomType]}, até {r.capacity ?? "?"} pessoas
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

            {/* SAD: o que sai da portaria aparece aqui mesmo, junto do horário e da sala. */}
            <PortariaWarnings
              warnings={warnings.filter((w) => w.rule.startsWith("Portaria 2793, Art. 6º") || w.rule.startsWith("Portaria 2793, Art. 12"))}
              className="mt-4"
            />

            {weekendDate && chosenResources.length > 0 && (
              <Alert tone="info" className="mt-4">
                Em fins de semana, feriados e pontos facultativos, o uso de áudio e vídeo exige equipe técnica de no mínimo 2 técnicos, paga à FFM
                antes do evento (Portaria 2793, Art. 18 §1º).
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
                description="Para aulas e encontros que se repetem toda semana ou a cada 15 dias. Feriados ficam de fora."
              />
              {recurrenceEnabled && (
                <div className="mt-5 animate-fade-in space-y-5 border-t border-border pt-5">
                  <fieldset>
                    <legend className="text-sm font-medium">Dias da semana</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {weekdayOptions.map((w) => {
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
                  ) : effectiveDates.length === 0 ? (
                    <Alert tone="warning">Nenhuma data válida cai nesse período. Ajuste o "Repetir até" ou os dias.</Alert>
                  ) : (
                    <div>
                      <p className="text-sm font-medium">
                        {plural(effectiveDates.length, "data", "datas")} nesta série
                        {!keepsHolidays && holidayDates.length > 0 && (
                          <span className="font-normal text-muted"> · {plural(holidayDates.length, "feriado fica", "feriados ficam")} de fora</span>
                        )}
                      </p>
                      <ul className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                        {previewDates.map((d) => {
                          const holiday = holidayName(d);
                          const skipped = Boolean(holiday) && !keepsHolidays;
                          return (
                            <li
                              key={d}
                              title={holiday ?? undefined}
                              className={cn(
                                "rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                                skipped ? "bg-surface-muted text-muted line-through" : "bg-primary-soft text-primary-soft-foreground",
                              )}
                            >
                              {formatShortDate(`${d}T12:00:00`)}
                              {skipped && <span className="sr-only"> (feriado: {holiday}, fica de fora)</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {asAdmin && holidayDates.length > 0 && (
                    <Confirm required={false} checked={keepHolidays} onChange={setKeepHolidays}>
                      Reservar também nas datas em feriado ou ponto facultativo (fora da Portaria 2793, Art. 6º).
                    </Confirm>
                  )}
                </div>
              )}
            </div>
          </FormSection>

          <FormSection step={nextStep()} title="Sobre a atividade">
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
            <p className="mt-4 flex gap-2 text-xs text-muted">
              <UsersIcon size={16} className="mt-px shrink-0" aria-hidden />
              Não é permitido colocar cadeiras sobressalentes: informe o total de pessoas, que precisam caber nas cadeiras da sala (Portaria
              2793, Art. 5º §2º).
            </p>
          </FormSection>

          {needsChecklist && (
            <FormSection
              step={nextStep()}
              title="Conferência do SAD"
              description="Etapas da Portaria 2793, Art. 20 §3º. O que não for marcado aparece como aviso; dá para reservar mesmo assim."
            >
              <div className="space-y-3">
                <Confirm required={false} checked={checklist.ccexAuthorized} onChange={(v) => setChecklist((c) => ({ ...c, ccexAuthorized: v }))}>
                  Autorização da CCEx conferida (Art. 20 §3º, a).
                </Confirm>
                <Confirm
                  required={false}
                  checked={checklist.academicDivisionApproved}
                  onChange={(v) => setChecklist((c) => ({ ...c, academicDivisionApproved: v }))}
                >
                  Aprovação da Divisão Acadêmica (Art. 20 §3º, c).
                </Confirm>
                <Confirm required={false} checked={checklist.feeSettled} onChange={(v) => setChecklist((c) => ({ ...c, feeSettled: v }))}>
                  Comprovante de pagamento da taxa entregue ao SAD/NE, ou atividade isenta (Art. 14 §3º e Art. 21 §2º).
                </Confirm>
                <Confirm
                  required={false}
                  checked={checklist.directorateHomologated}
                  onChange={(v) => setChecklist((c) => ({ ...c, directorateHomologated: v }))}
                >
                  Homologação da Diretoria, quando aplicável (Art. 20 §3º, d).
                </Confirm>
              </div>
            </FormSection>
          )}

          {!asAdmin && (
            <RoomsPreview attendees={Number(attendees) || 0} date={startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined} />
          )}

          <FormSection step={nextStep()} title="Recursos" description="Marque o que vai precisar. Não precisa de nada? É só seguir em frente.">
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
                    {recurrenceEnabled && effectiveDates.length > 0 && ` · ${plural(effectiveDates.length, "data", "datas")}`}
                  </span>
                  {setup > 0 && reservedStart && !Number.isNaN(reservedStart.getTime()) && (
                    <span className="block text-muted tabular-nums">Montagem desde {timeOf(reservedStart)}</span>
                  )}
                </dd>
              </div>
              {choosesRoom && (
                <div className="flex gap-3">
                  <dt className="sr-only">Sala</dt>
                  <MapPinIcon size={20} className="shrink-0 text-muted" aria-hidden />
                  <dd className={roomId ? undefined : "text-muted"}>{chosenRoom?.name ?? (roomId ? editing?.room?.name : "Sala a escolher")}</dd>
                </div>
              )}
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
              <ChecklistItem ok={clientErrors.length === 0}>{asAdmin ? "Data e horário válidos" : "Data e horário dentro das regras"}</ChecklistItem>
              {recurrenceEnabled && <ChecklistItem ok={recurrenceOk}>Datas da série definidas</ChecklistItem>}
              {adminCreating && <ChecklistItem ok={Boolean(roomId)}>Sala escolhida</ChecklistItem>}
              {!asAdmin && <ChecklistItem ok={termsAccepted}>Regulamento aceito</ChecklistItem>}
              {!asAdmin && <ChecklistItem ok={noAlcohol}>Compromisso sem bebidas alcoólicas</ChecklistItem>}
            </ul>
            {/* SAD: todos os avisos das portarias junto do botão (no celular, ficam no quadro de baixo). */}
            <PortariaWarnings warnings={warnings} className="mt-5 hidden lg:block" />
            {/* No celular o botão fica no fim do formulário; aqui só no computador. */}
            <div className="mt-5 hidden lg:block">
              <Button type="submit" form={FORM_ID} size="lg" icon={PaperPlaneTiltIcon} loading={submitting} disabled={!canSubmit} className="w-full">
                {submitLabel}
              </Button>
            </div>
          </Card>
        </aside>

        {/* Na alteração do SAD, no computador, este quadro ficaria vazio (nada a aceitar; o botão e os avisos ficam no resumo). */}
        <Card className={cn("space-y-4 p-5 sm:p-6 lg:col-start-1", !asksCommitment && submitErrors.length === 0 && "lg:hidden")}>
          <PortariaWarnings warnings={warnings} className="lg:hidden" />
          {!asAdmin && (
            <Confirm checked={termsAccepted} onChange={setTermsAccepted}>
              Li e concordo com o{" "}
              <button
                type="button"
                onClick={() => setShowRegulation(true)}
                className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {regulationTitle}
              </button>
              .
            </Confirm>
          )}
          {asksCommitment && (
            <Confirm required={!asAdmin} checked={noAlcohol} onChange={setNoAlcohol}>
              Assumo o compromisso de que <strong>não haverá comércio nem consumo de bebidas alcoólicas</strong> na atividade (Portaria 2793, Art. 23).
            </Confirm>
          )}
          {!asAdmin && (
            <p className="text-xs text-muted">
              Informações inexatas, omitidas ou inconsistentes levam ao indeferimento do pedido e/ou à suspensão das reservas da mesma atividade
              (Portaria 2793, Art. 8º, parágrafo único).
            </p>
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
              {submitLabel}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
