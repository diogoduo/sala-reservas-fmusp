import { HandoverSituation, type Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedClock, zonedDateKey, zonedDayRange } from "../lib/timezone";
import { requireStaff } from "../middleware/auth";

// Fase 17 — plantão do SAD e do NUCEV (documento SAD/NUCEV, 5.4):
// - o retrato de um dia (eventos, reservas confirmadas e aguardando, tarefas e
//   quem cuida de quê), que serve à passagem de plantão e à visão do dia seguinte;
// - a passagem de plantão geral e por evento, com o "recebi" de quem assume.
export const plantaoRouter = Router();
plantaoRouter.use(requireStaff);

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const asDate = (key: string) => new Date(`${key}T00:00:00Z`);
const CLOSED = ["CANCELLED", "REJECTED", "EXPIRED"] as const;

/** Tudo o que acontece num dia, para o plantão. */
export async function dayOverview(date: string) {
  const { start, end } = zonedDayRange(date);
  const [events, reservations, tasks, overdue] = await Promise.all([
    prisma.event.findMany({
      where: { status: { notIn: [...CLOSED] }, days: { some: { date: asDate(date) } } },
      select: {
        id: true,
        protocol: true,
        title: true,
        status: true,
        closedAt: true,
        assigneeName: true,
        expectedAttendees: true,
        days: { where: { date: asDate(date) }, select: { startTime: true, endTime: true } },
        reservations: { where: { status: { in: ["PENDING", "APPROVED"] }, startTime: { gte: start, lt: end } }, select: { room: { select: { name: true } } } },
        plan: { select: { buffetNeeded: true, parkingNeeded: true } },
        _count: { select: { vehicles: true, tasks: { where: { status: "OPEN" } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reservation.findMany({
      where: { startTime: { gte: start, lt: end }, eventId: null, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true, protocol: true, title: true, startTime: true, endTime: true, status: true, room: { select: { name: true } }, user: { select: { name: true } } },
      orderBy: { startTime: "asc" },
    }),
    prisma.operationalTask.findMany({
      where: { OR: [{ dueDate: asDate(date) }, { doneAt: { gte: start, lt: end } }, { status: "OPEN", priority: true }] },
      select: { id: true, title: true, status: true, priority: true, assigneeName: true, doneByName: true, doneAt: true, dueDate: true, event: { select: { protocol: true, title: true } } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    prisma.operationalTask.count({ where: { status: "OPEN", dueDate: { lt: asDate(date) } } }),
  ]);

  const openTasks = await prisma.operationalTask.findMany({
    where: { status: "OPEN", OR: [{ dueDate: { lte: asDate(date) } }, { dueDate: null }] },
    select: { assigneeName: true },
  });
  const byPerson = new Map<string, { tasks: number; events: string[] }>();
  for (const t of openTasks) {
    const key = t.assigneeName ?? "Sem responsável";
    byPerson.set(key, { tasks: (byPerson.get(key)?.tasks ?? 0) + 1, events: byPerson.get(key)?.events ?? [] });
  }
  for (const e of events) {
    if (!e.assigneeName) continue;
    const entry = byPerson.get(e.assigneeName) ?? { tasks: 0, events: [] };
    entry.events.push(e.title);
    byPerson.set(e.assigneeName, entry);
  }

  return {
    date,
    events: events.map((e) => ({
      id: e.id,
      protocol: e.protocol,
      title: e.title,
      status: e.status,
      closedAt: e.closedAt,
      assigneeName: e.assigneeName,
      expectedAttendees: e.expectedAttendees,
      start: e.days[0] ? zonedClock(e.days[0].startTime) : null,
      end: e.days[0] ? zonedClock(e.days[0].endTime) : null,
      rooms: [...new Set(e.reservations.map((r) => r.room!.name))],
      buffet: e.plan?.buffetNeeded ?? false,
      parking: e.plan?.parkingNeeded ?? false,
      vehicles: e._count.vehicles,
      openTasks: e._count.tasks,
    })),
    reservations: {
      confirmed: reservations.filter((r) => r.status === "APPROVED"),
      awaiting: reservations.filter((r) => r.status === "PENDING"),
    },
    tasks: {
      due: tasks.filter((t) => t.dueDate && t.dueDate.toISOString().slice(0, 10) === date),
      doneToday: tasks.filter((t) => t.doneAt && t.doneAt >= start && t.doneAt < end),
      priority: tasks.filter((t) => t.status === "OPEN" && t.priority),
      overdue,
      open: openTasks.length,
    },
    people: [...byPerson.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name)),
  };
}

plantaoRouter.get(
  "/day",
  asyncHandler(async (req, res) => {
    res.json(await dayOverview(dateKey.default(zonedDateKey(new Date())).parse(req.query.date)));
  }),
);

// ---------------------------------------------------------------------------
// Passagem de plantão
// ---------------------------------------------------------------------------

const handoverInclude = { events: { orderBy: { eventLabel: "asc" } } } satisfies Prisma.ShiftHandoverInclude;
const serialize = <T extends { date: Date }>(h: T) => ({ ...h, date: h.date.toISOString().slice(0, 10) });

plantaoRouter.get(
  "/handovers",
  asyncHandler(async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const [handovers, team] = await Promise.all([
      prisma.shiftHandover.findMany({ include: handoverInclude, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.user.findMany({ where: { role: { in: ["ADMIN", "NUCEV"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    ]);
    res.json({ handovers: handovers.map(serialize), team });
  }),
);

const handoverSchema = z.object({
  date: dateKey,
  shiftLabel: text(60),
  summary: text(6000),
  pending: text(6000),
  priorities: text(4000),
  nextResponsibleId: z.string().uuid().nullable().optional(),
  notes: text(4000),
  events: z
    .array(
      z.object({
        eventId: z.string().uuid(),
        situation: z.nativeEnum(HandoverSituation).default("ON_TRACK"),
        done: text(4000),
        doneBy: text(200),
        pending: text(4000),
        nextResponsibleName: text(200),
        notes: text(2000),
      }),
    )
    .max(50)
    .default([]),
});

plantaoRouter.post(
  "/handovers",
  asyncHandler(async (req, res) => {
    const input = handoverSchema.parse(req.body);
    if (!input.summary && !input.pending && !input.priorities && !input.notes && input.events.length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Escreva ao menos o resumo, as pendências ou a passagem de um evento.");
    }
    const overview = await dayOverview(input.date);
    const handover = await prisma.$transaction(async (tx) => {
      const next = input.nextResponsibleId
        ? await tx.user.findFirst({ where: { id: input.nextResponsibleId, role: { in: ["ADMIN", "NUCEV"] } }, select: { id: true, name: true } })
        : null;
      if (input.nextResponsibleId && !next) throw new AppError(400, "VALIDATION_ERROR", "Escolha alguém da equipe do SAD ou do NUCEV.");
      const events = await tx.event.findMany({ where: { id: { in: input.events.map((e) => e.eventId) } }, select: { id: true, protocol: true, title: true } });
      if (events.length !== new Set(input.events.map((e) => e.eventId)).size) throw new AppError(400, "VALIDATION_ERROR", "Evento não encontrado.");
      const label = (id: string) => {
        const e = events.find((x) => x.id === id)!;
        return `${e.protocol} — ${e.title}`;
      };
      const created = await tx.shiftHandover.create({
        data: {
          date: asDate(input.date),
          shiftLabel: input.shiftLabel,
          summary: input.summary,
          pending: input.pending,
          priorities: input.priorities,
          nextResponsibleId: next?.id ?? null,
          nextResponsibleName: next?.name ?? null,
          notes: input.notes,
          snapshot: overview as unknown as Prisma.InputJsonValue,
          createdById: req.user!.id,
          createdByName: req.user!.name,
          events: { create: input.events.map(({ eventId, ...e }) => ({ eventId, eventLabel: label(eventId), ...e })) },
        },
        include: handoverInclude,
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "handover.create",
        entityType: "handover",
        entityId: created.id,
        label: `Passagem de plantão de ${input.date.split("-").reverse().join("/")}${input.shiftLabel ? ` (${input.shiftLabel})` : ""}`,
        details: { next: next?.name ?? null, events: created.events.map((e) => e.eventLabel) },
      });
      return created;
    });
    res.status(201).json({ handover: serialize(handover) });
  }),
);

/** Quem assume confirma que recebeu o plantão. */
plantaoRouter.post(
  "/handovers/:id/acknowledge",
  asyncHandler(async (req, res) => {
    const handover = await prisma.$transaction(async (tx) => {
      const found = await tx.shiftHandover.findUnique({ where: { id: req.params.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Passagem de plantão não encontrada.");
      if (found.acknowledgedAt) throw new AppError(409, "ALREADY_ACKNOWLEDGED", `Já recebida por ${found.acknowledgedByName}.`);
      if (found.createdById === req.user!.id) throw new AppError(409, "OWN_HANDOVER", "Quem recebe o plantão é outra pessoa da equipe.");
      const updated = await tx.shiftHandover.update({ where: { id: found.id }, data: { acknowledgedAt: new Date(), acknowledgedByName: req.user!.name }, include: handoverInclude });
      await recordAudit(tx, {
        actor: req.user!,
        action: "handover.acknowledge",
        entityType: "handover",
        entityId: found.id,
        label: `Passagem de plantão de ${found.date.toISOString().slice(0, 10).split("-").reverse().join("/")}`,
      });
      return updated;
    });
    res.json({ handover: serialize(handover) });
  }),
);
