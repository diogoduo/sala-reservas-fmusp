const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

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
