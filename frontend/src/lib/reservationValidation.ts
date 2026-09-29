import { formatDayMonth, holidayName, weekdayOf } from "./calendar";

// Espelha as regras de src/reservations/rules.ts no back-end (fonte da verdade),
// só para dar feedback imediato no formulário. Qualquer coisa que passe aqui
// ainda é validada de novo no servidor.
//
// Não valida capacidade contra uma sala: o solicitante não escolhe a sala
// (o Admin aloca ao aprovar), então não há capacidade para comparar ainda.
const APP_TIMEZONE = "America/Sao_Paulo";
/** Portaria 2793, Art. 6º: dias úteis e sábados, das 07h às 22h. */
const REGULAR_START_MIN = 7 * 60;
const REGULAR_END_MIN = 22 * 60;
const MIN_DURATION_MS = 30 * 60 * 1000;
const MAX_DURATION_MS = 15 * 60 * 60 * 1000;
const MIN_ADVANCE_MS = 3 * 24 * 60 * 60 * 1000;

function partsInTimeZone(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
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
    minutesOfDay: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/**
 * Por que o intervalo está fora do funcionamento regular (domingo, feriado ou
 * fora das 07h–22h), ou null. Mesma regra de regularScheduleIssue no back-end.
 */
export function regularScheduleIssue(start: Date, end: Date): string | null {
  const s = partsInTimeZone(start);
  const e = partsInTimeZone(end);
  const holiday = holidayName(s.dateKey);
  if (weekdayOf(s.dateKey) === 0) return `${formatDayMonth(s.dateKey)} é domingo`;
  if (holiday) return `${formatDayMonth(s.dateKey)} é feriado ou ponto facultativo (${holiday})`;
  if (s.minutesOfDay < REGULAR_START_MIN || e.minutesOfDay > REGULAR_END_MIN || e.dateKey !== s.dateKey) {
    return "o horário passa do funcionamento regular (07h às 22h)";
  }
  return null;
}

/**
 * `start` já inclui a montagem (é o início do período reservado).
 * `asAdmin`: sem os 3 dias de antecedência e sem barrar horário extraordinário
 * (o SAD confirma a autorização da Divisão Acadêmica no formulário).
 */
export function validateReservationTimes(start: Date | null, end: Date | null, { asAdmin = false } = {}): string[] {
  const errors: string[] = [];
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return ["Informe data e horários válidos."];
  }

  const duration = end.getTime() - start.getTime();
  if (duration <= 0) {
    errors.push("O horário de término deve ser depois do início.");
  } else {
    if (duration < MIN_DURATION_MS) errors.push("A duração mínima é de 30 minutos.");
    if (duration > MAX_DURATION_MS) errors.push("A duração máxima é de 15 horas.");
  }

  if (partsInTimeZone(start).dateKey !== partsInTimeZone(end).dateKey) {
    errors.push("A reserva não pode atravessar a meia-noite: início e fim devem ser no mesmo dia.");
  } else if (!asAdmin) {
    const issue = regularScheduleIssue(start, end);
    if (issue) {
      errors.push(
        `Não é possível reservar: ${issue}. Os espaços funcionam em dias úteis e aos sábados, das 07h às 22h; fora disso, só com autorização da Divisão Acadêmica — fale com o SAD.`,
      );
    }
  }

  if (!asAdmin && start.getTime() - Date.now() < MIN_ADVANCE_MS) {
    errors.push("A solicitação deve ser enviada com no mínimo 3 dias de antecedência.");
  } else if (asAdmin && start.getTime() <= Date.now()) {
    errors.push("Escolha um horário que ainda não passou.");
  }

  return errors;
}
