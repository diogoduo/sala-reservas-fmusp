import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedDayRange } from "../lib/timezone";
import { requireStaff } from "../middleware/auth";

// Histórico geral (Fase 9): consulta do que foi gravado em audit_logs, do mais
// recente para o mais antigo, em páginas (cursor), com filtros.
export const auditRouter = Router();
auditRouter.use(requireStaff);

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

const querySchema = z.object({
  entityType: z.enum(["reservation", "room", "resource", "sanction", "regulation", "notebook", "user", "price", "event"]).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  actorId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const encodeCursor = (row: { createdAt: Date; id: string }) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");

function decodeCursor(cursor: string) {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (Number.isNaN(createdAt.getTime()) || !z.string().uuid().safeParse(id).success) {
    throw new AppError(400, "INVALID_CURSOR", "Página inválida. Recarregue o histórico.");
  }
  return { createdAt, id: id! };
}

auditRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const conditions: Prisma.AuditLogWhereInput[] = [];
    if (query.entityType) conditions.push({ entityType: query.entityType });
    if (query.entityId) conditions.push({ entityId: query.entityId });
    if (query.actorId) conditions.push({ actorId: query.actorId });
    if (query.q) {
      conditions.push({
        OR: [
          { label: { contains: query.q, mode: "insensitive" } },
          { actorName: { contains: query.q, mode: "insensitive" } },
          { entityId: { contains: query.q } },
        ],
      });
    }
    if (query.from) conditions.push({ createdAt: { gte: zonedDayRange(query.from).start } });
    if (query.to) conditions.push({ createdAt: { lt: zonedDayRange(query.to).end } });
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      conditions.push({ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] });
    }

    const rows = await prisma.auditLog.findMany({
      where: { AND: conditions },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: {
        id: true,
        createdAt: true,
        actorId: true,
        actorName: true,
        action: true,
        entityType: true,
        entityId: true,
        label: true,
        changes: true,
        details: true,
      },
    });
    const items = rows.slice(0, query.limit);
    res.json({ items, nextCursor: rows.length > query.limit ? encodeCursor(items.at(-1)!) : null });
  }),
);
