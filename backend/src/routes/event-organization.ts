import { EventPersonKind, type Prisma } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedClock, zonedDateKey, zonedTime } from "../lib/timezone";
import { isStaff, requireAuth, requireStaff } from "../middleware/auth";

// Fase 16 — organização do evento confirmado (documento SAD/NUCEV, 5.1 e
// etapas 9 e 10): logística (buffet, estacionamento, estrutura, equipamentos,
// observações), programação e cronograma, responsáveis pela organização,
// palestrantes externos, participantes e pendências. Depois do último dia, a
// equipe encerra o evento ("Finalizado") com o balanço. Tudo vai para o Histórico.
//
// Quem edita: o NUCEV e o SAD, depois da confirmação. Palestrantes externos,
// participantes e veículos (placas para a liberação de vagas) quem informa é o
// solicitante, antes ou depois da confirmação, enquanto o evento está aberto; a
// equipe vê e também pode editar.
export const eventOrganizationRouter = Router();

/** O que o solicitante informa: palestrantes e participantes (e os veículos, à parte). */
const GUEST_KINDS: EventPersonKind[] = ["SPEAKER", "PARTICIPANT"];
const CLOSED_STATUSES = ["CANCELLED", "REJECTED", "EXPIRED"];

function requireNucev(req: Request, _res: Response, next: NextFunction): void {
  const role = req.user?.role;
  if (role === "NUCEV" || role === "ADMIN") return next();
  next(new AppError(403, "FORBIDDEN", role ? "Só o NUCEV (ou o SAD) pode fazer isso." : "Faça login para continuar."));
}

const label = (e: { protocol: string; title: string }) => `${e.protocol} — ${e.title}`;
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário no formato HH:MM.");

async function loadEvent(id: string) {
  const event = await prisma.event.findUnique({ where: { id }, include: { days: { orderBy: { date: "asc" } } } });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  return event;
}

type LoadedEvent = Awaited<ReturnType<typeof loadEvent>>;
const dayKeys = (event: LoadedEvent) => event.days.map((d) => d.date.toISOString().slice(0, 10));

/** A organização é do evento confirmado e ainda não encerrado. */
function assertEditable(event: LoadedEvent) {
  if (event.status !== "CONFIRMED") throw new AppError(409, "EVENT_NOT_CONFIRMED", "A organização abre depois que o SAD confirma a reserva do evento.");
  if (event.closedAt) throw new AppError(409, "EVENT_CLOSED", "O evento já foi encerrado: a organização fica só para consulta.");
}

/** As listas do solicitante ficam abertas enquanto o evento não foi cancelado, recusado, vencido ou encerrado. */
const guestsOpen = (event: LoadedEvent) => !CLOSED_STATUSES.includes(event.status) && !event.closedAt;

/** Quem pediu o evento ou a equipe; para os outros, o evento "não existe". */
function assertGuestAccess(req: Request, event: LoadedEvent) {
  if (!isStaff(req.user?.role) && event.userId !== req.user?.id) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
}

function assertGuestsEditable(event: LoadedEvent) {
  if (event.closedAt) throw new AppError(409, "EVENT_CLOSED", "O evento já foi encerrado: as listas ficam só para consulta.");
  if (CLOSED_STATUSES.includes(event.status)) throw new AppError(409, "EVENT_CLOSED", "Este pedido foi cancelado, recusado ou venceu: as listas ficam só para consulta.");
}

/** Palestrantes e participantes: o solicitante ou a equipe; a organização (responsáveis): só a equipe, depois da confirmação. */
function assertPeopleEditable(req: Request, event: LoadedEvent, kind: EventPersonKind) {
  if (GUEST_KINDS.includes(kind)) {
    assertGuestAccess(req, event);
    assertGuestsEditable(event);
    return;
  }
  if (!isStaff(req.user?.role)) throw new AppError(403, "FORBIDDEN", "Só o NUCEV (ou o SAD) pode fazer isso.");
  assertEditable(event);
}

async function audit(tx: Prisma.TransactionClient, req: Request, event: LoadedEvent, section: string, change: string, details: Record<string, unknown> = {}) {
  await recordAudit(tx, {
    actor: req.user!,
    action: "event.organization",
    entityType: "event",
    entityId: event.protocol,
    label: label(event),
    details: { section, change, ...details },
  });
}

// ---------------------------------------------------------------------------
// Leitura: tudo da organização de uma vez
// ---------------------------------------------------------------------------

eventOrganizationRouter.get(
  "/:id/organization",
  requireStaff,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    const [plan, schedule, people, vehicles, tasks, team] = await Promise.all([
      prisma.eventPlan.findUnique({ where: { eventId: event.id } }),
      prisma.eventScheduleItem.findMany({ where: { eventId: event.id }, orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }] }),
      prisma.eventPerson.findMany({ where: { eventId: event.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
      prisma.eventVehicle.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" } }),
      prisma.operationalTask.findMany({ where: { eventId: event.id }, orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
      // Para quem atribuir as pendências: a equipe do SAD e do NUCEV.
      prisma.user.findMany({ where: { role: { in: ["ADMIN", "NUCEV"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    ]);
    res.json({
      editable: event.status === "CONFIRMED" && !event.closedAt,
      guestsEditable: guestsOpen(event),
      closable: event.status === "CONFIRMED" && !event.closedAt && dayKeys(event).at(-1)! <= zonedDateKey(new Date()),
      plan,
      schedule: schedule.map((s) => ({ ...s, date: zonedDateKey(s.startsAt), start: zonedClock(s.startsAt), end: zonedClock(s.endsAt) })),
      people,
      vehicles,
      tasks: tasks.map((t) => ({ ...t, dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null })),
      team,
    });
  }),
);

/** O que o solicitante informa (e vê): palestrantes, participantes e veículos. */
eventOrganizationRouter.get(
  "/:id/guests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    assertGuestAccess(req, event);
    const [people, vehicles] = await Promise.all([
      prisma.eventPerson.findMany({ where: { eventId: event.id, kind: { in: GUEST_KINDS } }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
      prisma.eventVehicle.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" } }),
    ]);
    res.json({ editable: guestsOpen(event), people, vehicles });
  }),
);

// ---------------------------------------------------------------------------
// Logística
// ---------------------------------------------------------------------------

const planSchema = z.object({
  buffetNeeded: z.boolean(),
  buffetDetails: text(2000),
  parkingNeeded: z.boolean(),
  parkingSpots: z.number().int().min(0).max(5000).nullable().optional(),
  parkingDetails: text(2000),
  structure: text(4000),
  equipment: text(4000),
  notes: text(4000),
});

eventOrganizationRouter.put(
  "/:id/organization/plan",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = planSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    const data = {
      ...input,
      buffetDetails: input.buffetNeeded ? input.buffetDetails : null,
      parkingSpots: input.parkingNeeded ? (input.parkingSpots ?? null) : null,
      parkingDetails: input.parkingNeeded ? input.parkingDetails : null,
      updatedByName: req.user!.name,
    };
    const plan = await prisma.$transaction(async (tx) => {
      const saved = await tx.eventPlan.upsert({ where: { eventId: event.id }, update: data, create: { eventId: event.id, ...data } });
      await audit(tx, req, event, "logística", "atualizada", { buffet: data.buffetNeeded, parking: data.parkingNeeded });
      return saved;
    });
    res.json({ plan });
  }),
);

// ---------------------------------------------------------------------------
// Programação e cronograma
// ---------------------------------------------------------------------------

const scheduleSchema = z
  .object({
    date: dateKey,
    start: clockTime,
    end: clockTime,
    title: z.string().trim().min(2, "Diga o que acontece.").max(200),
    location: text(200),
    speaker: text(200),
    notes: text(1000),
  })
  .refine((s) => s.end > s.start, { message: "O fim vem depois do início.", path: ["end"] });

function scheduleData(event: LoadedEvent, input: z.infer<typeof scheduleSchema>) {
  if (!dayKeys(event).includes(input.date)) throw new AppError(400, "VALIDATION_ERROR", "Escolha um dos dias do evento.");
  return {
    startsAt: zonedTime(input.date, input.start),
    endsAt: zonedTime(input.date, input.end),
    title: input.title,
    location: input.location,
    speaker: input.speaker,
    notes: input.notes,
  };
}

eventOrganizationRouter.post(
  "/:id/organization/schedule",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = scheduleSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.eventScheduleItem.create({ data: { eventId: event.id, ...scheduleData(event, input) } });
      await audit(tx, req, event, "programação", "item incluído", { title: created.title, date: input.date, start: input.start });
      return created;
    });
    res.status(201).json({ item });
  }),
);

eventOrganizationRouter.patch(
  "/:id/organization/schedule/:itemId",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = scheduleSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    const item = await prisma.$transaction(async (tx) => {
      const found = await tx.eventScheduleItem.findFirst({ where: { id: req.params.itemId, eventId: event.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Item da programação não encontrado.");
      const updated = await tx.eventScheduleItem.update({ where: { id: found.id }, data: scheduleData(event, input) });
      await audit(tx, req, event, "programação", "item alterado", { title: updated.title, date: input.date, start: input.start });
      return updated;
    });
    res.json({ item });
  }),
);

eventOrganizationRouter.delete(
  "/:id/organization/schedule/:itemId",
  requireNucev,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    await prisma.$transaction(async (tx) => {
      const found = await tx.eventScheduleItem.findFirst({ where: { id: req.params.itemId, eventId: event.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Item da programação não encontrado.");
      await tx.eventScheduleItem.delete({ where: { id: found.id } });
      await audit(tx, req, event, "programação", "item retirado", { title: found.title });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Pessoas: organização, palestrantes externos e participantes
// ---------------------------------------------------------------------------

const PEOPLE_SECTION: Record<EventPersonKind, string> = {
  ORGANIZER: "responsáveis pela organização",
  SPEAKER: "palestrantes",
  PARTICIPANT: "participantes",
};
const MAX_PEOPLE = 3000;

const personSchema = z.object({
  kind: z.nativeEnum(EventPersonKind),
  name: z.string().trim().min(2, "Escreva o nome.").max(200),
  affiliation: text(200),
  contact: text(200),
  notes: text(1000),
});

eventOrganizationRouter.post(
  "/:id/organization/people",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = personSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertPeopleEditable(req, event, input.kind);
    const person = await prisma.$transaction(async (tx) => {
      if ((await tx.eventPerson.count({ where: { eventId: event.id } })) >= MAX_PEOPLE) {
        throw new AppError(400, "VALIDATION_ERROR", `A lista pode ter até ${MAX_PEOPLE} pessoas.`);
      }
      const created = await tx.eventPerson.create({ data: { eventId: event.id, ...input, addedByName: req.user!.name } });
      await audit(tx, req, event, PEOPLE_SECTION[input.kind], "pessoa incluída", { name: created.name });
      return created;
    });
    res.status(201).json({ person });
  }),
);

/**
 * Lista colada (de uma planilha ou de um e-mail): uma pessoa por linha, com
 * nome; contato; instituição (separados por ponto e vírgula ou tabulação).
 * Nomes que já estão na lista ficam de fora.
 */
eventOrganizationRouter.post(
  "/:id/organization/people/import",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { kind, text: pasted } = z.object({ kind: z.nativeEnum(EventPersonKind), text: z.string().max(400_000) }).parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertPeopleEditable(req, event, kind);
    const rows = pasted
      .split(/\r?\n/)
      .map((line) => line.split(/\t|;/).map((cell) => cell.trim()))
      .filter((cells) => (cells[0]?.length ?? 0) >= 2)
      .map(([name, contact, affiliation]) => ({ name: name!.slice(0, 200), contact: contact?.slice(0, 200) || null, affiliation: affiliation?.slice(0, 200) || null }));
    if (rows.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Cole ao menos um nome (um por linha).");

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.eventPerson.findMany({ where: { eventId: event.id, kind }, select: { name: true } });
      const seen = new Set(existing.map((p) => p.name.toLocaleLowerCase("pt-BR")));
      const fresh = rows.filter((r) => {
        const key = r.name.toLocaleLowerCase("pt-BR");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const total = await tx.eventPerson.count({ where: { eventId: event.id } });
      if (total + fresh.length > MAX_PEOPLE) throw new AppError(400, "VALIDATION_ERROR", `A lista pode ter até ${MAX_PEOPLE} pessoas.`);
      if (fresh.length > 0) await tx.eventPerson.createMany({ data: fresh.map((r) => ({ eventId: event.id, kind, ...r, addedByName: req.user!.name })) });
      await audit(tx, req, event, PEOPLE_SECTION[kind], "lista importada", { added: fresh.length, skipped: rows.length - fresh.length });
      return { added: fresh.length, skipped: rows.length - fresh.length };
    });
    res.status(201).json(result);
  }),
);

eventOrganizationRouter.patch(
  "/:id/organization/people/:personId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = personSchema.omit({ kind: true }).parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertGuestAccess(req, event);
    const person = await prisma.$transaction(async (tx) => {
      const found = await tx.eventPerson.findFirst({ where: { id: req.params.personId, eventId: event.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Pessoa não encontrada.");
      assertPeopleEditable(req, event, found.kind);
      const updated = await tx.eventPerson.update({ where: { id: found.id }, data: input });
      await audit(tx, req, event, PEOPLE_SECTION[found.kind], "pessoa alterada", { name: updated.name });
      return updated;
    });
    res.json({ person });
  }),
);

eventOrganizationRouter.delete(
  "/:id/organization/people/:personId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    assertGuestAccess(req, event);
    await prisma.$transaction(async (tx) => {
      const found = await tx.eventPerson.findFirst({ where: { id: req.params.personId, eventId: event.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Pessoa não encontrada.");
      assertPeopleEditable(req, event, found.kind);
      await tx.eventPerson.delete({ where: { id: found.id } });
      await audit(tx, req, event, PEOPLE_SECTION[found.kind], "pessoa retirada", { name: found.name });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Veículos (liberação de vagas): o solicitante informa; a equipe também
// ---------------------------------------------------------------------------

/** "abc-1d23" → "ABC1D23"; placa antiga (ABC1234) ou Mercosul (ABC1D23). */
const plateSchema = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  .refine((v) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v), "Placa inválida: use ABC-1234 ou ABC1D23.");

const vehicleSchema = z.object({ plate: plateSchema, model: text(120), driver: text(200), notes: text(1000) });
const MAX_VEHICLES = 300;

const isDuplicate = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

eventOrganizationRouter.post(
  "/:id/vehicles",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = vehicleSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertGuestAccess(req, event);
    assertGuestsEditable(event);
    try {
      const vehicle = await prisma.$transaction(async (tx) => {
        if ((await tx.eventVehicle.count({ where: { eventId: event.id } })) >= MAX_VEHICLES) {
          throw new AppError(400, "VALIDATION_ERROR", `A lista pode ter até ${MAX_VEHICLES} veículos.`);
        }
        const created = await tx.eventVehicle.create({ data: { eventId: event.id, ...input, addedByName: req.user!.name } });
        await audit(tx, req, event, "veículos", "veículo incluído", { name: created.plate });
        return created;
      });
      res.status(201).json({ vehicle });
    } catch (error) {
      if (isDuplicate(error)) throw new AppError(409, "DUPLICATE_PLATE", "Esta placa já está na lista.");
      throw error;
    }
  }),
);

eventOrganizationRouter.patch(
  "/:id/vehicles/:vehicleId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = vehicleSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertGuestAccess(req, event);
    assertGuestsEditable(event);
    try {
      const vehicle = await prisma.$transaction(async (tx) => {
        const found = await tx.eventVehicle.findFirst({ where: { id: req.params.vehicleId, eventId: event.id } });
        if (!found) throw new AppError(404, "NOT_FOUND", "Veículo não encontrado.");
        const updated = await tx.eventVehicle.update({ where: { id: found.id }, data: input });
        await audit(tx, req, event, "veículos", "veículo alterado", { name: updated.plate });
        return updated;
      });
      res.json({ vehicle });
    } catch (error) {
      if (isDuplicate(error)) throw new AppError(409, "DUPLICATE_PLATE", "Esta placa já está na lista.");
      throw error;
    }
  }),
);

eventOrganizationRouter.delete(
  "/:id/vehicles/:vehicleId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    assertGuestAccess(req, event);
    assertGuestsEditable(event);
    await prisma.$transaction(async (tx) => {
      const found = await tx.eventVehicle.findFirst({ where: { id: req.params.vehicleId, eventId: event.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Veículo não encontrado.");
      await tx.eventVehicle.delete({ where: { id: found.id } });
      await audit(tx, req, event, "veículos", "veículo retirado", { name: found.plate });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Pendências da organização
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  title: z.string().trim().min(2, "Diga o que precisa ser feito.").max(200),
  details: text(2000),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: dateKey.nullable().optional(),
});

async function assignee(tx: Prisma.TransactionClient, id: string | null | undefined) {
  if (!id) return { assigneeId: null, assigneeName: null };
  const user = await tx.user.findFirst({ where: { id, role: { in: ["ADMIN", "NUCEV"] } }, select: { id: true, name: true } });
  if (!user) throw new AppError(400, "VALIDATION_ERROR", "Escolha alguém da equipe do SAD ou do NUCEV.");
  return { assigneeId: user.id, assigneeName: user.name };
}

eventOrganizationRouter.post(
  "/:id/organization/tasks",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = taskSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.operationalTask.create({
        data: {
          eventId: event.id,
          title: input.title,
          details: input.details,
          ...(await assignee(tx, input.assigneeId)),
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
          createdById: req.user!.id,
          createdByName: req.user!.name,
        },
      });
      await audit(tx, req, event, "pendências", "pendência criada", { title: created.title, assignee: created.assigneeName });
      return created;
    });
    res.status(201).json({ task });
  }),
);

eventOrganizationRouter.patch(
  "/:id/organization/tasks/:taskId",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = taskSchema.partial().extend({ done: z.boolean().optional() }).parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    const task = await prisma.$transaction(async (tx) => {
      const found = await tx.operationalTask.findFirst({ where: { id: req.params.taskId, eventId: event.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Pendência não encontrada.");
      const data: Prisma.OperationalTaskUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.details !== undefined) data.details = input.details;
      if (input.assigneeId !== undefined) Object.assign(data, await assignee(tx, input.assigneeId));
      if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null;
      if (input.done !== undefined) {
        data.status = input.done ? "DONE" : "OPEN";
        data.doneAt = input.done ? new Date() : null;
        data.doneByName = input.done ? req.user!.name : null;
      }
      const updated = await tx.operationalTask.update({ where: { id: found.id }, data });
      const change = input.done === true ? "pendência concluída" : input.done === false ? "pendência reaberta" : "pendência alterada";
      await audit(tx, req, event, "pendências", change, { title: updated.title });
      return updated;
    });
    res.json({ task });
  }),
);

eventOrganizationRouter.delete(
  "/:id/organization/tasks/:taskId",
  requireNucev,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    await prisma.$transaction(async (tx) => {
      const found = await tx.operationalTask.findFirst({ where: { id: req.params.taskId, eventId: event.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Pendência não encontrada.");
      await tx.operationalTask.delete({ where: { id: found.id } });
      await audit(tx, req, event, "pendências", "pendência retirada", { title: found.title });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Encerramento (etapa 10): depois do último dia, "Finalizado" com o balanço
// ---------------------------------------------------------------------------

eventOrganizationRouter.post(
  "/:id/close",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = z
      .object({ notes: text(4000), actualAttendees: z.number().int().min(0).max(100_000).nullable().optional() })
      .parse(req.body ?? {});
    const event = await loadEvent(req.params.id!);
    assertEditable(event);
    if (dayKeys(event).at(-1)! > zonedDateKey(new Date())) {
      throw new AppError(409, "EVENT_NOT_OVER", "O evento só pode ser encerrado a partir do último dia.");
    }
    const openTasks = await prisma.operationalTask.count({ where: { eventId: event.id, status: "OPEN" } });
    await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: event.id },
        data: { closedAt: new Date(), closedByName: req.user!.name, closingNotes: input.notes, actualAttendees: input.actualAttendees ?? null },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.close",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        details: { actualAttendees: input.actualAttendees ?? null, openTasks, ...(input.notes ? { notes: input.notes } : {}) },
      });
    });
    res.json({ ok: true, openTasks });
  }),
);
