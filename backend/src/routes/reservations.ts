import type { Prisma, ReservationStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { sendInBackground } from "../mail/mailer";
import { cancelledMails, modifiedMails, requestReceivedMails } from "../mail/notifications";
import { requireAuth } from "../middleware/auth";
import { roomPhotosInclude } from "../photos/include";
import { summarizeActivity } from "../reservations/activities";
import { expandRecurrence, type Occurrence } from "../reservations/recurrence";
import { normalizeRequestedResources } from "../reservations/requested-resources";
import { assertMinAdvance, assertValidDuration, assertWithinBusinessHours } from "../reservations/rules";
import { cancelReservationSchema, createReservationSchema, updateReservationSchema } from "../schemas/reservation";

export const reservationsRouter = Router();

const reservationInclude = {
  // "Outros equipamentos" é inventário interno do SAD.
  room: { omit: { equipmentNotes: true }, include: { photos: roomPhotosInclude } },
  // Nome de quem pediu: o SAD usa ao abrir uma reserva para alterar.
  user: { select: { name: true, email: true } },
} satisfies Prisma.ReservationInclude;

// ----------------------------------------------------------------------------
// Criação (pontual ou recorrente) — o coração do motor de reservas.
//
// O solicitante NÃO escolhe a sala: descreve a necessidade (participantes,
// recursos, finalidade) e a reserva nasce com `roomId = null`. É o Admin quem
// aloca a sala mais adequada ao aprovar (Fase 6) — é só nesse momento que faz
// sentido checar conflito/capacidade contra uma sala específica, então essa
// lógica (lock de linha, exclusion constraint, etc.) mora em
// src/reservations/conflicts.ts para ser reaproveitada lá.
// ----------------------------------------------------------------------------

reservationsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createReservationSchema.parse(req.body);
    const { title, expectedAttendees } = summarizeActivity(input);

    assertValidDuration(input.startTime, input.endTime);
    assertWithinBusinessHours(input.startTime, input.endTime);
    assertMinAdvance(input.startTime);

    const requestedResources = await normalizeRequestedResources(prisma, input.requestedResources);

    const occurrences: Occurrence[] = input.recurrence
      ? expandRecurrence(input.recurrence.rrule, input.startTime, input.endTime, input.recurrence.until)
      : [{ start: input.startTime, end: input.endTime }];

    // Cada ocorrência recorrente precisa respeitar o mesmo horário de funcionamento.
    for (const occ of occurrences) assertWithinBusinessHours(occ.start, occ.end);

    const series = input.recurrence
      ? await prisma.reservationSeries.create({
          data: {
            userId: req.user!.id,
            roomId: null,
            title,
            description: input.description,
            rrule: input.recurrence.rrule,
            startTime: input.startTime,
            endTime: input.endTime,
            untilDate: input.recurrence.until,
          },
        })
      : null;

    const reservations = await Promise.all(
      occurrences.map((occ) =>
        prisma.reservation.create({
          data: {
            seriesId: series?.id,
            userId: req.user!.id,
            roomId: null,
            title,
            description: input.description,
            activityType: input.activityType,
            activityDetails: input.details,
            expectedAttendees,
            requestedResources,
            supportNotes: input.supportNotes,
            termsAccepted: input.termsAccepted,
            startTime: occ.start,
            endTime: occ.end,
          },
          include: reservationInclude,
        }),
      ),
    );

    const createdIds = reservations.map((r) => r.id);
    sendInBackground("solicitação recebida", () => requestReceivedMails(createdIds));
    res.status(201).json({ series, reservations });
  }),
);

// ----------------------------------------------------------------------------
// Consulta das próprias reservas — alimenta a tela "Minhas Reservas" (Fase 8).
// A fila de todas as solicitações, para o Admin, fica em /api/admin (Fase 6).
// ----------------------------------------------------------------------------

const listQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
});

reservationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const reservations = await prisma.reservation.findMany({
      where: { userId: req.user!.id, status: query.status },
      include: reservationInclude,
      orderBy: { startTime: "asc" },
    });
    res.json({ reservations });
  }),
);

reservationsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const reservation = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      include: reservationInclude,
    });
    // 404 (não 403) para não revelar a existência de reservas de outras pessoas.
    if (!reservation || (reservation.userId !== req.user!.id && req.user!.role !== "ADMIN")) {
      throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
    }
    res.json({ reservation });
  }),
);

// ----------------------------------------------------------------------------
// Cancelamento pelo próprio solicitante (Fase 8). Vale para reservas pendentes
// ou aprovadas que ainda não começaram. Cancelar libera o horário da sala: a
// exclusion constraint só considera PENDING/APPROVED.
// ----------------------------------------------------------------------------

const CANCELLABLE_STATUSES: ReservationStatus[] = ["PENDING", "APPROVED"];

reservationsRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { scope } = cancelReservationSchema.parse(req.body ?? {});
    const userId = req.user!.id;

    const cancelledIds = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const reservation = await tx.reservation.findUnique({ where: { id: req.params.id } });
      // 404 (não 403) pelo mesmo motivo do GET /:id. Nem o Admin cancela por aqui.
      if (!reservation || reservation.userId !== userId) {
        throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
      }
      if (!CANCELLABLE_STATUSES.includes(reservation.status)) {
        throw new AppError(409, "RESERVATION_NOT_CANCELLABLE", "Esta reserva já foi rejeitada ou cancelada.");
      }

      // "series": todas as próximas datas ainda ativas da série (sem série, vale só esta).
      const targets =
        scope === "series" && reservation.seriesId
          ? await tx.reservation.findMany({
              where: { seriesId: reservation.seriesId, userId, status: { in: CANCELLABLE_STATUSES }, startTime: { gt: now } },
              select: { id: true },
            })
          : reservation.startTime > now
            ? [{ id: reservation.id }]
            : [];
      if (targets.length === 0) {
        throw new AppError(400, "RESERVATION_IN_PAST", "Não é possível cancelar uma reserva que já começou ou terminou.");
      }

      const ids = targets.map((t) => t.id);
      const updated = await tx.reservation.updateMany({
        where: { id: { in: ids }, status: { in: CANCELLABLE_STATUSES } },
        data: { status: "CANCELLED", cancelledAt: now, cancelledById: userId },
      });
      if (updated.count !== ids.length) {
        throw new AppError(409, "RESERVATION_NOT_CANCELLABLE", "A situação desta reserva mudou enquanto você cancelava. Recarregue a lista.");
      }
      return ids;
    });

    sendInBackground("reserva cancelada", () => cancelledMails(cancelledIds));
    res.json({ cancelledIds });
  }),
);

// ----------------------------------------------------------------------------
// Alteração pelo próprio solicitante. Vale para reservas pendentes ou
// aprovadas com pelo menos 3 dias de antecedência (a mesma regra de um pedido
// novo). A reserva volta para análise (PENDING) marcada como alterada, e a sala
// é liberada: o novo horário pode não caber nela. O SAD vê essas reservas na
// aba "Alteradas", com o retrato de como estavam antes.
// ----------------------------------------------------------------------------

const MIN_EDIT_ADVANCE_MS = 3 * 24 * 60 * 60 * 1000; // mesma antecedência de assertMinAdvance

reservationsRouter.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateReservationSchema.parse(req.body);
    const userId = req.user!.id;
    const { title, expectedAttendees } = summarizeActivity(input);
    assertValidDuration(input.startTime, input.endTime);
    const requestedResources = await normalizeRequestedResources(prisma, input.requestedResources);

    const updatedIds = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const editableFrom = new Date(now.getTime() + MIN_EDIT_ADVANCE_MS);
      const reservation = await tx.reservation.findUnique({ where: { id: req.params.id } });
      if (!reservation || reservation.userId !== userId) {
        throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
      }
      if (!CANCELLABLE_STATUSES.includes(reservation.status)) {
        throw new AppError(409, "RESERVATION_NOT_EDITABLE", "Esta reserva já foi rejeitada ou cancelada e não pode ser alterada.");
      }
      if (reservation.startTime < editableFrom) {
        throw new AppError(
          400,
          "EDIT_TOO_SOON",
          "Faltam menos de 3 dias para esta reserva: não dá mais para alterar. Se precisar, cancele e faça uma nova solicitação.",
        );
      }
      if (reservation.activityType && reservation.activityType !== input.activityType) {
        throw new AppError(400, "ACTIVITY_TYPE_LOCKED", "O tipo de atividade não muda numa alteração. Cancele e faça uma nova solicitação.");
      }

      // "series": esta e as próximas datas ativas da série que ainda podem ser alteradas.
      const targets =
        input.scope === "series" && reservation.seriesId
          ? await tx.reservation.findMany({
              where: {
                seriesId: reservation.seriesId,
                userId,
                status: { in: CANCELLABLE_STATUSES },
                startTime: { gte: reservation.startTime },
              },
              include: { room: true },
              orderBy: { startTime: "asc" },
            })
          : [await tx.reservation.findUniqueOrThrow({ where: { id: reservation.id }, include: { room: true } })];

      // Mover a data/horário da data escolhida move todas as outras do mesmo jeito
      // (ex.: "a aula passa das 10h para as 14h" ou "passa de quinta para sexta").
      const shiftMs = input.startTime.getTime() - reservation.startTime.getTime();
      const durationMs = input.endTime.getTime() - input.startTime.getTime();

      for (const target of targets) {
        const start = new Date(target.startTime.getTime() + shiftMs);
        const end = new Date(start.getTime() + durationMs);
        assertWithinBusinessHours(start, end);
        assertMinAdvance(start, now);

        // Guarda o último estado revisado: se já era uma alteração pendente, mantém o retrato original.
        const keepSnapshot = target.status === "PENDING" && target.modifiedByRequesterAt !== null && target.previousSnapshot !== null;
        const previousSnapshot = keepSnapshot
          ? (target.previousSnapshot as Prisma.InputJsonValue)
          : {
              status: target.status,
              startTime: target.startTime.toISOString(),
              endTime: target.endTime.toISOString(),
              roomId: target.roomId,
              roomName: target.room ? `${target.room.name} — ${target.room.building}, ${target.room.floor}` : null,
              expectedAttendees: target.expectedAttendees,
              title: target.title,
            };

        await tx.reservation.update({
          where: { id: target.id },
          data: {
            title,
            description: input.description,
            activityType: input.activityType,
            activityDetails: input.details,
            expectedAttendees,
            requestedResources,
            supportNotes: input.supportNotes ?? null,
            startTime: start,
            endTime: end,
            status: "PENDING",
            roomId: null,
            reviewedById: null,
            reviewedAt: null,
            rejectionReason: null,
            modifiedByRequesterAt: now,
            previousSnapshot,
          },
        });
      }
      return targets.map((t) => t.id);
    });

    sendInBackground("reserva alterada", () => modifiedMails(updatedIds));
    res.json({ updatedIds });
  }),
);
