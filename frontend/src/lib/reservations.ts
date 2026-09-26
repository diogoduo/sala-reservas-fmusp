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

/** Mesma regra do back-end: pendente ou aprovada, e ainda não começou. */
export function isCancellable(r: Pick<Reservation, "status" | "startTime">, now = Date.now()): boolean {
  return (r.status === "PENDING" || r.status === "APPROVED") && new Date(r.startTime).getTime() > now;
}
