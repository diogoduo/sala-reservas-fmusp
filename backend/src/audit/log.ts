import { Prisma, type PrismaClient } from "@prisma/client";

// Histórico geral (Fase 9). Cada ação que muda dados grava uma linha em
// audit_logs, na mesma transação da alteração: ou as duas coisas ficam gravadas,
// ou nenhuma. Uma ação sobre uma série inteira gera uma linha só, com as datas
// afetadas em `details`.

export type AuditAction =
  // Reservas — solicitante
  | "reservation.request"
  | "reservation.edit"
  | "reservation.cancel"
  // Reservas — SAD
  | "reservation.approve"
  | "reservation.reject"
  | "reservation.admin_create"
  | "reservation.admin_edit"
  | "reservation.admin_cancel"
  | "reservation.no_show"
  | "reservation.no_show_undo"
  // Salas e fotos
  | "room.create"
  | "room.update"
  | "room.delete"
  | "room.photo_add"
  | "room.photo_caption"
  | "room.photo_order"
  | "room.photo_delete"
  // Recursos, regulamento e notebooks
  | "resource.create"
  | "resource.update"
  | "resource.delete"
  | "regulation.update"
  | "regulation.file_add"
  | "regulation.file_delete"
  | "notebook.create"
  | "notebook.update"
  | "notebook.delete"
  // Pessoas: cadastro, papel e permissões, sanções
  | "user.create"
  | "user.update"
  | "sanction.create"
  | "sanction.lift"
  // Preços (Portaria 2794): tabelas com vigência e categorias
  | "price.table_create"
  | "price.table_update"
  | "price.table_delete"
  | "price.category_create"
  | "price.category_update"
  // Eventos (Fases 11 a 13)
  | "event.request"
  | "event.cancel";

export type AuditEntityType = "reservation" | "room" | "resource" | "sanction" | "regulation" | "notebook" | "user" | "price" | "event";

/** Quem fez a ação. `null` = o próprio sistema. */
export type AuditActor = { id: string; name: string } | null;

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntityType;
  /** Reservas: o protocolo. Demais: o id. */
  entityId: string;
  label?: string | null;
  changes?: Record<string, FieldChange> | null;
  details?: Record<string, unknown> | null;
}

type Db = Prisma.TransactionClient | PrismaClient;

/** Datas viram texto ISO e `undefined` some, como no JSON que vai para o banco. */
const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  const hasChanges = entry.changes && Object.keys(entry.changes).length > 0;
  await db.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorName: entry.actor?.name ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      label: entry.label ?? null,
      changes: hasChanges ? toJson(entry.changes) : Prisma.DbNull,
      details: entry.details ? toJson(entry.details) : Prisma.DbNull,
    },
  });
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value === undefined ? null : value;
}

/** Só os campos que mudaram entre `before` e `after`. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[] = Object.keys(after),
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const key of keys) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Rótulos e retratos usados por várias rotas
// ---------------------------------------------------------------------------

type RoomLike = { name: string; building: string; floor: string };

export const roomLabel = (room: RoomLike | null | undefined) => (room ? `${room.name} — ${room.building}, ${room.floor}` : null);

export const reservationLabel = (r: { protocol: string; title: string }) => `${r.protocol} — ${r.title}`;

/** As datas afetadas por uma ação (até 60; `count` diz quantas foram no total). */
export function datesDetail(reservations: { startTime: Date }[]) {
  const dates = reservations.map((r) => r.startTime.toISOString()).sort();
  return { count: dates.length, dates: dates.slice(0, 60) };
}

/** O que o histórico compara numa reserva. */
export function reservationSnapshot(r: {
  status: string;
  startTime: Date;
  endTime: Date;
  title: string;
  expectedAttendees: number;
  activityType: string | null;
  setupMinutes: number;
  supportNotes: string | null;
  roomName: string | null;
  resources: string[];
}) {
  return {
    status: r.status,
    startTime: r.startTime,
    endTime: r.endTime,
    room: r.roomName,
    title: r.title,
    expectedAttendees: r.expectedAttendees,
    activityType: r.activityType,
    setupMinutes: r.setupMinutes,
    supportNotes: r.supportNotes,
    resources: r.resources,
  };
}

/** Recursos pedidos em texto ("Computador (2)", "Webconferência: Zoom"), na ordem do nome. */
export async function describeRequestedResources(
  db: Db,
  items: { resourceId: string; quantity?: number | null; detail?: string | null }[],
): Promise<string[]> {
  if (items.length === 0) return [];
  const names = new Map(
    (await db.resource.findMany({ where: { id: { in: items.map((i) => i.resourceId) } }, select: { id: true, name: true } })).map((r) => [
      r.id,
      r.name,
    ]),
  );
  return items
    .map((i) => `${names.get(i.resourceId) ?? "recurso removido"}${i.quantity ? ` (${i.quantity})` : ""}${i.detail ? `: ${i.detail}` : ""}`)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}
