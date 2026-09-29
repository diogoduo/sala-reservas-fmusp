import { env } from "../config/env";

/** "2026-10-15" do instante `date` no fuso da aplicação (não no do servidor). */
export function zonedDateKey(date: Date, timeZone = env.APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Deslocamento do fuso naquele dia, no formato "-03:00". */
function offsetOn(dateKey: string, timeZone: string): string {
  const probe = new Date(`${dateKey}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1]! : "+00:00";
}

/** Início (inclusivo) e fim (exclusivo) do dia `dateKey` no fuso da aplicação. */
export function zonedDayRange(dateKey: string, timeZone = env.APP_TIMEZONE): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00${offsetOn(dateKey, timeZone)}`);
  const next = new Date(start.getTime() + 36 * 60 * 60 * 1000); // cai no dia seguinte mesmo com horário de verão
  const nextKey = zonedDateKey(next, timeZone);
  return { start, end: new Date(`${nextKey}T00:00:00${offsetOn(nextKey, timeZone)}`) };
}
