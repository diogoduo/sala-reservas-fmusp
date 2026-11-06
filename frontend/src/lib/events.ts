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
  QUOTE_APPROVED: "Orçamento aprovado",
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
  IN_REVIEW: "O NUCEV está analisando os espaços e o orçamento.",
  QUOTE_SENT: "O orçamento foi enviado: aprove, recuse ou peça alteração.",
  CHANGES_REQUESTED: "Você pediu alteração: o NUCEV vai revisar o orçamento.",
  QUOTE_APPROVED: "Orçamento aprovado. O SAD vai pré-reservar os espaços.",
  PRE_RESERVED: "Os espaços estão pré-reservados até a data indicada. Faça o pagamento e envie o comprovante.",
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
  room: { id: string; name: string; building: string; floor: string } | null;
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
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  days: EventDay[];
  spaces: EventSpace[];
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

/** "Recebido" etc., e o "em andamento"/"finalizado" de um evento confirmado, pelas datas. */
export function eventStatusText(e: Pick<EventRequest, "status" | "days">): string {
  if (e.status !== "CONFIRMED") return EVENT_STATUS_LABELS[e.status];
  const today = new Date().toLocaleDateString("en-CA");
  const keys = e.days.map((d) => d.date).sort();
  if (keys.length && today > keys.at(-1)!) return "Finalizado";
  if (keys.length && today >= keys[0]!) return "Em andamento";
  return EVENT_STATUS_LABELS.CONFIRMED;
}
