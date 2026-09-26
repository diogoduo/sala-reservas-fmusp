// Prévia das datas de uma série no formulário — mesma regra que o back-end
// expande com a lib rrule (FREQ=WEEKLY;INTERVAL=n;BYDAY=…), que continua sendo
// a fonte da verdade. Semanas começam na segunda (WKST=MO, padrão do RFC 5545).

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_OCCURRENCES = 260; // mesmo teto do back-end
const DAY_MS = 24 * 60 * 60 * 1000;

/** Datas (YYYY-MM-DD) em que a série acontece, a partir de `startDate` até `untilDate` inclusive. */
export function previewWeeklyDates(startDate: string, untilDate: string, weekdays: Set<string>, interval: number): string[] {
  if (!startDate || !untilDate || weekdays.size === 0) return [];
  const start = new Date(`${startDate}T12:00:00`); // meio-dia: imune a mudanças de fuso/horário de verão
  const until = new Date(`${untilDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(until.getTime()) || until < start) return [];

  // Segunda-feira da semana do início: referência para contar as semanas do INTERVAL.
  const weekStart = new Date(start);
  weekStart.setDate(start.getDate() - ((start.getDay() + 6) % 7));

  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= until && dates.length < MAX_OCCURRENCES; cursor.setDate(cursor.getDate() + 1)) {
    const week = Math.floor(Math.round((cursor.getTime() - weekStart.getTime()) / DAY_MS) / 7);
    if (week % interval === 0 && weekdays.has(WEEKDAY_CODES[cursor.getDay()]!)) {
      dates.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
      );
    }
  }
  return dates;
}
