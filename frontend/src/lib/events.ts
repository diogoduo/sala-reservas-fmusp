import type { Tone } from "../components/ui/Badge";
import type { PriceUnit, QuoteEstimate } from "./types";

// Fase 11 — eventos (vários dias e espaços). Espelha backend/src/routes/events.ts.

export type EventStatus =
  | "SUBMITTED"
  | "IN_REVIEW"
  | "QUOTE_SENT"
  | "CHANGES_REQUESTED"
  | "QUOTE_APPROVED"
  | "PRE_RESERVED"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_VALIDATED"
  | "CONFIRMED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED";

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  SUBMITTED: "Recebido",
  IN_REVIEW: "Em análise",
  QUOTE_SENT: "Orçamento enviado",
  CHANGES_REQUESTED: "Alteração pedida",
  QUOTE_APPROVED: "Aguardando pagamento",
  PRE_RESERVED: "Pré-reservado",
  PAYMENT_SUBMITTED: "Comprovante enviado",
  PAYMENT_VALIDATED: "Pagamento validado",
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  REJECTED: "Recusado",
  EXPIRED: "Pré-reserva vencida",
};

export const EVENT_STATUS_TONES: Record<EventStatus, Tone> = {
  SUBMITTED: "info",
  IN_REVIEW: "info",
  QUOTE_SENT: "warning",
  CHANGES_REQUESTED: "warning",
  QUOTE_APPROVED: "primary",
  PRE_RESERVED: "primary",
  PAYMENT_SUBMITTED: "warning",
  PAYMENT_VALIDATED: "primary",
  CONFIRMED: "success",
  CANCELLED: "neutral",
  REJECTED: "danger",
  EXPIRED: "neutral",
};

/** O que acontece agora, para quem pediu. */
export const EVENT_STATUS_HINTS: Record<EventStatus, string> = {
  SUBMITTED: "O pedido chegou. O NUCEV vai analisar e enviar o orçamento.",
  IN_REVIEW: "O NUCEV está analisando o pedido, e o SAD vai escolher as salas.",
  QUOTE_SENT: "O orçamento foi enviado: aprove, recuse ou peça alteração.",
  CHANGES_REQUESTED: "Alteração pedida: o NUCEV e o SAD vão revisar os espaços e o orçamento.",
  QUOTE_APPROVED: "Orçamento aprovado. Faça o pagamento seguindo as orientações abaixo e envie o comprovante.",
  PRE_RESERVED: "O SAD pré-reservou os espaços. O NUCEV vai enviar o orçamento.",
  PAYMENT_SUBMITTED: "Comprovante enviado. O NUCEV está conferindo.",
  PAYMENT_VALIDATED: "Pagamento validado. O SAD vai confirmar a reserva.",
  CONFIRMED: "Reserva confirmada.",
  CANCELLED: "Evento cancelado.",
  REJECTED: "O pedido foi recusado.",
  EXPIRED: "A pré-reserva venceu sem o pagamento, e os espaços foram liberados.",
};

/** Unidades com desconto institucional (Portaria 2794, Art. 4º III). Igual ao back-end. */
export const INSTITUTIONAL_ENTITIES = ["DEPARTMENT", "DIRECTORATE", "ACADEMIC_DIVISION", "COMMISSION", "STAFF", "HC", "USP_UNIT", "SES", "ADOLFO_LUTZ"];
export const FMUSP_ENTITIES = ["DEPARTMENT", "DIRECTORATE", "ACADEMIC_DIVISION", "COMMISSION", "STAFF"];

export interface EventDay {
  id: string;
  /** "AAAA-MM-DD" */
  date: string;
  /** "HH:MM" */
  start: string;
  end: string;
  setupMinutes: number;
  teardownMinutes: number;
}

export interface EventSpace {
  id: string;
  position: number;
  priceCategoryId: string | null;
  roomId: string | null;
  count: number;
  minCapacity: number | null;
  purpose: string | null;
  coffeeInRoom: boolean;
  /** Vazio = todos os dias. */
  dates: string[];
  priceCategory: { id: string; name: string; unit: PriceUnit } | null;
  room: { id: string; name: string; building: string; floor: string; requiresBoardApproval: boolean } | null;
}

export interface EventRequest {
  id: string;
  protocol: string;
  userId: string;
  user: { id: string; name: string; email: string };
  title: string;
  kind: string;
  description: string;
  targetAudience: string;
  expectedAttendees: number;
  entity: string;
  institutional: boolean;
  hasRegistrationFee: boolean;
  sponsored: boolean;
  responsible: string;
  responsibleContact: string;
  department: string;
  coffeeBreak: boolean;
  coffeeAttendees: number | null;
  infrastructure: string | null;
  notes: string | null;
  estimate: QuoteEstimate | null;
  status: EventStatus;
  assigneeName: string | null;
  preReservedUntil: string | null;
  rejectionReason: string | null;
  /** Fase 13: valor esperado, orientações enviadas e as datas de validação e confirmação. */
  paymentExpectedCents: number | null;
  paymentInstructions: string | null;
  paymentRequestedAt: string | null;
  paymentValidatedAt: string | null;
  paymentValidatedByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  /** Fase 16: encerramento depois do último dia ("Finalizado"), com o balanço. */
  closedAt: string | null;
  closedByName: string | null;
  closingNotes: string | null;
  actualAttendees: number | null;
  /** O orçamento mais recente emitido (só a versão e o total). */
  quotes?: { version: number; totalCents: number; status: QuoteStatus }[];
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  days: EventDay[];
  spaces: EventSpace[];
}

/** Pedido de evento nas pendências do SAD: falta pré-reservar as salas ou confirmar a reserva. */
export interface SadPendingEvent extends EventRequest {
  sadAction: "PRE_RESERVE" | "CONFIRM";
}

export interface SpaceAvailability {
  candidates: number;
  days: { date: string; needed: number; free: number; suggestions: string[] }[];
}

/** "sáb., 12/12" */
export function dayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** "12/12/2026 a 13/12/2026" ou "12/12/2026". */
export function eventPeriod(days: { date: string }[]): string {
  const keys = days.map((d) => d.date).sort();
  const fmt = (k: string) => k.split("-").reverse().join("/");
  if (keys.length === 0) return "";
  return keys.length === 1 ? fmt(keys[0]!) : `${fmt(keys[0]!)} a ${fmt(keys.at(-1)!)}`;
}

/** "10 × Salas de aula (para 90 pessoas)" ou "Teatro". */
export function spaceText(s: Pick<EventSpace, "count" | "minCapacity" | "priceCategory" | "room">): string {
  if (s.room) return s.room.name;
  const name = s.priceCategory?.name ?? "Categoria removida";
  return `${s.count > 1 ? `${s.count} × ` : ""}${name}${s.minCapacity ? ` (para ${s.minCapacity} pessoas)` : ""}`;
}

/** A fase de um evento confirmado: antes, durante, depois do último dia (falta encerrar) ou encerrado. */
export type ConfirmedPhase = "UPCOMING" | "ONGOING" | "AWAITING_CLOSE" | "FINISHED";

export function confirmedPhase(e: Pick<EventRequest, "status" | "days" | "closedAt">): ConfirmedPhase | null {
  if (e.status !== "CONFIRMED") return null;
  if (e.closedAt) return "FINISHED";
  const today = new Date().toLocaleDateString("en-CA");
  const keys = e.days.map((d) => d.date).sort();
  if (keys.length && today > keys.at(-1)!) return "AWAITING_CLOSE";
  if (keys.length && today >= keys[0]!) return "ONGOING";
  return "UPCOMING";
}

const PHASE_LABELS: Record<ConfirmedPhase, string> = {
  UPCOMING: "Confirmado",
  ONGOING: "Em andamento",
  AWAITING_CLOSE: "Aguardando encerramento",
  FINISHED: "Finalizado",
};

/** "Recebido" etc.; num evento confirmado, a fase (em andamento, aguardando encerramento, finalizado). */
export function eventStatusText(e: Pick<EventRequest, "status" | "days" | "closedAt">): string {
  const phase = confirmedPhase(e);
  return phase ? PHASE_LABELS[phase] : EVENT_STATUS_LABELS[e.status];
}

// --- Fase 12: gestão do evento ------------------------------------------------

export type QuoteStatus = "SENT" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "SUPERSEDED";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  SENT: "Aguardando resposta",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
  CHANGES_REQUESTED: "Alteração pedida",
  SUPERSEDED: "Substituído",
};

export const QUOTE_STATUS_TONES: Record<QuoteStatus, Tone> = {
  SENT: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CHANGES_REQUESTED: "warning",
  SUPERSEDED: "neutral",
};

export interface EventQuoteRow {
  id: string;
  version: number;
  estimate: QuoteEstimate;
  totalCents: number;
  exemptionReason: string | null;
  notes: string | null;
  status: QuoteStatus;
  createdAt: string;
  createdByName: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
}

export interface EventMessageRow {
  id: string;
  authorId: string | null;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
}

export type AuthorizationStatus = "PENDING" | "AUTHORIZED" | "DENIED";

export const AUTHORIZATION_LABELS: Record<AuthorizationStatus, string> = {
  PENDING: "Aguardando a Diretoria",
  AUTHORIZED: "Autorizado",
  DENIED: "Negado",
};

export interface EventAuthorizationRow {
  id: string;
  recipient: string;
  spaces: string;
  note: string | null;
  status: AuthorizationStatus;
  requestedAt: string;
  requestedByName: string | null;
  respondedAt: string | null;
  responseNote: string | null;
}

export interface EventNoticeRow {
  id: string;
  to: string[];
  subject: string;
  body: string;
  link: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface EventReservationRow {
  id: string;
  room: { id: string; name: string; building: string; floor: string; requiresBoardApproval: boolean } | null;
  date: string;
  start: string;
  end: string;
  preReservedUntil: string | null;
}

export type ReceiptStatus = "PENDING" | "VALIDATED" | "REFUSED";

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = { PENDING: "Aguardando conferência", VALIDATED: "Validado", REFUSED: "Recusado" };

export interface EventReceiptRow {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploadedByName: string;
  status: ReceiptStatus;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
}

export interface EventManagement {
  receipts: EventReceiptRow[];
  reservations: EventReservationRow[];
  quotes: EventQuoteRow[];
  messages: EventMessageRow[];
  authorizations: EventAuthorizationRow[];
  notices: EventNoticeRow[];
}

export interface CandidateSpace {
  spaceId: string;
  needed: number;
  dates: string[];
  rooms: {
    id: string;
    name: string;
    building: string;
    floor: string;
    capacity: number | null;
    requiresBoardApproval: boolean;
    busyDates: string[];
    selected: boolean;
  }[];
}

/** N dias úteis a partir de hoje (sem sábados e domingos), "AAAA-MM-DD". */
export function businessDaysFromToday(n: number): string {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d.toLocaleDateString("en-CA");
}

export const dateTimeText = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// --- Fase 16: organização do evento confirmado ----------------------------------

export type EventPersonKind = "ORGANIZER" | "SPEAKER" | "PARTICIPANT";

export interface EventPlanRow {
  eventId: string;
  buffetNeeded: boolean;
  buffetDetails: string | null;
  parkingNeeded: boolean;
  parkingSpots: number | null;
  parkingDetails: string | null;
  structure: string | null;
  equipment: string | null;
  notes: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface ScheduleItemRow {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  location: string | null;
  speaker: string | null;
  notes: string | null;
}

export interface EventPersonRow {
  id: string;
  kind: EventPersonKind;
  name: string;
  affiliation: string | null;
  contact: string | null;
  notes: string | null;
  addedByName: string | null;
}

/** Veículo para a liberação de vaga: placa sem traço (ABC1234 ou ABC1D23). */
export interface EventVehicleRow {
  id: string;
  plate: string;
  model: string | null;
  driver: string | null;
  notes: string | null;
  addedByName: string | null;
}

/** "ABC1234" → "ABC-1234"; a Mercosul (ABC1D23) fica como está. */
export const plateText = (plate: string) => (/^[A-Z]{3}\d{4}$/.test(plate) ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate);

/** O que quem pediu informa: palestrantes, participantes e veículos. */
export interface GuestInfoData {
  editable: boolean;
  people: EventPersonRow[];
  vehicles: EventVehicleRow[];
}

export interface TaskRow {
  id: string;
  eventId: string | null;
  title: string;
  details: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  status: "OPEN" | "DONE";
  doneAt: string | null;
  doneByName: string | null;
  createdByName: string;
  createdAt: string;
}

export interface EventOrganizationData {
  editable: boolean;
  /** Palestrantes, participantes e veículos: abertos antes e depois da confirmação. */
  guestsEditable: boolean;
  closable: boolean;
  plan: EventPlanRow | null;
  schedule: ScheduleItemRow[];
  people: EventPersonRow[];
  vehicles: EventVehicleRow[];
  tasks: TaskRow[];
  team: { id: string; name: string; role: string }[];
}
