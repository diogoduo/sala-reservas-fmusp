import type { Reservation } from "./types";

/** Junta as ocorrências de uma mesma série num grupo só, mantendo a ordem da lista. */
export function groupBySeries<T extends { id: string; seriesId: string | null }>(list: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of list) {
    const key = r.seriesId ?? r.id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
}

// Avisa outras partes da tela (ex.: o contador de pendentes na navegação) que
// alguma reserva mudou, sem precisar de um estado global.
const CHANGED_EVENT = "reservas:alteradas";

export function notifyReservationsChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onReservationsChanged(callback: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, callback);
  return () => window.removeEventListener(CHANGED_EVENT, callback);
}

/** Mesma regra do back-end: pendente ou aprovada, e ainda não começou. */
export function isCancellable(r: Pick<Reservation, "status" | "startTime">, now = Date.now()): boolean {
  return (r.status === "PENDING" || r.status === "APPROVED") && new Date(r.startTime).getTime() > now;
}
