import { addDays, holidayName, weekdayOf } from "../src/lib/calendar";
import { zonedDateKey, zonedDayRange } from "../src/lib/timezone";

/** Instante de "HH:MM" no dia `dateKey`, em São Paulo. */
export function atTime(dateKey: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(zonedDayRange(dateKey).start.getTime() + (h! * 60 + m!) * 60_000);
}

/**
 * Instante de "HH:MM" em São Paulo no primeiro dia da semana `weekday`
 * (0 = domingo) a partir de `minDaysAhead` dias de hoje, pulando feriados.
 * Os testes rodam em qualquer data, então as datas são sempre relativas a hoje.
 */
export function upcoming(weekday: number, minDaysAhead: number, time: string): Date {
  let key = zonedDateKey(new Date(Date.now() + minDaysAhead * 86_400_000));
  while (weekdayOf(key) !== weekday || holidayName(key)) key = addDays(key, 1);
  return atTime(key, time);
}

/** "2026-11-11 21:00" em São Paulo. */
export function local(date: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${zonedDateKey(date)} ${time}`;
}
