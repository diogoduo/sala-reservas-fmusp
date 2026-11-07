import { EventStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { assertCanRequestActivity } from "../auth/permissions";
import { spaceAvailability } from "../events/availability";
import { expireOverduePreReservations } from "../events/expiry";
import { deliverNotices, queueNotice, staffEmails } from "../events/notices";
import { createEventSchema, eventDaySchema, eventSpaceSchema, FMUSP_ENTITIES, INSTITUTIONAL_ENTITIES, usageWindow, type CreateEventInput } from "../events/schema";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedClock, zonedDateKey, zonedTime } from "../lib/timezone";
import { isStaff, requireAuth, requireStaff } from "../middleware/auth";
import { estimateQuote } from "../quotes/estimate";
import { eventManagement } from "./event-workflow";
import { assertNotSuspended } from "../reservations/portaria";
import { assertMinAdvance } from "../reservations/rules";

// Fase 11 — "Solicitar evento". O solicitante descreve o evento, os dias e os
// espaços (por categoria e quantidade ou por nome), com coffee break e
// infraestrutura; o sistema mostra a disponibilidade e o orçamento estimado, e
// o pedido chega ao NUCEV e ao SAD como "Recebido". A análise, a pré-reserva e o
// pagamento entram nas Fases 12 e 13.
//
// Eventos são atividades de Cultura e Extensão (Portaria 2793, Cap. XI): pede
// quem tem essa permissão.
export const eventsRouter = Router();

/** "2026-11-20" → "20/11/2026". */
const brDate = (key: string) => key.split("-").reverse().join("/");

const eventInclude = {
  user: { select: { id: true, name: true, email: true } },
  quotes: { orderBy: { version: "desc" }, take: 1, select: { version: true, totalCents: true, status: true } },
  days: { orderBy: { date: "asc" } },
  spaces: {
    orderBy: { position: "asc" },
    include: {
      priceCategory: { select: { id: true, name: true, unit: true } },
      room: { select: { id: true, name: true, building: true, floor: true, requiresBoardApproval: true } },
    },
  },
} satisfies Prisma.EventInclude;

type EventWithRelations = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function serializeEvent(e: EventWithRelations) {
  return {
    ...e,
    days: e.days.map((d) => ({
      id: d.id,
      date: dateOnly(d.date),
      start: zonedClock(d.startTime),
      end: zonedClock(d.endTime),
      setupMinutes: d.setupMinutes,
      teardownMinutes: d.teardownMinutes,
    })),
    spaces: e.spaces.map((s) => ({ ...s, dates: s.dates.map(dateOnly) })),
  };
}

const eventLabel = (e: { protocol: string; title: string }) => `${e.protocol} — ${e.title}`;

async function nextEventProtocol(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('event_protocol_seq') AS n`;
  return `EV-${String(row!.n).padStart(6, "0")}/${zonedDateKey(new Date()).slice(0, 4)}`;
}

/** Os dias de uso de cada espaço (todos, ou os escolhidos), no horário com montagem e desmontagem. */
function spaceWindows(input: Pick<CreateEventInput, "days">, dates: string[]) {
  return input.days.filter((d) => dates.length === 0 || dates.includes(d.date)).map(usageWindow);
}

/** Orçamento estimado (Fase 10); sem tabela de preços na data, fica sem estimativa. */
async function estimateFor(input: CreateEventInput, institutional: boolean) {
  try {
    return await estimateQuote(prisma, {
      days: input.days.map(usageWindow),
      items: input.spaces.map((s) => ({
        categoryId: s.categoryId,
        roomId: s.roomId,
        count: s.count,
        coffeeInRoom: s.coffeeInRoom,
        days: spaceWindows(input, s.dates),
      })),
      institutional,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "NO_PRICE_TABLE") return null;
    throw error;
  }
}

eventsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createEventSchema.parse(req.body);
    assertCanRequestActivity(req.user!, "CULTURE_EXTENSION");
    await assertNotSuspended(prisma, req.user!.id);
    const firstDay = [...input.days].sort((a, b) => a.date.localeCompare(b.date))[0]!;
    const first = usageWindow(firstDay);
    assertMinAdvance(zonedTime(first.date, first.start));

    const institutional = INSTITUTIONAL_ENTITIES.includes(input.entity);
    const estimate = await estimateFor(input, institutional);

    const { event, noticeIds } = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          protocol: await nextEventProtocol(tx),
          userId: req.user!.id,
          title: input.title,
          kind: input.kind,
          description: input.description,
          targetAudience: input.targetAudience,
          expectedAttendees: input.expectedAttendees,
          entity: input.entity,
          institutional,
          hasRegistrationFee: input.hasRegistrationFee,
          sponsored: input.sponsored,
          responsible: input.responsible,
          responsibleContact: input.responsibleContact,
          department: input.department,
          coffeeBreak: input.coffeeBreak,
          coffeeAttendees: input.coffeeBreak ? (input.coffeeAttendees ?? null) : null,
          infrastructure: input.infrastructure || null,
          notes: input.notes || null,
          estimate: estimate ? (estimate as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          days: {
            create: input.days.map((d) => ({
              date: new Date(`${d.date}T00:00:00Z`),
              startTime: zonedTime(d.date, d.start),
              endTime: zonedTime(d.date, d.end),
              setupMinutes: d.setupMinutes,
              teardownMinutes: d.teardownMinutes,
            })),
          },
          spaces: {
            create: input.spaces.map((s, position) => ({
              position,
              priceCategoryId: s.categoryId ?? null,
              roomId: s.roomId ?? null,
              count: s.roomId ? 1 : s.count,
              minCapacity: s.roomId ? null : (s.minCapacity ?? null),
              purpose: s.purpose || null,
              coffeeInRoom: s.coffeeInRoom,
              dates: s.dates.map((d) => new Date(`${d}T00:00:00Z`)),
            })),
          },
        },
        include: eventInclude,
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.request",
        entityType: "event",
        entityId: created.protocol,
        label: eventLabel(created),
        details: {
          days: input.days.map((d) => d.date),
          spaces: created.spaces.length,
          expectedAttendees: created.expectedAttendees,
          estimateCents: estimate?.quote.totalCents ?? null,
        },
      });
      // Quem pediu recebe a confirmação; o NUCEV e o SAD, o aviso do pedido novo.
      const summary: [string, string][] = [
        ["Protocolo", created.protocol],
        ["Datas", input.days.map((d) => d.date).sort().map(brDate).join(", ")],
        ["Participantes", String(created.expectedAttendees)],
      ];
      const received = await queueNotice(tx, {
        eventId: created.id,
        to: [created.user.email],
        subject: `Pedido de evento recebido: ${created.title}`,
        heading: "Recebemos o seu pedido de evento",
        paragraphs: [
          `O pedido ${created.protocol} chegou ao NUCEV, que vai analisá-lo.`,
          "Você recebe um e-mail a cada etapa: análise, pré-reserva dos espaços, orçamento, pagamento e confirmação.",
        ],
        details: summary,
        path: `/eventos/${created.id}`,
      });
      const staff = await queueNotice(tx, {
        eventId: created.id,
        to: await staffEmails(tx, { withSad: true }),
        subject: `Novo pedido de evento: ${created.title}`,
        heading: "Novo pedido de evento",
        paragraphs: [`${created.user.name} pediu o evento ${created.protocol}.`],
        details: [...summary, ["Entidade", created.entity]],
        path: `/admin/eventos/${created.id}`,
      });
      return { event: created, noticeIds: [received.id, staff.id] };
    });
    deliverNotices(noticeIds);

    res.status(201).json({ event: serializeEvent(event) });
  }),
);

eventsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    await expireOverduePreReservations();
    const events = await prisma.event.findMany({ where: { userId: req.user!.id }, include: eventInclude, orderBy: { createdAt: "desc" } });
    res.json({ events: events.map(serializeEvent) });
  }),
);

const listQuerySchema = z.object({
  status: z.nativeEnum(EventStatus).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

eventsRouter.get(
  "/",
  requireStaff,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    await expireOverduePreReservations();
    const events = await prisma.event.findMany({
      where: {
        status: query.status,
        OR: query.q
          ? [
              { title: { contains: query.q, mode: "insensitive" } },
              { protocol: { contains: query.q, mode: "insensitive" } },
              { responsible: { contains: query.q, mode: "insensitive" } },
              { user: { name: { contains: query.q, mode: "insensitive" } } },
            ]
          : undefined,
      },
      include: eventInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ events: events.map(serializeEvent) });
  }),
);

const availabilitySchema = z.object({
  days: z.array(eventDaySchema).min(1).max(30),
  spaces: z.array(eventSpaceSchema).min(1).max(50),
});

/** Quantos espaços livres há para cada pedido, em cada dia (só orienta; não reserva). */
eventsRouter.post(
  "/availability",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = availabilitySchema.parse(req.body);
    const result = await spaceAvailability(prisma, input.days.map(usageWindow), input.spaces);
    res.json({ spaces: result });
  }),
);

async function findEvent(id: string) {
  const where = /^[0-9a-f-]{36}$/i.test(id) ? { id } : { protocol: id };
  const event = await prisma.event.findFirst({ where, include: eventInclude });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  return event;
}

eventsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await expireOverduePreReservations();
    const event = await findEvent(req.params.id!);
    if (event.userId !== req.user!.id && !isStaff(req.user!.role)) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
    res.json({ event: serializeEvent(event), possiblyExempt: possiblyExempt(event), management: await eventManagement(event.id, req.user!) });
  }),
);

/** Portaria 2794, Art. 4º I: evento da FMUSP sem inscrição e sem patrocínio pode ser isento (quem analisa confirma). */
const possiblyExempt = (e: { entity: string; hasRegistrationFee: boolean; sponsored: boolean }) =>
  FMUSP_ENTITIES.includes(e.entity) && !e.hasRegistrationFee && !e.sponsored;

/** O solicitante desiste antes do pagamento; as salas pré-reservadas são liberadas. */
const REQUESTER_CANCELLABLE: EventStatus[] = ["SUBMITTED", "IN_REVIEW", "PRE_RESERVED", "QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED"];

eventsRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
    const event = await findEvent(req.params.id!);
    if (event.userId !== req.user!.id) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
    if (!REQUESTER_CANCELLABLE.includes(event.status)) {
      throw new AppError(409, "EVENT_NOT_CANCELLABLE", "Este evento não pode mais ser cancelado por aqui. Fale com o NUCEV.");
    }
    const { updated, noticeIds } = await prisma.$transaction(async (tx) => {
      const released = await tx.reservation.updateMany({
        where: { eventId: event.id, status: { in: ["PENDING", "APPROVED"] } },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: req.user!.id, cancellationReason: "Evento cancelado pelo solicitante." },
      });
      const after = await tx.event.update({
        where: { id: event.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason || null, preReservedUntil: null },
        include: eventInclude,
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.cancel",
        entityType: "event",
        entityId: after.protocol,
        label: eventLabel(after),
        changes: { status: { from: event.status, to: "CANCELLED" } },
        details: reason ? { reason } : undefined,
      });
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: await staffEmails(tx, { withSad: true }),
        subject: `Evento cancelado pelo solicitante: ${event.title}`,
        heading: "Evento cancelado pelo solicitante",
        paragraphs: [`${event.user.name} cancelou o evento ${event.protocol}.`, ...(reason ? [`Motivo: ${reason}`] : [])],
        path: `/admin/eventos/${event.id}`,
      });
      // Quem cancelou recebe a confirmação, como nas reservas.
      const confirmation = await queueNotice(tx, {
        eventId: event.id,
        to: [event.user.email],
        subject: `Cancelamento registrado: ${event.title}`,
        heading: "Evento cancelado",
        paragraphs: [
          `O cancelamento do evento ${event.protocol} foi registrado.`,
          ...(released.count > 0 ? ["Os espaços pré-reservados foram liberados para outras solicitações."] : []),
        ],
        path: `/eventos/${event.id}`,
      });
      return { updated: after, noticeIds: [notice.id, confirmation.id] };
    });
    deliverNotices(noticeIds);
    res.json({ event: serializeEvent(updated) });
  }),
);
