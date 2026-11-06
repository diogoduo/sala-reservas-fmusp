import type { ActivityType, Permission, UserRole } from "@prisma/client";
import { AppError } from "../lib/errors";
import { ACTIVITY_TYPE_LABELS } from "../reservations/activities";

// Fase 9 — quem pode pedir cada tipo de atividade. Graduação, Pós-Graduação e
// Defesa são exclusivos de quem recebeu a permissão do SAD (ex.: o Serviço de
// Pós-Graduação pede as defesas; o de Graduação, as aulas). Cultura e Extensão
// e Concurso vêm ligados para todos, e o SAD pode tirar de quem só deve pedir
// um tipo. Reunião é aberta a todos. O SAD reserva qualquer tipo pelas próprias telas.

/** A permissão que cada tipo exige. Tipo fora daqui (Reunião) = aberto a todos. */
export const ACTIVITY_PERMISSION: Partial<Record<ActivityType, Permission>> = {
  UNDERGRADUATE: "REQUEST_UNDERGRADUATE",
  GRADUATE: "REQUEST_GRADUATE",
  DEFENSE: "REQUEST_DEFENSE",
  CULTURE_EXTENSION: "REQUEST_CULTURE_EXTENSION",
  PUBLIC_EXAM: "REQUEST_PUBLIC_EXAM",
};

/** O que todo cadastro novo recebe (igual ao padrão da coluna users.permissions). */
export const DEFAULT_PERMISSIONS: Permission[] = ["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"];

/** Ordem fixa (alfabética, como o banco guarda): o histórico não acusa mudança só pela ordem. */
export const sortPermissions = (list: Permission[]): Permission[] => [...new Set(list)].sort();

/** Permissões diferentes do padrão: quem pede tipos exclusivos ou teve algum tipo retirado. */
export const hasCustomPermissions = (list: Permission[]) =>
  sortPermissions(list).join() !== sortPermissions(DEFAULT_PERMISSIONS).join();

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
