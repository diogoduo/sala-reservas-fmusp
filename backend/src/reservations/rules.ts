import { env } from "../config/env";
import { AppError } from "../lib/errors";

// Mesmos limites do CHECK "reservations_business_hours_check" / "_duration_check"
// na migration db_constraints — mantidos em dois lugares de propósito: aqui para
// dar uma mensagem amigável antes de tentar gravar, lá como última garantia.
const BUSINESS_START_MIN = 7 * 60 + 30; // 07:30
const BUSINESS_END_MIN = 22 * 60 + 30; // 22:30
const MIN_DURATION_MS = 30 * 60 * 1000;
const MAX_DURATION_MS = 15 * 60 * 60 * 1000;
// Suposição: "3 dias de antecedência" tratado como 72 horas corridas até o início
// do evento, não como "3 dias de calendário". Ajuste aqui se a regra pretendida for outra.
const MIN_ADVANCE_MS = 3 * 24 * 60 * 60 * 1000;

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
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Início e fim precisam estar no mesmo dia (fuso APP_TIMEZONE) e dentro de 07:30–22:30. */
export function assertWithinBusinessHours(start: Date, end: Date): void {
  const tz = env.APP_TIMEZONE;
  const startParts = partsInTimeZone(start, tz);
  const endParts = partsInTimeZone(end, tz);

  if (startParts.dateKey !== endParts.dateKey) {
    throw new AppError(
      400,
      "OUTSIDE_BUSINESS_HOURS",
      "A reserva não pode atravessar a meia-noite: início e fim devem ser no mesmo dia.",
    );
  }
  if (startParts.minutesOfDay < BUSINESS_START_MIN || endParts.minutesOfDay > BUSINESS_END_MIN) {
    throw new AppError(400, "OUTSIDE_BUSINESS_HOURS", "Reservas só são permitidas entre 07:30 e 22:30.");
  }
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

export function assertCapacity(expectedAttendees: number, roomCapacity: number | null): void {
  if (roomCapacity !== null && expectedAttendees > roomCapacity) {
    throw new AppError(
      400,
      "CAPACITY_EXCEEDED",
      `A sala comporta no máximo ${roomCapacity} pessoas; foram informadas ${expectedAttendees}.`,
    );
  }
}
