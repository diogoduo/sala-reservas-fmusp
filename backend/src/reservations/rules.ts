import type { RoomType } from "@prisma/client";
import { env } from "../config/env";
import { cancellationDeadline, formatDayMonth, holidayName, weekdayOf } from "../lib/calendar";
import { AppError } from "../lib/errors";
import { zonedDateKey } from "../lib/timezone";

// Regras das Portarias FMUSP nº 2793/2026 (uso dos espaços) e nº 2794/2026
// (valores). O horário regular também está no CHECK "reservations_business_hours_check"
// (migration portarias_2793_2794) — aqui para dar uma mensagem amigável antes de
// gravar, lá como última garantia. As regras valem para o solicitante; o SAD
// pode passar por cima delas (a tela dele mostra qual artigo está sendo violado).

/** Art. 6º: dias úteis e sábados, das 07h às 22h. */
const REGULAR_START_MIN = 7 * 60;
const REGULAR_END_MIN = 22 * 60;
const MIN_DURATION_MS = 30 * 60 * 1000;
const MAX_DURATION_MS = 15 * 60 * 60 * 1000;
// "3 dias de antecedência" para pedir: 72 horas corridas até o início da reserva.
const MIN_ADVANCE_MS = 3 * 24 * 60 * 60 * 1000;
/** Art. 19: a montagem é reservada junto (até 4 horas antes do início da atividade). */
export const MAX_SETUP_MINUTES = 240;

function partsInTimeZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value])) as Record<string, string>;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    // "24" aparece à meia-noite em alguns ambientes com hour12: false.
    minutesOfDay: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/** Início e fim precisam estar no mesmo dia (fuso APP_TIMEZONE). */
export function assertSameDay(start: Date, end: Date): void {
  if (partsInTimeZone(start, env.APP_TIMEZONE).dateKey !== partsInTimeZone(end, env.APP_TIMEZONE).dateKey) {
    throw new AppError(
      400,
      "OUTSIDE_BUSINESS_HOURS",
      "A reserva não pode atravessar a meia-noite: início e fim devem ser no mesmo dia.",
    );
  }
}

/**
 * Por que o intervalo está fora do funcionamento regular do Art. 6º (domingo,
 * feriado/ponto facultativo ou fora das 07h–22h), ou null se estiver dentro.
 */
export function regularScheduleIssue(start: Date, end: Date): string | null {
  const s = partsInTimeZone(start, env.APP_TIMEZONE);
  const e = partsInTimeZone(end, env.APP_TIMEZONE);
  const holiday = holidayName(s.dateKey);
  if (weekdayOf(s.dateKey) === 0) return `${formatDayMonth(s.dateKey)} é domingo`;
  if (holiday) return `${formatDayMonth(s.dateKey)} é feriado ou ponto facultativo (${holiday})`;
  if (s.minutesOfDay < REGULAR_START_MIN || e.minutesOfDay > REGULAR_END_MIN || e.dateKey !== s.dateKey) {
    return "o horário passa do funcionamento regular (07h às 22h)";
  }
  return null;
}

const ART_6 =
  "Os espaços funcionam em dias úteis e aos sábados, das 07h às 22h. Domingos, feriados, pontos facultativos e outros horários só com autorização prévia da Divisão Acadêmica e custeio da equipe de apoio — fale com o SAD (Portaria 2793, Art. 6º).";

/** Solicitante: só no funcionamento regular (Art. 6º). */
export function assertRegularSchedule(start: Date, end: Date): void {
  assertSameDay(start, end);
  const issue = regularScheduleIssue(start, end);
  if (issue) throw new AppError(400, "OUTSIDE_BUSINESS_HOURS", `Não é possível reservar: ${issue}. ${ART_6}`);
}

/**
 * SAD: pode passar por cima do Art. 6º (a tela mostra o aviso). Devolve se o
 * intervalo é extraordinário, para marcar a reserva (libera o CHECK de horário).
 */
export function isExtraordinarySchedule(start: Date, end: Date): boolean {
  assertSameDay(start, end);
  return regularScheduleIssue(start, end) !== null;
}

export function assertValidDuration(start: Date, end: Date): void {
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) {
    throw new AppError(400, "INVALID_TIME_RANGE", "O horário de término deve ser depois do início.");
  }
  if (duration < MIN_DURATION_MS) {
    throw new AppError(400, "DURATION_OUT_OF_RANGE", "A duração mínima de uma reserva é de 30 minutos.");
  }
  if (duration > MAX_DURATION_MS) {
    throw new AppError(400, "DURATION_OUT_OF_RANGE", "A duração máxima de uma reserva é de 15 horas.");
  }
}

export function assertMinAdvance(start: Date, now: Date = new Date()): void {
  if (start.getTime() - now.getTime() < MIN_ADVANCE_MS) {
    throw new AppError(
      400,
      "BOOKING_TOO_SOON",
      "A solicitação deve ser enviada com no mínimo 3 dias de antecedência em relação à data do evento.",
    );
  }
}

/**
 * Art. 9º: o solicitante cancela (ou altera) pelo sistema até o 3º dia útil
 * antes da data da atividade. Devolve o último dia ("AAAA-MM-DD").
 */
export function requesterDeadline(start: Date): string {
  return cancellationDeadline(zonedDateKey(start));
}

export function isWithinRequesterDeadline(start: Date, now: Date = new Date()): boolean {
  return zonedDateKey(now) <= requesterDeadline(start);
}

// Portaria 2794, Art. 5º: coffee break e alimentação são vedados nas salas de
// aula, exceto nas salas de uso interativo 2366/2368 (Sala do Futuro), 2223
// (Design Thinking) e 1357. O formulário ainda não pergunta sobre coffee break
// (fica para depois, junto com as taxas); a regra só marca as salas candidatas.
const COFFEE_BREAK_ROOMS = /\b(2366|2368|2223|1357)\b/;

export function coffeeBreakAllowed(room: { name: string; roomType: RoomType }): boolean {
  return room.roomType !== "CLASSROOM" || COFFEE_BREAK_ROOMS.test(room.name);
}
