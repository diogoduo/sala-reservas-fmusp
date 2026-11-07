import { randomBytes } from "node:crypto";
import { type EventStatus, Prisma } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { env } from "../config/env";
import { deliverNotices, queueNotice, sadEmails, staffEmails } from "../events/notices";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedClock, zonedDateKey, zonedTime } from "../lib/timezone";
import { isStaff, requireAdmin, requireAuth, requireStaff } from "../middleware/auth";
import { estimateQuote } from "../quotes/estimate";
import { findConflictingOccurrences, isOverlapViolation, loadBusyIntervals, lockRoomForUpdate, overlaps } from "../reservations/conflicts";
import { regularScheduleIssue } from "../reservations/rules";

// Fase 12 — gestão do evento. Divisão combinada com o SAD e o NUCEV:
//  - NUCEV: análise, orçamento (com versões), autorização da Diretoria, recusa
//    e a conversa com o solicitante (o SAD também pode, como administrador);
//  - SAD: escolhe as salas e faz a pré-reserva (com a validade que ele define),
//    libera e cancela;
//  - solicitante: aprova, recusa ou pede alteração do orçamento e conversa.
// A pré-reserva são reservas aprovadas ligadas ao evento, com validade: bloqueiam
// a sala pela regra de conflito do banco e vencem sozinhas (events/expiry.ts).
export const eventWorkflowRouter = Router();

function requireNucev(req: Request, _res: Response, next: NextFunction): void {
  const role = req.user?.role;
  if (role === "NUCEV" || role === "ADMIN") return next();
  next(new AppError(403, "FORBIDDEN", role ? "Só o NUCEV (ou o SAD) pode fazer isso." : "Faça login para continuar."));
}

const workflowInclude = {
  user: { select: { id: true, name: true, email: true } },
  days: { orderBy: { date: "asc" } },
  spaces: { orderBy: { position: "asc" }, include: { room: true, priceCategory: true } },
} satisfies Prisma.EventInclude;
type WorkflowEvent = Prisma.EventGetPayload<{ include: typeof workflowInclude }>;

const ACTIVE_RESERVATION = { status: { in: ["PENDING", "APPROVED"] } } satisfies Prisma.ReservationWhereInput;
const CLOSED: EventStatus[] = ["CANCELLED", "REJECTED", "EXPIRED"];
const label = (e: { protocol: string; title: string }) => `${e.protocol} — ${e.title}`;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const brDate = (key: string) => key.split("-").reverse().join("/");

async function loadEvent(id: string): Promise<WorkflowEvent> {
  const event = await prisma.event.findUnique({ where: { id }, include: workflowInclude });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  return event;
}

function assertStatus(event: { status: EventStatus }, allowed: EventStatus[], message: string) {
  if (!allowed.includes(event.status)) throw new AppError(409, "EVENT_WRONG_STATUS", message);
}

/** Uso do espaço em cada dia: da montagem ao fim da desmontagem. */
function usageWindows(event: WorkflowEvent, dates: Date[] = []) {
  const keys = dates.map(dayKey);
  return event.days
    .filter((d) => keys.length === 0 || keys.includes(dayKey(d.date)))
    .map((d) => ({
      date: dayKey(d.date),
      day: d,
      start: new Date(d.startTime.getTime() - d.setupMinutes * 60_000),
      end: new Date(d.endTime.getTime() + d.teardownMinutes * 60_000),
    }));
}

const asQuoteDay = (w: { start: Date; end: Date }) => ({ date: zonedDateKey(w.start), start: zonedClock(w.start), end: zonedClock(w.end) });

async function releaseReservations(tx: Prisma.TransactionClient, eventId: string, actorId: string | null, reason: string) {
  return tx.reservation.updateMany({
    where: { eventId, ...ACTIVE_RESERVATION },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actorId, cancellationReason: reason },
  });
}

const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

/** Fase 13: orientações de pagamento que o SAD e o NUCEV editam (app_settings). */
export const PAYMENT_INSTRUCTIONS_KEY = "event_payment_instructions";
export async function paymentInstructions(db: Prisma.TransactionClient | typeof prisma): Promise<string> {
  const row = await db.appSetting.findUnique({ where: { key: PAYMENT_INSTRUCTIONS_KEY } });
  return row?.value ?? "Dados para o pagamento: a definir pelo SAD e pelo NUCEV. Depois de pagar, envie o comprovante nesta página.";
}

const requesterPath = (id: string) => `/eventos/${id}`;
const staffPath = (id: string) => `/admin/eventos/${id}`;

// ---------------------------------------------------------------------------
// Análise (NUCEV)
// ---------------------------------------------------------------------------

eventWorkflowRouter.post(
  "/:id/review",
  requireNucev,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    assertStatus(event, ["SUBMITTED", "CHANGES_REQUESTED"], "A análise já começou.");
    await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: event.id },
        data: { status: "IN_REVIEW", assigneeId: event.assigneeId ?? req.user!.id, assigneeName: event.assigneeName ?? req.user!.name },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.review",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: { status: { from: event.status, to: "IN_REVIEW" } },
      });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Salas e pré-reserva (SAD)
// ---------------------------------------------------------------------------

/** Para cada pedido de espaço: as salas que servem, com os dias em que estão ocupadas. */
eventWorkflowRouter.get(
  "/:id/candidates",
  requireStaff,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    const own = await prisma.reservation.findMany({ where: { eventId: event.id, ...ACTIVE_RESERVATION }, select: { id: true, roomId: true, startTime: true } });
    const ownIds = own.map((r) => r.id);
    const spaces = [];
    for (const space of event.spaces) {
      const windows = usageWindows(event, space.dates);
      const rooms = space.roomId
        ? space.room
          ? [space.room]
          : []
        : await prisma.room.findMany({
            where: {
              status: "ACTIVE",
              priceCategoryId: space.priceCategoryId ?? "00000000-0000-0000-0000-000000000000",
              ...(space.minCapacity ? { OR: [{ capacity: null }, { capacity: { gte: space.minCapacity } }] } : {}),
            },
            orderBy: [{ capacity: "asc" }, { name: "asc" }],
          });
      const busy = await loadBusyIntervals(prisma, rooms.map((r) => r.id), windows, ownIds);
      spaces.push({
        spaceId: space.id,
        needed: space.roomId ? 1 : space.count,
        dates: windows.map((w) => w.date),
        rooms: rooms.map((room) => ({
          id: room.id,
          name: room.name,
          building: room.building,
          floor: room.floor,
          capacity: room.capacity,
          requiresBoardApproval: room.requiresBoardApproval,
          busyDates: windows.filter((w) => busy.some((b) => b.roomId === room.id && overlaps(w, b))).map((w) => w.date),
          selected: own.some((r) => r.roomId === room.id && windows.some((w) => zonedDateKey(r.startTime) === w.date)),
        })),
      });
    }
    res.json({ spaces });
  }),
);

const preReserveSchema = z.object({
  /** Último dia da pré-reserva ("AAAA-MM-DD"): vale até 23:59 desse dia. */
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a validade da pré-reserva."),
  allocations: z
    .array(z.object({ spaceId: z.string().uuid(), roomIds: z.array(z.string().uuid()).max(200) }))
    .min(1)
    .max(50),
});

eventWorkflowRouter.post(
  "/:id/pre-reserve",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = preReserveSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertStatus(
      event,
      ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "PRE_RESERVED", "QUOTE_SENT", "QUOTE_APPROVED"],
      "Não dá para pré-reservar um evento nesta situação.",
    );
    if (input.validUntil < zonedDateKey(new Date())) throw new AppError(400, "VALIDATION_ERROR", "A validade não pode ser no passado.");
    const allocations = input.allocations.filter((a) => a.roomIds.length > 0);
    if (allocations.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Escolha ao menos uma sala.");

    const rooms = await prisma.room.findMany({ where: { id: { in: allocations.flatMap((a) => a.roomIds) } } });
    const validUntil = zonedTime(input.validUntil, "23:59");

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Refazer a pré-reserva: as reservas antigas do evento saem antes das novas.
        await releaseReservations(tx, event.id, req.user!.id, "Pré-reserva refeita pelo SAD.");
        const createdRooms: string[] = [];
        let count = 0;
        for (const allocation of allocations) {
          const space = event.spaces.find((s) => s.id === allocation.spaceId);
          if (!space) throw new AppError(400, "VALIDATION_ERROR", "Pedido de espaço não encontrado neste evento.");
          const windows = usageWindows(event, space.dates);
          for (const roomId of [...new Set(allocation.roomIds)]) {
            const room = rooms.find((r) => r.id === roomId);
            if (!room || room.status !== "ACTIVE") throw new AppError(400, "ROOM_NOT_FOUND", "Sala não encontrada ou fora de uso.");
            if (windows.some((w) => w.end.getTime() - w.start.getTime() > 15 * 3_600_000)) {
              throw new AppError(400, "VALIDATION_ERROR", "Uma reserva pode ter no máximo 15 horas por dia, com a montagem e a desmontagem.");
            }
            await lockRoomForUpdate(tx, roomId);
            const conflicts = await findConflictingOccurrences(tx, roomId, windows);
            if (conflicts.length > 0) {
              throw new AppError(409, "ROOM_CONFLICT", `${room.name} está ocupada em ${conflicts.map((c) => brDate(c.date)).join(", ")}.`);
            }
            for (const w of windows) {
              await tx.reservation.create({
                data: {
                  protocol: event.protocol,
                  userId: event.userId,
                  roomId,
                  eventId: event.id,
                  preReservedUntil: validUntil,
                  title: event.title,
                  description: `Evento ${event.protocol}${space.purpose ? ` — ${space.purpose}` : ""} (pré-reserva do SAD).`,
                  activityType: "CULTURE_EXTENSION",
                  expectedAttendees: Math.max(1, Math.min(room.capacity ?? event.expectedAttendees, space.minCapacity ?? event.expectedAttendees)),
                  termsAccepted: true,
                  noAlcoholCommitment: true,
                  coffeeBreak: space.coffeeInRoom,
                  setupMinutes: Math.min(w.day.setupMinutes, 240),
                  startTime: w.start,
                  endTime: w.end,
                  outsideRegularHours: regularScheduleIssue(w.start, w.end) !== null,
                  status: "APPROVED",
                  reviewedById: req.user!.id,
                  reviewedAt: new Date(),
                },
              });
              count++;
            }
            createdRooms.push(room.name);
          }
        }
        await tx.event.update({ where: { id: event.id }, data: { status: "PRE_RESERVED", preReservedUntil: validUntil } });
        await recordAudit(tx, {
          actor: req.user!,
          action: "event.pre_reserve",
          entityType: "event",
          entityId: event.protocol,
          label: label(event),
          changes: event.status === "PRE_RESERVED" ? undefined : { status: { from: event.status, to: "PRE_RESERVED" } },
          details: { validUntil: input.validUntil, rooms: createdRooms, reservations: count },
        });
        const notice = await queueNotice(tx, {
          eventId: event.id,
          to: [event.user.email],
          subject: `Espaços pré-reservados: ${event.title}`,
          heading: "Espaços pré-reservados",
          paragraphs: [
            `O SAD pré-reservou os espaços do evento ${event.protocol}. A pré-reserva vale até ${brDate(input.validUntil)}.`,
            "O NUCEV vai enviar o orçamento. A reserva só fica confirmada depois do pagamento validado.",
          ],
          details: [["Espaços", createdRooms.join(", ")]],
          path: requesterPath(event.id),
        });
        return { count, noticeId: notice.id };
      });
      deliverNotices([created.noticeId]);
      res.json({ reservations: created.count });
    } catch (error) {
      if (isOverlapViolation(error)) throw new AppError(409, "ROOM_CONFLICT", "Uma das salas ficou ocupada no mesmo horário (ou foi escolhida duas vezes). Revise a escolha.");
      throw error;
    }
  }),
);

const reasonSchema = z.object({ reason: z.string().trim().min(1, "Informe o motivo.").max(1000) });

/** Libera as salas pré-reservadas; o evento volta para a análise. */
eventWorkflowRouter.post(
  "/:id/release",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { reason } = reasonSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    assertStatus(event, ["PRE_RESERVED", "QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED"], "Não há pré-reserva para liberar.");
    await prisma.$transaction(async (tx) => {
      const released = await releaseReservations(tx, event.id, req.user!.id, `Pré-reserva liberada pelo SAD: ${reason}`);
      await tx.event.update({ where: { id: event.id }, data: { status: "IN_REVIEW", preReservedUntil: null } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.release",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: { status: { from: event.status, to: "IN_REVIEW" } },
        details: { reason, reservations: released.count },
      });
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Orçamento (NUCEV) e a resposta do solicitante
// ---------------------------------------------------------------------------

/** O orçamento das salas pré-reservadas; sem pré-reserva, o do que foi pedido. */
async function quoteFor(event: WorkflowEvent, exemptionReason?: string) {
  const reservations = await prisma.reservation.findMany({ where: { eventId: event.id, ...ACTIVE_RESERVATION }, orderBy: { startTime: "asc" } });
  const allDays = usageWindows(event).map(asQuoteDay);
  if (reservations.length > 0) {
    const byRoom = new Map<string, typeof reservations>();
    for (const r of reservations) byRoom.set(r.roomId!, [...(byRoom.get(r.roomId!) ?? []), r]);
    return estimateQuote(prisma, {
      days: allDays,
      items: [...byRoom.entries()].map(([roomId, list]) => ({
        roomId,
        count: 1,
        coffeeInRoom: list.some((r) => r.coffeeBreak),
        days: list.map((r) => asQuoteDay({ start: r.startTime, end: r.endTime })),
      })),
      institutional: event.institutional,
      exemptionReason,
    });
  }
  return estimateQuote(prisma, {
    days: allDays,
    items: event.spaces.map((s) => ({
      categoryId: s.roomId ? undefined : (s.priceCategoryId ?? undefined),
      roomId: s.roomId ?? undefined,
      count: s.roomId ? 1 : s.count,
      coffeeInRoom: s.coffeeInRoom,
      days: usageWindows(event, s.dates).map(asQuoteDay),
    })).filter((i) => i.categoryId || i.roomId),
    institutional: event.institutional,
    exemptionReason,
  });
}

const quoteSchema = z.object({
  exemptionReason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const QUOTABLE: EventStatus[] = ["IN_REVIEW", "PRE_RESERVED", "CHANGES_REQUESTED", "QUOTE_SENT"];

eventWorkflowRouter.post(
  "/:id/quotes/preview",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = quoteSchema.parse(req.body ?? {});
    const event = await loadEvent(req.params.id!);
    res.json(await quoteFor(event, input.exemptionReason || undefined));
  }),
);

eventWorkflowRouter.post(
  "/:id/quotes",
  requireNucev,
  asyncHandler(async (req, res) => {
    const input = quoteSchema.parse(req.body ?? {});
    const event = await loadEvent(req.params.id!);
    assertStatus(event, QUOTABLE, "Não dá para enviar orçamento nesta situação.");
    const estimate = await quoteFor(event, input.exemptionReason || undefined);
    const quote = await prisma.$transaction(async (tx) => {
      const last = await tx.eventQuote.aggregate({ where: { eventId: event.id }, _max: { version: true } });
      await tx.eventQuote.updateMany({ where: { eventId: event.id, status: { in: ["SENT", "CHANGES_REQUESTED"] } }, data: { status: "SUPERSEDED" } });
      const created = await tx.eventQuote.create({
        data: {
          eventId: event.id,
          version: (last._max.version ?? 0) + 1,
          estimate: estimate as unknown as Prisma.InputJsonValue,
          totalCents: estimate.quote.totalCents,
          exemptionReason: input.exemptionReason || null,
          notes: input.notes || null,
          createdById: req.user!.id,
          createdByName: req.user!.name,
        },
      });
      await tx.event.update({
        where: { id: event.id },
        data: { status: "QUOTE_SENT", assigneeId: event.assigneeId ?? req.user!.id, assigneeName: event.assigneeName ?? req.user!.name },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.quote_send",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: event.status === "QUOTE_SENT" ? undefined : { status: { from: event.status, to: "QUOTE_SENT" } },
        details: { version: created.version, totalCents: created.totalCents, exempt: Boolean(created.exemptionReason) },
      });
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: [event.user.email],
        subject: `Orçamento disponível: ${event.title}`,
        heading: "Orçamento disponível",
        paragraphs: [
          `O NUCEV enviou o orçamento (versão ${created.version}) do evento ${event.protocol}.`,
          "Abra o evento para aprovar, recusar ou pedir alteração.",
        ],
        details: [["Total", new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(created.totalCents / 100)]],
        path: requesterPath(event.id),
      });
      return { created, noticeId: notice.id };
    });
    deliverNotices([quote.noticeId]);
    res.status(201).json({ quote: quote.created });
  }),
);

const decisionSchema = z
  .object({ decision: z.enum(["APPROVE", "CHANGES", "REJECT"]), note: z.string().trim().max(2000).optional() })
  .refine((d) => d.decision !== "CHANGES" || Boolean(d.note), { message: "Diga o que precisa mudar.", path: ["note"] });

eventWorkflowRouter.post(
  "/:id/quotes/:quoteId/decision",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { decision, note } = decisionSchema.parse(req.body);
    const event = await loadEvent(req.params.id!);
    if (event.userId !== req.user!.id) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
    assertStatus(event, ["QUOTE_SENT"], "Não há orçamento aguardando a sua resposta.");
    const quote = await prisma.eventQuote.findFirst({ where: { id: req.params.quoteId, eventId: event.id } });
    if (!quote || quote.status !== "SENT") throw new AppError(409, "QUOTE_NOT_OPEN", "Este orçamento não está mais aguardando resposta.");

    const next = { APPROVE: ["APPROVED", "QUOTE_APPROVED"], CHANGES: ["CHANGES_REQUESTED", "CHANGES_REQUESTED"], REJECT: ["REJECTED", "CANCELLED"] } as const;
    const [quoteStatus] = next[decision];
    // Fase 13: orçamento isento (total zero) não tem pagamento: vai direto para a confirmação do SAD.
    const exempt = decision === "APPROVE" && quote.totalCents === 0;
    const eventStatus: EventStatus = exempt ? "PAYMENT_VALIDATED" : next[decision][1];
    const ids = await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.eventQuote.update({
        where: { id: quote.id },
        data: { status: quoteStatus, decidedAt: now, decidedByName: req.user!.name, decisionNote: note || null },
      });
      if (decision === "REJECT") await releaseReservations(tx, event.id, req.user!.id, "Orçamento recusado pelo solicitante.");
      const instructions = decision === "APPROVE" ? await paymentInstructions(tx) : null;
      await tx.event.update({
        where: { id: event.id },
        data: {
          status: eventStatus,
          ...(decision === "REJECT" && { cancelledAt: now, cancellationReason: `Orçamento recusado${note ? `: ${note}` : "."}`, preReservedUntil: null }),
          ...(decision === "APPROVE" && {
            paymentExpectedCents: quote.totalCents,
            paymentInstructions: exempt ? null : instructions,
            paymentRequestedAt: exempt ? null : now,
            ...(exempt && { paymentValidatedAt: now, paymentValidatedByName: "Isento (sem pagamento)" }),
          }),
        },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.quote_decision",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: { status: { from: event.status, to: eventStatus } },
        details: { version: quote.version, decision, ...(note && { note }) },
      });
      const text = { APPROVE: "aprovou", CHANGES: "pediu alteração no", REJECT: "recusou" }[decision];
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: await staffEmails(tx, { withSad: decision !== "APPROVE" }),
        subject: `Orçamento ${decision === "APPROVE" ? "aprovado" : decision === "CHANGES" ? "com pedido de alteração" : "recusado"}: ${event.title}`,
        heading: "Resposta ao orçamento",
        paragraphs: [
          `${event.user.name} ${text} orçamento (versão ${quote.version}) do evento ${event.protocol}.`,
          ...(note ? [`Comentário: ${note}`] : []),
          ...(exempt ? ["O orçamento é isento: falta só o SAD confirmar a reserva."] : []),
        ],
        path: staffPath(event.id),
      });
      const ids = [notice.id];
      if (decision === "APPROVE") {
        // Orientações de pagamento (ou o aviso de isenção) para quem pediu.
        const payment = await queueNotice(tx, {
          eventId: event.id,
          to: [event.user.email],
          subject: exempt ? `Orçamento aprovado (isento): ${event.title}` : `Orientações de pagamento: ${event.title}`,
          heading: exempt ? "Orçamento aprovado" : "Orientações de pagamento",
          paragraphs: exempt
            ? [`O orçamento do evento ${event.protocol} é isento. O SAD vai confirmar a reserva.`]
            : [`Valor do evento ${event.protocol}: ${brl(quote.totalCents)}.`, instructions ?? "", "Depois de pagar, envie o comprovante na página do evento."],
          details: event.preReservedUntil ? [["Prazo da pré-reserva", event.preReservedUntil.toLocaleDateString("pt-BR", { timeZone: env.APP_TIMEZONE })]] : undefined,
          path: requesterPath(event.id),
        });
        ids.push(payment.id);
      }
      return ids;
    });
    deliverNotices(ids);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Recusar (NUCEV) e cancelar (SAD)
// ---------------------------------------------------------------------------

async function closeEvent(req: Request, status: "REJECTED" | "CANCELLED", action: "event.reject" | "event.staff_cancel", allowed: EventStatus[]) {
  const { reason } = reasonSchema.parse(req.body);
  const event = await loadEvent(req.params.id!);
  assertStatus(event, allowed, "Não dá para fazer isso nesta situação.");
  const noticeId = await prisma.$transaction(async (tx) => {
    const released = await releaseReservations(tx, event.id, req.user!.id, `${status === "REJECTED" ? "Evento recusado" : "Evento cancelado"}: ${reason}`);
    await tx.event.update({
      where: { id: event.id },
      data: {
        status,
        preReservedUntil: null,
        ...(status === "REJECTED" ? { rejectionReason: reason } : { cancelledAt: new Date(), cancellationReason: reason }),
      },
    });
    await recordAudit(tx, {
      actor: req.user!,
      action,
      entityType: "event",
      entityId: event.protocol,
      label: label(event),
      changes: { status: { from: event.status, to: status } },
      details: { reason, reservations: released.count },
    });
    const notice = await queueNotice(tx, {
      eventId: event.id,
      to: [event.user.email],
      subject: `${status === "REJECTED" ? "Pedido recusado" : "Evento cancelado"}: ${event.title}`,
      heading: status === "REJECTED" ? "Pedido de evento recusado" : "Evento cancelado",
      paragraphs: [`O evento ${event.protocol} foi ${status === "REJECTED" ? "recusado" : "cancelado"}.`, `Motivo: ${reason}`],
      path: requesterPath(event.id),
    });
    return notice.id;
  });
  deliverNotices([noticeId]);
}

eventWorkflowRouter.post(
  "/:id/reject",
  requireNucev,
  asyncHandler(async (req, res) => {
    await closeEvent(req, "REJECTED", "event.reject", ["SUBMITTED", "IN_REVIEW", "PRE_RESERVED", "QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED"]);
    res.json({ ok: true });
  }),
);

eventWorkflowRouter.post(
  "/:id/staff-cancel",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await closeEvent(req, "CANCELLED", "event.staff_cancel", [
      "SUBMITTED",
      "IN_REVIEW",
      "PRE_RESERVED",
      "QUOTE_SENT",
      "CHANGES_REQUESTED",
      "QUOTE_APPROVED",
      "PAYMENT_SUBMITTED",
      "PAYMENT_VALIDATED",
      "CONFIRMED",
    ]);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Conversa
// ---------------------------------------------------------------------------

eventWorkflowRouter.post(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1, "Escreva a mensagem.").max(4000) }).parse(req.body);
    const event = await loadEvent(req.params.id!);
    const staff = isStaff(req.user!.role);
    if (!staff && event.userId !== req.user!.id) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
    const result = await prisma.$transaction(async (tx) => {
      const message = await tx.eventMessage.create({
        data: { eventId: event.id, authorId: req.user!.id, authorName: req.user!.name, authorRole: req.user!.role, body },
      });
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: staff ? [event.user.email] : [...(await staffEmails(tx)), ...(event.assigneeId ? [] : await sadEmails(tx))],
        subject: `Nova mensagem: ${event.title}`,
        heading: "Nova mensagem no evento",
        paragraphs: [`${req.user!.name} escreveu no evento ${event.protocol}:`, body],
        path: staff ? requesterPath(event.id) : staffPath(event.id),
      });
      return { message, noticeId: notice.id };
    });
    deliverNotices([result.noticeId]);
    res.status(201).json({ message: result.message });
  }),
);

// ---------------------------------------------------------------------------
// Autorização da Diretoria Executiva (átrios)
// ---------------------------------------------------------------------------

eventWorkflowRouter.post(
  "/:id/authorization",
  requireNucev,
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const event = await loadEvent(req.params.id!);
    if (CLOSED.includes(event.status)) throw new AppError(409, "EVENT_WRONG_STATUS", "O evento está encerrado.");
    const reserved = await prisma.reservation.findMany({ where: { eventId: event.id, ...ACTIVE_RESERVATION }, include: { room: true } });
    const spaces = [...new Set([...event.spaces.map((s) => s.room), ...reserved.map((r) => r.room)].filter((r) => r?.requiresBoardApproval).map((r) => r!.name))];
    if (spaces.length === 0) throw new AppError(400, "NO_AUTHORIZATION_NEEDED", "Nenhum espaço deste evento depende de autorização da Diretoria.");
    if (await prisma.eventAuthorization.findFirst({ where: { eventId: event.id, status: "PENDING" } })) {
      throw new AppError(409, "AUTHORIZATION_PENDING", "Já há um pedido de autorização aguardando a Diretoria.");
    }
    const token = randomBytes(24).toString("base64url");
    const days = usageWindows(event).map((w) => `${brDate(w.date)}, ${zonedClock(w.day.startTime)}–${zonedClock(w.day.endTime)}`);
    const result = await prisma.$transaction(async (tx) => {
      const authorization = await tx.eventAuthorization.create({
        data: { eventId: event.id, token, recipient: env.DIRETORIA_EMAIL_ADDRESS, spaces: spaces.join(", "), note: note || null, requestedByName: req.user!.name },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.authorization_request",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        details: { spaces, recipient: env.DIRETORIA_EMAIL_ADDRESS },
      });
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: [env.DIRETORIA_EMAIL_ADDRESS],
        subject: `Autorização para uso de espaço: ${event.title}`,
        heading: "Pedido de autorização da Diretoria Executiva",
        paragraphs: [
          `O NUCEV pede autorização para o uso de ${spaces.join(", ")} no evento abaixo. Use o link para autorizar ou negar.`,
          ...(note ? [`Observação do NUCEV: ${note}`] : []),
        ],
        details: [
          ["Evento", `${event.protocol} — ${event.title}`],
          ["Datas e horários", days.join("; ")],
          ["Espaço solicitado", spaces.join(", ")],
          ["Participantes", String(event.expectedAttendees)],
          ["Responsável", `${event.responsible} (${event.responsibleContact})`],
          ["Motivo", event.description.slice(0, 500)],
        ],
        path: `/autorizacao/${token}`,
      });
      return { authorization, noticeId: notice.id };
    });
    deliverNotices([result.noticeId]);
    res.status(201).json({ authorization: { ...result.authorization, token: undefined } });
  }),
);

// ---------------------------------------------------------------------------
// O que a tela do evento mostra da gestão
// ---------------------------------------------------------------------------

/** Salas pré-reservadas, orçamentos, conversa, autorizações e e-mails do evento, para quem pode ver. */
export async function eventManagement(eventId: string, viewer: { id: string; role: string; email: string }) {
  const staff = viewer.role === "ADMIN" || viewer.role === "NUCEV";
  const [reservations, quotes, messages, authorizations, notices, receipts] = await Promise.all([
    prisma.reservation.findMany({
      where: { eventId, status: { in: ["PENDING", "APPROVED"] } },
      include: { room: { select: { id: true, name: true, building: true, floor: true, requiresBoardApproval: true } } },
      orderBy: [{ startTime: "asc" }],
    }),
    prisma.eventQuote.findMany({ where: { eventId }, orderBy: { version: "desc" } }),
    prisma.eventMessage.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } }),
    prisma.eventAuthorization.findMany({ where: { eventId }, orderBy: { requestedAt: "desc" } }),
    prisma.eventNotice.findMany({ where: { eventId }, orderBy: { createdAt: "desc" } }),
    // Fase 13: comprovantes, sem o arquivo (que abre por GET …/receipts/:id).
    prisma.eventReceipt.findMany({
      where: { eventId },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, fileName: true, mimeType: true, size: true, uploadedAt: true, uploadedByName: true, status: true, reviewedAt: true, reviewedByName: true, reviewNote: true },
    }),
  ]);
  return {
    reservations: reservations.map((r) => ({
      id: r.id,
      room: r.room,
      date: zonedDateKey(r.startTime),
      start: zonedClock(r.startTime),
      end: zonedClock(r.endTime),
      preReservedUntil: r.preReservedUntil,
    })),
    quotes,
    messages,
    // O token é o segredo do link da Diretoria: só a equipe vê (pelos e-mails).
    authorizations: authorizations.map(({ token: _token, ...a }) => a),
    notices: staff ? notices : notices.filter((n) => n.to.includes(viewer.email)),
    receipts,
  };
}
