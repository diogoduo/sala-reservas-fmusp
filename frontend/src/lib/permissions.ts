import type { ActivityType } from "./types";

// Fase 9 — perfis e permissões. Espelha backend/src/auth/permissions.ts: o
// servidor é quem decide; aqui é só para mostrar a cada pessoa o que ela pode fazer.

export type UserRole = "USER" | "ADMIN" | "NUCEV";
export type Permission = "REQUEST_UNDERGRADUATE" | "REQUEST_GRADUATE" | "REQUEST_DEFENSE";

export const ROLE_LABELS: Record<UserRole, string> = { USER: "Solicitante", ADMIN: "SAD", NUCEV: "NUCEV" };

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  USER: "Pede reservas e acompanha as próprias.",
  ADMIN: "Analisa, aloca, aprova, reserva, altera e cancela; cuida das salas, recursos e pessoas.",
  NUCEV: "Núcleo de Eventos: acompanha a agenda, as solicitações e o histórico, sem alterar.",
};

export const PERMISSIONS: Permission[] = ["REQUEST_UNDERGRADUATE", "REQUEST_GRADUATE", "REQUEST_DEFENSE"];

export const PERMISSION_LABELS: Record<Permission, string> = {
  REQUEST_UNDERGRADUATE: "Pedir Graduação",
  REQUEST_GRADUATE: "Pedir Pós-Graduação",
  REQUEST_DEFENSE: "Pedir Defesa/Dissertação",
};

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

/** SAD e NUCEV: veem as reservas de todos e o inventário das salas. */
export const isStaff = (role: UserRole | undefined) => role === "ADMIN" || role === "NUCEV";

/** "Pede Graduação e Pós-Graduação", para o login de teste e a lista de pessoas. */
export function permissionSummary(permissions: Permission[]): string | null {
  if (permissions.length === 0) return null;
  const names = PERMISSIONS.filter((p) => permissions.includes(p)).map((p) => PERMISSION_LABELS[p].replace(/^Pedir /, ""));
  return `Pede ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`}`;
}
