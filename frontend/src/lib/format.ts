const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const stripDot = (value: string) => value.replace(/\.$/, "");

/** "qua., 30/09/2026 · 14:00–15:00" */
export function formatDateTimeRange(start: string, end: string): string {
  const date = new Date(start).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${date} · ${formatTimeRange(start, end)}`;
}

/** "14:00–15:00" */
export function formatTimeRange(start: string, end: string): string {
  return `${time(start)}–${time(end)}`;
}

/** "30/09" */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Partes para o "bloquinho de calendário": { day: "30", month: "set", weekday: "qua" } */
export function dateTile(iso: string): { day: string; month: string; weekday: string } {
  const date = new Date(iso);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: stripDot(date.toLocaleDateString("pt-BR", { month: "short" })),
    weekday: stripDot(date.toLocaleDateString("pt-BR", { weekday: "short" })),
  };
}

/** "hoje", "amanhã", "em 5 dias", "em 3 semanas" */
export function relativeDays(iso: string, now = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days < 14) return `em ${days} dias`;
  return `em ${Math.round(days / 7)} semanas`;
}

/** Só a primeira letra em maiúscula ("setembro de 2026" → "Setembro de 2026"); o CSS `capitalize` pegaria todas as palavras. */
export function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "1 data" / "3 datas" */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
