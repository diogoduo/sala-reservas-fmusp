import type { OperationalTask, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedDateKey, zonedDayRange } from "../lib/timezone";
import { requireStaff } from "../middleware/auth";

// Fase 17 — checklist do dia (documento SAD/NUCEV, 5.3): as tarefas da equipe
// do SAD e do NUCEV, com responsável, prazo e prioridade. As pendências dos
// eventos (Fase 16) entram juntas, com o evento ao lado. Fica registrado quem
// criou, alterou e concluiu, com data e hora (e o Histórico guarda cada mudança).
//
// Fluxo inicial do documento: a Vanessa alimenta e atualiza; a Maria acompanha e
// conclui. As duas são do NUCEV, e o SAD também usa: todos da equipe podem tudo.
export const tasksRouter = Router();
tasksRouter.use(requireStaff);

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const asDate = (key: string) => new Date(`${key}T00:00:00Z`);
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const taskInclude = { event: { select: { id: true, protocol: true, title: true, status: true, closedAt: true } } } satisfies Prisma.OperationalTaskInclude;

const serialize = (t: OperationalTask & { event: { id: string; protocol: string; title: string } | null }) => ({ ...t, dueDate: dateOnly(t.dueDate) });

async function assignee(tx: Prisma.TransactionClient, id: string | null | undefined) {
  if (!id) return { assigneeId: null, assigneeName: null };
  const user = await tx.user.findFirst({ where: { id, role: { in: ["ADMIN", "NUCEV"] } }, select: { id: true, name: true } });
  if (!user) throw new AppError(400, "VALIDATION_ERROR", "Escolha alguém da equipe do SAD ou do NUCEV.");
  return { assigneeId: user.id, assigneeName: user.name };
}

async function linkedEvent(tx: Prisma.TransactionClient, id: string | null | undefined) {
  if (!id) return null;
  const event = await tx.event.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!event || ["CANCELLED", "REJECTED", "EXPIRED"].includes(event.status)) throw new AppError(400, "VALIDATION_ERROR", "Escolha um evento em andamento.");
  return event.id;
}

/**
 * O checklist de um dia: as atrasadas (abertas, com prazo antes do dia), as do
 * dia, as sem prazo (abertas) e as concluídas naquele dia. Mais a equipe (para
 * atribuir) e os eventos em andamento (para vincular).
 */
tasksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const date = dateKey.default(zonedDateKey(new Date())).parse(req.query.date);
    const { start, end } = zonedDayRange(date);
    const [tasks, team, events] = await Promise.all([
      prisma.operationalTask.findMany({
        where: {
          OR: [
            { status: "OPEN", dueDate: { lte: asDate(date) } },
            { status: "OPEN", dueDate: null },
            { dueDate: asDate(date) },
            { doneAt: { gte: start, lt: end } },
          ],
        },
        include: taskInclude,
        orderBy: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 500,
      }),
      prisma.user.findMany({ where: { role: { in: ["ADMIN", "NUCEV"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
      prisma.event.findMany({
        where: { status: { notIn: ["CANCELLED", "REJECTED", "EXPIRED"] }, closedAt: null },
        select: { id: true, protocol: true, title: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    res.json({ date, tasks: tasks.map(serialize), team, events });
  }),
);

const taskSchema = z.object({
  title: z.string().trim().min(2, "Diga o que precisa ser feito.").max(200),
  details: text(2000),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: dateKey.nullable().optional(),
  priority: z.boolean().optional(),
  eventId: z.string().uuid().nullable().optional(),
});

tasksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = taskSchema.parse(req.body);
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.operationalTask.create({
        data: {
          title: input.title,
          details: input.details,
          ...(await assignee(tx, input.assigneeId)),
          dueDate: input.dueDate ? asDate(input.dueDate) : null,
          priority: input.priority ?? false,
          eventId: await linkedEvent(tx, input.eventId),
          createdById: req.user!.id,
          createdByName: req.user!.name,
        },
        include: taskInclude,
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "task.create",
        entityType: "task",
        entityId: created.id,
        label: created.title,
        details: { assignee: created.assigneeName, dueDate: input.dueDate ?? null, priority: created.priority, event: created.event?.protocol ?? null },
      });
      return created;
    });
    res.status(201).json({ task: serialize(task) });
  }),
);

tasksRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = taskSchema.partial().extend({ done: z.boolean().optional() }).parse(req.body);
    const task = await prisma.$transaction(async (tx) => {
      const found = await tx.operationalTask.findUnique({ where: { id: req.params.id }, include: taskInclude });
      if (!found) throw new AppError(404, "NOT_FOUND", "Tarefa não encontrada.");
      const data: Prisma.OperationalTaskUncheckedUpdateInput = { updatedByName: req.user!.name };
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const track = (field: string, from: unknown, to: unknown) => {
        if (from !== to) changes[field] = { from, to };
      };
      if (input.title !== undefined) {
        data.title = input.title;
        track("title", found.title, input.title);
      }
      if (input.details !== undefined) {
        data.details = input.details;
        track("details", found.details, input.details);
      }
      if (input.assigneeId !== undefined) {
        const next = await assignee(tx, input.assigneeId);
        Object.assign(data, next);
        track("assignee", found.assigneeName, next.assigneeName);
      }
      if (input.dueDate !== undefined) {
        data.dueDate = input.dueDate ? asDate(input.dueDate) : null;
        track("dueDate", dateOnly(found.dueDate), input.dueDate);
      }
      if (input.priority !== undefined) {
        data.priority = input.priority;
        track("priority", found.priority, input.priority);
      }
      if (input.eventId !== undefined) {
        data.eventId = await linkedEvent(tx, input.eventId);
        track("event", found.eventId, data.eventId);
      }
      if (input.done !== undefined && input.done !== (found.status === "DONE")) {
        data.status = input.done ? "DONE" : "OPEN";
        data.doneAt = input.done ? new Date() : null;
        data.doneByName = input.done ? req.user!.name : null;
      }
      const updated = await tx.operationalTask.update({ where: { id: found.id }, data, include: taskInclude });
      const action = data.status === "DONE" ? "task.done" : data.status === "OPEN" ? "task.reopen" : "task.update";
      if (action !== "task.update" || Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          actor: req.user!,
          action,
          entityType: "task",
          entityId: updated.id,
          label: updated.title,
          changes: Object.keys(changes).length > 0 ? changes : undefined,
          details: updated.event ? { event: updated.event.protocol } : undefined,
        });
      }
      return updated;
    });
    res.json({ task: serialize(task) });
  }),
);

tasksRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const found = await tx.operationalTask.findUnique({ where: { id: req.params.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Tarefa não encontrada.");
      await tx.operationalTask.delete({ where: { id: found.id } });
      await recordAudit(tx, { actor: req.user!, action: "task.delete", entityType: "task", entityId: found.id, label: found.title });
    });
    res.json({ ok: true });
  }),
);
