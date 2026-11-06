import type { ActivityType, Permission, UserRole } from "@prisma/client";
import { AppError } from "../lib/errors";
import { ACTIVITY_TYPE_LABELS } from "../reservations/activities";

// Fase 9 — quem pode pedir cada tipo de atividade. Graduação, Pós-Graduação e
// Defesa são exclusivos de quem recebeu a permissão do SAD (ex.: o Serviço de
// Pós-Graduação pede as defesas; o de Graduação, as aulas). Os outros tipos
// (Cultura e Extensão, Concurso, Reunião) continuam abertos a todos. O SAD
// reserva qualquer tipo pelas próprias telas.

/** A permissão que cada tipo restrito exige. Tipo fora daqui = aberto a todos. */
export const ACTIVITY_PERMISSION: Partial<Record<ActivityType, Permission>> = {
  UNDERGRADUATE: "REQUEST_UNDERGRADUATE",
  GRADUATE: "REQUEST_GRADUATE",
  DEFENSE: "REQUEST_DEFENSE",
};

export function canRequestActivity(user: { role: UserRole; permissions: Permission[] }, type: ActivityType): boolean {
  if (user.role === "ADMIN") return true;
  const needed = ACTIVITY_PERMISSION[type];
  return !needed || user.permissions.includes(needed);
}

export function assertCanRequestActivity(user: { role: UserRole; permissions: Permission[] }, type: ActivityType): void {
  if (!canRequestActivity(user, type)) {
    throw new AppError(
      403,
      "ACTIVITY_NOT_ALLOWED",
      `Reservas de ${ACTIVITY_TYPE_LABELS[type]} são pedidas só por quem tem permissão do SAD. Se você precisa pedir, fale com o SAD.`,
    );
  }
}
