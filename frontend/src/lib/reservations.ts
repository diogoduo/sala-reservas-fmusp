import { cancellationDeadline, dateKeyOf } from "./calendar";
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

/**
 * Último dia ("AAAA-MM-DD") para o solicitante cancelar ou alterar pelo
 * sistema: 3 dias úteis antes da data (Portaria 2793, Art. 9º).
 */
export function requesterDeadline(r: Pick<Reservation, "startTime">): string {
  return cancellationDeadline(dateKeyOf(r.startTime));
}

const withinDeadline = (r: Pick<Reservation, "startTime">, now: number) => dateKeyOf(new Date(now)) <= requesterDeadline(r);

/**
 * Mesma regra do back-end: a aprovada é cancelada até 3 dias úteis antes
 * (Art. 9º); o pedido ainda pendente pode ser retirado até o horário começar.
 */
export function isCancellable(r: Pick<Reservation, "status" | "startTime">, now = Date.now()): boolean {
  if (r.status === "PENDING") return new Date(r.startTime).getTime() > now;
  return r.status === "APPROVED" && withinDeadline(r, now);
}

/** Aprovada que já passou do prazo de cancelamento pelo sistema, mas ainda não começou. */
export function isPastCancelDeadline(r: Pick<Reservation, "status" | "startTime">, now = Date.now()): boolean {
  return r.status === "APPROVED" && new Date(r.startTime).getTime() > now && !withinDeadline(r, now);
}

/** Mesma regra do back-end: pendente ou aprovada, até 3 dias úteis antes da data. */
export function isEditable(r: Pick<Reservation, "status" | "startTime">, now = Date.now()): boolean {
  return (r.status === "PENDING" || r.status === "APPROVED") && withinDeadline(r, now);
}

/** Início da atividade (a reserva começa antes, na montagem — Art. 19). */
export function activityStart(r: Pick<Reservation, "startTime" | "setupMinutes">): Date {
  return new Date(new Date(r.startTime).getTime() + (r.setupMinutes ?? 0) * 60_000);
}

/** "1 h 30 min" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Hora de comparecer ao SAD/NE: 10 minutos antes do início (Art. 10). */
export function keyPickupTime(r: Pick<Reservation, "startTime">): string {
  return new Date(new Date(r.startTime).getTime() - 10 * 60_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Pendente de novo depois de o solicitante alterar (aba "Alteradas" do SAD). */
export function isModifiedPending(r: Pick<Reservation, "status" | "modifiedByRequesterAt">): boolean {
  return r.status === "PENDING" && r.modifiedByRequesterAt !== null;
}
