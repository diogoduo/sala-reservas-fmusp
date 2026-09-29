// Espelha as regras de src/reservations/rules.ts no back-end (fonte da verdade),
// só para dar feedback imediato no formulário. Qualquer coisa que passe aqui
// ainda é validada de novo no servidor.
//
// Não valida capacidade contra uma sala: o solicitante não escolhe a sala
// (o Admin aloca ao aprovar), então não há capacidade para comparar ainda.
const APP_TIMEZONE = "America/Sao_Paulo";
const BUSINESS_START_MIN = 7 * 60 + 30;
const BUSINESS_END_MIN = 22 * 60 + 30;
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
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** `requireAdvance: false` = sem os 3 dias de antecedência (alteração feita pelo SAD). */
export function validateReservationTimes(start: Date | null, end: Date | null, { requireAdvance = true } = {}): string[] {
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

  const startParts = partsInTimeZone(start);
  const endParts = partsInTimeZone(end);
  if (startParts.dateKey !== endParts.dateKey) {
    errors.push("A reserva não pode atravessar a meia-noite: início e fim devem ser no mesmo dia.");
  } else if (startParts.minutesOfDay < BUSINESS_START_MIN || endParts.minutesOfDay > BUSINESS_END_MIN) {
    errors.push("Reservas só são permitidas entre 07:30 e 22:30.");
  }

  if (requireAdvance && start.getTime() - Date.now() < MIN_ADVANCE_MS) {
    errors.push("A solicitação deve ser enviada com no mínimo 3 dias de antecedência.");
  } else if (!requireAdvance && start.getTime() <= Date.now()) {
    errors.push("Escolha um horário que ainda não passou.");
  }

  return errors;
}
