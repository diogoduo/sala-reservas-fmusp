import type { ActivityType } from "./types";

// Fase 9 — perfis e permissões. Espelha backend/src/auth/permissions.ts: o
// servidor é quem decide; aqui é só para mostrar a cada pessoa o que ela pode fazer.

export type UserRole = "USER" | "ADMIN" | "NUCEV";
export type Permission =
  | "REQUEST_UNDERGRADUATE"
  | "REQUEST_GRADUATE"
  | "REQUEST_DEFENSE"
  | "REQUEST_CULTURE_EXTENSION"
  | "REQUEST_PUBLIC_EXAM";

export const ROLE_LABELS: Record<UserRole, string> = { USER: "Solicitante", ADMIN: "SAD", NUCEV: "NUCEV" };

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  USER: "Pede reservas e acompanha as próprias.",
  ADMIN: "Analisa, aloca, aprova, reserva, altera e cancela; cuida das salas, recursos e pessoas.",
  NUCEV: "Núcleo de Eventos: acompanha a agenda, as solicitações e o histórico, sem alterar.",
};

/** Primeiro as que o SAD concede, depois as que todo cadastro já tem. */
export const PERMISSIONS: Permission[] = [
  "REQUEST_UNDERGRADUATE",
  "REQUEST_GRADUATE",
  "REQUEST_DEFENSE",
  "REQUEST_CULTURE_EXTENSION",
  "REQUEST_PUBLIC_EXAM",
];

/** O que todo cadastro novo recebe (Cultura e Extensão e Concurso). */
export const DEFAULT_PERMISSIONS: Permission[] = ["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"];

export const PERMISSION_LABELS: Record<Permission, string> = {
  REQUEST_UNDERGRADUATE: "Pedir Graduação",
  REQUEST_GRADUATE: "Pedir Pós-Graduação",
  REQUEST_DEFENSE: "Pedir Defesa/Dissertação",
  REQUEST_CULTURE_EXTENSION: "Pedir Cultura e Extensão",
  REQUEST_PUBLIC_EXAM: "Pedir Concurso",
};

/** A permissão que cada tipo exige. Tipo fora daqui (Reunião) = aberto a todos. */
export const ACTIVITY_PERMISSION: Partial<Record<ActivityType, Permission>> = {
  UNDERGRADUATE: "REQUEST_UNDERGRADUATE",
  GRADUATE: "REQUEST_GRADUATE",
  DEFENSE: "REQUEST_DEFENSE",
  CULTURE_EXTENSION: "REQUEST_CULTURE_EXTENSION",
  PUBLIC_EXAM: "REQUEST_PUBLIC_EXAM",
};

export function canRequestActivity(user: { role: UserRole; permissions: Permission[] }, type: ActivityType): boolean {
  if (user.role === "ADMIN") return true;
  const needed = ACTIVITY_PERMISSION[type];
  return !needed || user.permissions.includes(needed);
}

/** SAD e NUCEV: veem as reservas de todos e o inventário das salas. */
export const isStaff = (role: UserRole | undefined) => role === "ADMIN" || role === "NUCEV";

/** O que foge do padrão: as concedidas pelo SAD e as do padrão que foram retiradas. */
export function permissionChanges(permissions: Permission[]): { granted: Permission[]; removed: Permission[] } {
  return {
    granted: PERMISSIONS.filter((p) => !DEFAULT_PERMISSIONS.includes(p) && permissions.includes(p)),
    removed: DEFAULT_PERMISSIONS.filter((p) => !permissions.includes(p)),
  };
}

const typeName = (p: Permission) => PERMISSION_LABELS[p].replace(/^Pedir /, "");
const joinNames = (names: string[]) => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`);

/**
 * Para o login de teste: nada quando é o padrão; "Pede também Graduação e
 * Pós-Graduação" quando só ganhou tipos; "Pede só Defesa/Dissertação,
 * Pós-Graduação e Reunião" quando algum tipo do padrão foi retirado.
 */
export function permissionSummary(permissions: Permission[]): string | null {
  const { granted, removed } = permissionChanges(permissions);
  if (removed.length === 0) return granted.length > 0 ? `Pede também ${joinNames(granted.map(typeName))}` : null;
  const allowed = PERMISSIONS.filter((p) => permissions.includes(p)).map(typeName);
  return `Pede só ${joinNames([...allowed, "Reunião"])}`;
}
