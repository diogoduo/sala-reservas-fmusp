import { Prisma, ReservationStatus, type Reservation } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { sendInBackground } from "../mail/mailer";
import { approvedMails, rejectedMails } from "../mail/notifications";
import { requireAdmin } from "../middleware/auth";
import { roomPhotosInclude } from "../photos/include";
import { rankRoomOptions } from "../reservations/allocation";
import { findConflictingOccurrences, isOverlapViolation, loadBusyIntervals, lockRoomForUpdate } from "../reservations/conflicts";
import { parseRequestedResources } from "../reservations/requested-resources";
import { approvalChecklistSchema } from "../schemas/reservation";
import { approveReservationSchema, rejectReservationSchema, reviewScopeSchema, type ReviewScope } from "../schemas/review";

// Fase 6 — fila de aprovação: o Admin vê as solicitações, escolhe a sala mais
// adequada e aprova (alocando a sala) ou rejeita (com justificativa).
export const adminRouter = Router();
adminRouter.use(requireAdmin);

export const adminReservationInclude = {
  room: true,
  user: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  noShowBy: { select: { id: true, name: true } },
  series: { select: { id: true, rrule: true, untilDate: true } },
} satisfies Prisma.ReservationInclude;

const roomWithResourcesInclude = {
  resources: { include: { resource: true }, orderBy: { resource: { name: "asc" } } },
  photos: roomPhotosInclude,
} satisfies Prisma.RoomInclude;

const conflictMessage = "Outra pessoa revisou esta solicitação ao mesmo tempo. Recarregue a lista e tente de novo.";

/**
 * Resolve a quais reservas uma ação do Admin se aplica. A reserva da URL precisa
 * estar pendente; com escopo "series", entram todas as ocorrências da série que
 * ainda estão pendentes e não começaram.
 */
async function resolveReviewTargets(
  db: Prisma.TransactionClient,
  reservationId: string,
  scope: ReviewScope,
  now: Date,
): Promise<Reservation[]> {
  const reservation = await db.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
  if (reservation.status !== "PENDING") {
    throw new AppError(409, "RESERVATION_NOT_PENDING", "Esta solicitação já foi revisada e não está mais pendente.");
  }

  if (scope === "single" || !reservation.seriesId) return [reservation];

  const targets = await db.reservation.findMany({
    where: { seriesId: reservation.seriesId, status: "PENDING", startTime: { gt: now } },
    orderBy: { startTime: "asc" },
  });
  if (targets.length === 0) {
    throw new AppError(409, "NOTHING_TO_REVIEW", "Esta série não tem mais ocorrências futuras pendentes.");
  }
  return targets;
}

const toOccurrence = (r: Reservation) => ({ id: r.id, start: r.startTime, end: r.endTime });

// ----------------------------------------------------------------------------
// Fila de solicitações
// ----------------------------------------------------------------------------

const listQuerySchema = z.object({
  status: z.nativeEnum(ReservationStatus).optional(),
});

adminRouter.get(
  "/reservations",
  asyncHandler(async (req, res) => {
    const { status } = listQuerySchema.parse(req.query);
    const reservations = await prisma.reservation.findMany({
      where: { status },
      include: adminReservationInclude,
      orderBy: { startTime: "asc" },
      take: 1000,
    });
    res.json({ reservations });
  }),
);

// ----------------------------------------------------------------------------
// Salas livres — consulta rápida do SAD ("qual sala está livre dia 30, das 10
// às 11?"). Para cada sala ativa, diz se está livre no intervalo e, se não
// estiver, o que a ocupa. Mesma semântica [início, fim) da exclusion constraint:
// um evento pode começar exatamente quando outro termina.
// ----------------------------------------------------------------------------

const availabilityQuerySchema = z
  .object({ start: z.coerce.date(), end: z.coerce.date() })
  .refine((q) => q.end > q.start, { message: "O término deve ser depois do início.", path: ["end"] });

adminRouter.get(
  "/availability",
  asyncHandler(async (req, res) => {
    const { start, end } = availabilityQuerySchema.parse(req.query);

    const rooms = await prisma.room.findMany({ where: { status: "ACTIVE" }, include: roomWithResourcesInclude });
    const roomIds = rooms.map((r) => r.id);
    const overlapping = { roomId: { in: roomIds }, startTime: { lt: end }, endTime: { gt: start } };

    const reservations = await prisma.reservation.findMany({
      where: { ...overlapping, status: { in: ["PENDING", "APPROVED"] } },
      select: { roomId: true, title: true, status: true, startTime: true, endTime: true, user: { select: { name: true } } },
    });
    const blocks = await prisma.roomBlock.findMany({
      where: overlapping,
      select: { roomId: true, reason: true, startTime: true, endTime: true },
    });

    const result = rooms
      .map((room) => {
        const busy = [
          ...reservations
            .filter((r) => r.roomId === room.id)
            .map((r) => ({ type: "reservation" as const, start: r.startTime, end: r.endTime, title: r.title, status: r.status, requester: r.user.name })),
          ...blocks
            .filter((b) => b.roomId === room.id)
            .map((b) => ({ type: "block" as const, start: b.startTime, end: b.endTime, reason: b.reason })),
        ].sort((a, b) => a.start.getTime() - b.start.getTime());
        return { room, free: busy.length === 0, busy };
      })
      // Livres primeiro; dentro de cada grupo, da menor para a maior capacidade.
      .sort((a, b) => Number(b.free) - Number(a.free) || (a.room.capacity ?? 0) - (b.room.capacity ?? 0));

    res.json({ rooms: result });
  }),
);

// ----------------------------------------------------------------------------
// Salas candidatas — só leitura, para orientar a escolha. A checagem que vale
// é a de POST .../approve, feita dentro da transação com lock na sala.
// ----------------------------------------------------------------------------

const roomOptionsQuerySchema = z.object({ scope: reviewScopeSchema });

adminRouter.get(
  "/reservations/:id/room-options",
  asyncHandler(async (req, res) => {
    const { scope } = roomOptionsQuerySchema.parse(req.query);
    const targets = await resolveReviewTargets(prisma, req.params.id!, scope, new Date());
    const first = targets[0]!;

    const rooms = await prisma.room.findMany({
      where: { status: "ACTIVE" },
      include: roomWithResourcesInclude,
    });
    const occurrences = targets.map(toOccurrence);
    const busy = await loadBusyIntervals(
      prisma,
      rooms.map((r) => r.id),
      occurrences,
      targets.map((t) => t.id),
    );

    const options = rankRoomOptions(
      {
        expectedAttendees: first.expectedAttendees,
        requestedResources: parseRequestedResources(first.requestedResources),
        coffeeBreak: first.coffeeBreak,
      },
      occurrences,
      rooms,
      busy,
    );

    res.json({ occurrences, options });
  }),
);

// ----------------------------------------------------------------------------
// Aprovar = alocar a sala + aprovar, numa transação só.
// ----------------------------------------------------------------------------

adminRouter.post(
  "/reservations/:id/approve",
  asyncHandler(async (req, res) => {
    const input = approveReservationSchema.parse(req.body);
    const reviewerId = req.user!.id;

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const targets = await resolveReviewTargets(tx, req.params.id!, input.scope, now);
      if (targets.some((t) => t.startTime <= now)) {
        throw new AppError(400, "RESERVATION_IN_PAST", "Não é possível aprovar uma reserva cujo horário já passou.");
      }

      // Trava a sala antes de ler/checar: duas aprovações simultâneas na mesma
      // sala ficam em fila, e a segunda já enxerga o que a primeira gravou.
      await lockRoomForUpdate(tx, input.roomId);
      const room = await tx.room.findUnique({ where: { id: input.roomId } });
      if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
      if (room.status !== "ACTIVE") {
        throw new AppError(409, "ROOM_NOT_ACTIVE", "Só é possível alocar salas com status Ativa.");
      }
      // Capacidade (Art. 5º §2º) e a conferência do Art. 20 §3º não barram: o SAD
      // pode passar por cima das portarias, e a tela avisa o que está sendo violado.
      // Em Cultura e Extensão, fica registrado o que foi conferido.
      const approvalChecklist =
        targets[0]!.activityType === "CULTURE_EXTENSION"
          ? { ...approvalChecklistSchema.parse(input.approvalChecklist ?? {}), checkedAt: now.toISOString() }
          : undefined;

      const conflicting = await findConflictingOccurrences(
        tx,
        room.id,
        targets.map(toOccurrence),
        targets.map((t) => t.id),
      );
      const conflictingIds = new Set(conflicting.map((c) => c.id));
      const free = targets.filter((t) => !conflictingIds.has(t.id));

      if (conflicting.length > 0 && (!input.skipConflicting || free.length === 0)) {
        throw new AppError(
          409,
          "RESERVATION_CONFLICT",
          free.length === 0
            ? "A sala já está ocupada em todas as datas desta solicitação."
            : "A sala já está ocupada em algumas datas desta solicitação.",
          { conflictingDates: conflicting.map((c) => c.start), availableDates: free.map((f) => f.startTime) },
        );
      }

      const freeIds = free.map((f) => f.id);
      let updated;
      try {
        updated = await tx.reservation.updateMany({
          where: { id: { in: freeIds }, status: "PENDING" },
          data: { roomId: room.id, status: "APPROVED", reviewedById: reviewerId, reviewedAt: now, approvalChecklist },
        });
      } catch (error) {
        // Rede de segurança: a exclusion constraint pegou algo que a checagem acima não pegou.
        if (isOverlapViolation(error)) {
          throw new AppError(409, "RESERVATION_CONFLICT", "A sala acabou de ser ocupada neste horário. Recarregue e tente de novo.");
        }
        throw error;
      }
      if (updated.count !== freeIds.length) throw new AppError(409, "RESERVATION_NOT_PENDING", conflictMessage);

      const approved = await tx.reservation.findMany({
        where: { id: { in: freeIds } },
        include: adminReservationInclude,
        orderBy: { startTime: "asc" },
      });
      return { approved, skipped: conflicting.map((c) => ({ id: c.id, startTime: c.start })) };
    });

    const approvedIds = result.approved.map((r) => r.id);
    sendInBackground("reserva aprovada", () => approvedMails(approvedIds));
    res.json(result);
  }),
);

// ----------------------------------------------------------------------------
// Rejeitar — justificativa obrigatória (também garantida por CHECK no banco).
// Rejeitar libera o horário: a exclusion constraint só considera PENDING/APPROVED.
// ----------------------------------------------------------------------------

adminRouter.post(
  "/reservations/:id/reject",
  asyncHandler(async (req, res) => {
    const input = rejectReservationSchema.parse(req.body);
    const reviewerId = req.user!.id;

    const rejectedIds = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const targets = await resolveReviewTargets(tx, req.params.id!, input.scope, now);
      const ids = targets.map((t) => t.id);

      const updated = await tx.reservation.updateMany({
        where: { id: { in: ids }, status: "PENDING" },
        data: { status: "REJECTED", rejectionReason: input.reason, reviewedById: reviewerId, reviewedAt: now },
      });
      if (updated.count !== ids.length) throw new AppError(409, "RESERVATION_NOT_PENDING", conflictMessage);
      return ids;
    });

    sendInBackground("solicitação rejeitada", () => rejectedMails(rejectedIds));
    res.json({ rejectedIds });
  }),
);
