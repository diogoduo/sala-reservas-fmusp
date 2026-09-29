import { Prisma, type ReservationStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { formatDayMonth } from "../lib/calendar";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { sendInBackground } from "../mail/mailer";
import { cancelledMails, modifiedMails, requestReceivedMails } from "../mail/notifications";
import { requireAuth } from "../middleware/auth";
import { roomPhotosInclude } from "../photos/include";
import { summarizeActivity } from "../reservations/activities";
import { activeSuspension, assertNotSuspended, nextProtocol, noShowsInLastYear, reservedWindow, withoutHolidays } from "../reservations/portaria";
import { expandRecurrence, type Occurrence } from "../reservations/recurrence";
import { normalizeRequestedResources } from "../reservations/requested-resources";
import {
  assertMinAdvance,
  assertRegularSchedule,
  assertValidDuration,
  isWithinRequesterDeadline,
  requesterDeadline,
} from "../reservations/rules";
import { cancelReservationSchema, requesterCreateSchema, updateReservationSchema } from "../schemas/reservation";

export const reservationsRouter = Router();

const reservationInclude = {
  // "Outros equipamentos" é inventário interno do SAD; cadeiras extras não contam (Art. 5º §2º).
  room: { omit: { equipmentNotes: true, extraSeats: true }, include: { photos: roomPhotosInclude } },
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
//
// Portaria 2793: o pedido só vale depois de gerado o protocolo (Art. 8º §1º, b);
// só em dias úteis e sábados, das 07h às 22h (Art. 6º); a montagem entra no
// período reservado (Art. 19); quem está suspenso não pede (Art. 9º, 11, 17).
// ----------------------------------------------------------------------------

reservationsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = requesterCreateSchema.parse(req.body);
    await assertNotSuspended(prisma, req.user!.id);
    const { title, expectedAttendees } = summarizeActivity(input);

    assertValidDuration(input.startTime, input.endTime);
    const window = reservedWindow(input);
    assertValidDuration(window.start, window.end);
    assertMinAdvance(window.start);

    const requestedResources = await normalizeRequestedResources(prisma, input.requestedResources);

    let occurrences: Occurrence[] = input.recurrence
      ? expandRecurrence(input.recurrence.rrule, window.start, window.end, input.recurrence.until)
      : [window];
    // Numa série, os feriados ficam de fora; num pedido de uma data só, o feriado é recusado abaixo.
    let skippedDates: { date: string; holiday: string }[] = [];
    if (input.recurrence) ({ kept: occurrences, skipped: skippedDates } = withoutHolidays(occurrences));
    for (const occ of occurrences) assertRegularSchedule(occ.start, occ.end);

    const protocol = await nextProtocol(prisma);
    const series = input.recurrence
      ? await prisma.reservationSeries.create({
          data: {
            userId: req.user!.id,
            roomId: null,
            title,
            description: input.description,
            rrule: input.recurrence.rrule,
            startTime: window.start,
            endTime: window.end,
            untilDate: input.recurrence.until,
          },
        })
      : null;

    const reservations = await Promise.all(
      occurrences.map((occ) =>
        prisma.reservation.create({
          data: {
            protocol,
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
            noAlcoholCommitment: input.noAlcoholCommitment,
            coffeeBreak: input.coffeeBreak,
            setupMinutes: input.setupMinutes,
            startTime: occ.start,
            endTime: occ.end,
          },
          include: reservationInclude,
        }),
      ),
    );

    const createdIds = reservations.map((r) => r.id);
    sendInBackground("solicitação recebida", () => requestReceivedMails(createdIds));
    res.status(201).json({ protocol, series, reservations, skippedDates });
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

/** Situação do próprio solicitante: suspensão em vigor e ausências em 12 meses. */
reservationsRouter.get(
  "/me/standing",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [suspension, noShows] = await Promise.all([
      activeSuspension(prisma, req.user!.id),
      noShowsInLastYear(prisma, req.user!.id),
    ]);
    res.json({
      suspension: suspension ? { until: suspension.until, reason: suspension.reason } : null,
      noShowCount: noShows.length,
    });
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
// Cancelamento pelo próprio solicitante (Fase 8). Cancelar libera o horário da
// sala: a exclusion constraint só considera PENDING/APPROVED.
//
// Portaria 2793, Art. 9º: a reserva aprovada é cancelada pelo sistema com no
// mínimo 3 dias úteis de antecedência; depois disso, só com o SAD/NE. O pedido
// ainda pendente (sem sala) pode ser retirado até o horário começar.
// ----------------------------------------------------------------------------

const CANCELLABLE_STATUSES: ReservationStatus[] = ["PENDING", "APPROVED"];

const deadlineMessage = (start: Date, action: "cancelar" | "alterar") =>
  `O prazo para ${action} pelo sistema terminou em ${formatDayMonth(requesterDeadline(start))}: é preciso pedir com no mínimo 3 dias úteis de antecedência (Portaria 2793, Art. 9º). Fale com o SAD/NE.`;

function canCancel(r: { status: ReservationStatus; startTime: Date }, now: Date): boolean {
  if (r.status === "PENDING") return r.startTime > now;
  return r.status === "APPROVED" && isWithinRequesterDeadline(r.startTime, now);
}

reservationsRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { scope } = cancelReservationSchema.parse(req.body ?? {});
    const userId = req.user!.id;

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const reservation = await tx.reservation.findUnique({ where: { id: req.params.id } });
      // 404 (não 403) pelo mesmo motivo do GET /:id. Nem o Admin cancela por aqui.
      if (!reservation || reservation.userId !== userId) {
        throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
      }
      if (!CANCELLABLE_STATUSES.includes(reservation.status)) {
        throw new AppError(409, "RESERVATION_NOT_CANCELLABLE", "Esta reserva já foi rejeitada ou cancelada.");
      }
      if (reservation.startTime <= now) {
        throw new AppError(400, "RESERVATION_IN_PAST", "Não é possível cancelar uma reserva que já começou ou terminou.");
      }

      // "series": todas as próximas datas ainda ativas da série (sem série, vale só esta).
      const candidates =
        scope === "series" && reservation.seriesId
          ? await tx.reservation.findMany({
              where: { seriesId: reservation.seriesId, userId, status: { in: CANCELLABLE_STATUSES }, startTime: { gt: now } },
              select: { id: true, status: true, startTime: true },
            })
          : [reservation];
      const targets = candidates.filter((c) => canCancel(c, now));
      // Datas aprovadas dentro do prazo de 3 dias úteis continuam de pé (só o SAD cancela).
      const kept = candidates.filter((c) => !canCancel(c, now));
      if (targets.length === 0) {
        throw new AppError(400, "CANCEL_DEADLINE_PASSED", deadlineMessage(kept[0]?.startTime ?? reservation.startTime, "cancelar"));
      }

      const ids = targets.map((t) => t.id);
      const updated = await tx.reservation.updateMany({
        where: { id: { in: ids }, status: { in: CANCELLABLE_STATUSES } },
        data: { status: "CANCELLED", cancelledAt: now, cancelledById: userId },
      });
      if (updated.count !== ids.length) {
        throw new AppError(409, "RESERVATION_NOT_CANCELLABLE", "A situação desta reserva mudou enquanto você cancelava. Recarregue a lista.");
      }
      return { cancelledIds: ids, keptIds: kept.map((k) => k.id) };
    });

    sendInBackground("reserva cancelada", () => cancelledMails(result.cancelledIds));
    res.json(result);
  }),
);

// ----------------------------------------------------------------------------
// Alteração pelo próprio solicitante. Vale para reservas pendentes ou aprovadas
// até o 3º dia útil antes da data (a mesma regra do cancelamento, Art. 9º — a
// alteração libera a sala). A reserva volta para análise (PENDING) marcada como
// alterada. O SAD vê essas reservas na aba "Alteradas", com o retrato de como
// estavam antes. A nova data segue as regras de um pedido novo.
// ----------------------------------------------------------------------------

reservationsRouter.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateReservationSchema.parse(req.body);
    const userId = req.user!.id;
    await assertNotSuspended(prisma, userId);
    const { title, expectedAttendees } = summarizeActivity(input);
    assertValidDuration(input.startTime, input.endTime);
    const window = reservedWindow(input);
    assertValidDuration(window.start, window.end);
    const requestedResources = await normalizeRequestedResources(prisma, input.requestedResources);

    const updatedIds = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const reservation = await tx.reservation.findUnique({ where: { id: req.params.id } });
      if (!reservation || reservation.userId !== userId) {
        throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
      }
      if (!CANCELLABLE_STATUSES.includes(reservation.status)) {
        throw new AppError(409, "RESERVATION_NOT_EDITABLE", "Esta reserva já foi rejeitada ou cancelada e não pode ser alterada.");
      }
      if (!isWithinRequesterDeadline(reservation.startTime, now)) {
        throw new AppError(400, "EDIT_TOO_SOON", deadlineMessage(reservation.startTime, "alterar"));
      }
      if (reservation.activityType && reservation.activityType !== input.activityType) {
        throw new AppError(400, "ACTIVITY_TYPE_LOCKED", "O tipo de atividade não muda numa alteração. Cancele e faça uma nova solicitação.");
      }

      // "series": esta e as próximas datas ativas da série (todas depois desta, então também no prazo).
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
      const shiftMs = window.start.getTime() - reservation.startTime.getTime();
      const durationMs = window.end.getTime() - window.start.getTime();

      for (const target of targets) {
        const start = new Date(target.startTime.getTime() + shiftMs);
        const end = new Date(start.getTime() + durationMs);
        assertRegularSchedule(start, end);
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
            noAlcoholCommitment: input.noAlcoholCommitment,
            coffeeBreak: input.coffeeBreak,
            setupMinutes: input.setupMinutes,
            outsideRegularHours: false,
            startTime: start,
            endTime: end,
            status: "PENDING",
            roomId: null,
            reviewedById: null,
            reviewedAt: null,
            rejectionReason: null,
            approvalChecklist: Prisma.DbNull,
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
