import { Prisma, type ReservationStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedDateKey, zonedDayRange } from "../lib/timezone";
import { env } from "../config/env";
import { sendInBackground, sendNow } from "../mail/mailer";
import { adminCancelledMails, adminModifiedMails, approvedMails, type AdminEditBefore } from "../mail/notifications";
import { requireAdmin } from "../middleware/auth";
import { roomPhotosInclude } from "../photos/include";
import { summarizeActivity } from "../reservations/activities";
import { findConflictingOccurrences, isOverlapViolation, lockRoomForUpdate } from "../reservations/conflicts";
import { expandRecurrence, type Occurrence } from "../reservations/recurrence";
import { nextProtocol, noShowsInLastYear, reservedWindow, withoutHolidays } from "../reservations/portaria";
import { normalizeRequestedResources } from "../reservations/requested-resources";
import { assertCapacity, assertCoffeeBreakAllowed, assertValidDuration, checkAdminSchedule } from "../reservations/rules";
import { adminCreateReservationSchema, adminUpdateReservationSchema, approvalChecklistSchema } from "../schemas/reservation";
import { adminCancelReservationSchema } from "../schemas/review";
import { adminReservationInclude } from "./admin";

// O SAD pode alterar e cancelar qualquer reserva ativa (pendente ou aprovada),
// e tem a Agenda: todas as reservas de um dia e a situação de cada sala.
export const adminActionsRouter = Router();
adminActionsRouter.use(requireAdmin);

const ACTIVE_STATUSES: ReservationStatus[] = ["PENDING", "APPROVED"];

const roomLabel = (room: { name: string; building: string; floor: string } | null) =>
  room ? `${room.name} — ${room.building}, ${room.floor}` : null;

/** A reserva da URL e, com escopo "series", as próximas datas ativas da mesma série. */
async function resolveTargets(tx: Prisma.TransactionClient, id: string, scope: "single" | "series") {
  const reservation = await tx.reservation.findUnique({ where: { id }, include: { room: true } });
  if (!reservation) throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
  if (!ACTIVE_STATUSES.includes(reservation.status)) {
    throw new AppError(409, "RESERVATION_NOT_ACTIVE", "Esta reserva já foi rejeitada ou cancelada.");
  }
  const targets =
    scope === "series" && reservation.seriesId
      ? await tx.reservation.findMany({
          where: { seriesId: reservation.seriesId, status: { in: ACTIVE_STATUSES }, startTime: { gte: reservation.startTime } },
          include: { room: true },
          orderBy: { startTime: "asc" },
        })
      : [reservation];
  return { reservation, targets };
}

// ----------------------------------------------------------------------------
// Reservar (pelo próprio SAD). Não passa pela fila: já nasce APROVADA, na sala
// escolhida. Sem os 3 dias de antecedência (só não pode ser no passado); valem
// a capacidade e a checagem de conflito em todas as datas, com a sala travada
// como na aprovação. Domingo, feriado ou fora das 07h–22h só com a autorização
// da Divisão Acadêmica marcada (Portaria 2793, Art. 6º §1º).
// ----------------------------------------------------------------------------

adminActionsRouter.post(
  "/reservations",
  asyncHandler(async (req, res) => {
    const input = adminCreateReservationSchema.parse(req.body);
    const { title, expectedAttendees } = summarizeActivity(input);
    const adminId = req.user!.id;

    assertValidDuration(input.startTime, input.endTime);
    const window = reservedWindow(input);
    assertValidDuration(window.start, window.end);
    const now = new Date();
    if (window.start <= now) {
      throw new AppError(400, "RESERVATION_IN_PAST", "Escolha um horário que ainda não passou.");
    }
    // Cultura e Extensão já nasce confirmada: vale a mesma conferência da aprovação (Art. 20 §3º).
    const approvalChecklist =
      input.activityType === "CULTURE_EXTENSION"
        ? { ...approvalChecklistSchema.parse(input.approvalChecklist ?? {}), checkedAt: now.toISOString() }
        : undefined;
    const requestedResources = await normalizeRequestedResources(prisma, input.requestedResources);

    let occurrences: Occurrence[] = input.recurrence
      ? expandRecurrence(input.recurrence.rrule, window.start, window.end, input.recurrence.until)
      : [window];
    // Sem a autorização do Art. 6º §1º, os feriados de uma série ficam de fora.
    let skippedDates: { date: string; holiday: string }[] = [];
    if (input.recurrence && !input.extraordinaryAuthorized) ({ kept: occurrences, skipped: skippedDates } = withoutHolidays(occurrences));
    const planned = occurrences.map((occ) => ({ ...occ, outside: checkAdminSchedule(occ.start, occ.end, input.extraordinaryAuthorized) }));

    let result;
    try {
      result = await prisma.$transaction(
        async (tx) => {
          await lockRoomForUpdate(tx, input.roomId);
          const room = await tx.room.findUnique({ where: { id: input.roomId } });
          if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
          if (room.status !== "ACTIVE") throw new AppError(409, "ROOM_NOT_ACTIVE", "Só é possível reservar salas com status Ativa.");
          assertCapacity(expectedAttendees, room.capacity);
          assertCoffeeBreakAllowed(input.coffeeBreak, room);

          const conflicting = await findConflictingOccurrences(tx, room.id, planned);
          if (conflicting.length > 0) {
            throw new AppError(
              409,
              "RESERVATION_CONFLICT",
              planned.length === 1
                ? `A sala ${room.name} já está ocupada nesse horário.`
                : `A sala ${room.name} já está ocupada em ${conflicting.length} das ${planned.length} datas.`,
              { conflictingDates: conflicting.map((c) => c.start) },
            );
          }

          const series = input.recurrence
            ? await tx.reservationSeries.create({
                data: {
                  userId: adminId,
                  roomId: room.id,
                  title,
                  description: input.description,
                  rrule: input.recurrence.rrule,
                  startTime: window.start,
                  endTime: window.end,
                  untilDate: input.recurrence.until,
                },
              })
            : null;

          const protocol = await nextProtocol(tx);
          // Sequencial: dentro de uma transação interativa as consultas dividem a mesma conexão.
          const reservations = [];
          for (const occ of planned) {
            reservations.push(
              await tx.reservation.create({
                data: {
                  protocol,
                  seriesId: series?.id,
                  userId: adminId,
                  roomId: room.id,
                  title,
                  description: input.description,
                  activityType: input.activityType,
                  activityDetails: input.details,
                  expectedAttendees,
                  requestedResources,
                  supportNotes: input.supportNotes,
                  termsAccepted: true,
                  noAlcoholCommitment: input.noAlcoholCommitment,
                  coffeeBreak: input.coffeeBreak,
                  setupMinutes: input.setupMinutes,
                  outsideRegularHours: occ.outside,
                  approvalChecklist,
                  startTime: occ.start,
                  endTime: occ.end,
                  status: "APPROVED",
                  reviewedById: adminId,
                  reviewedAt: now,
                },
                include: adminReservationInclude,
              }),
            );
          }
          return { protocol, series, reservations, skippedDates };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new AppError(409, "RESERVATION_CONFLICT", "A sala acabou de ser ocupada nesse horário. Recarregue e tente de novo.");
      }
      throw error;
    }

    const ids = result.reservations.map((r) => r.id);
    sendInBackground("reserva feita pelo SAD", () => approvedMails(ids, { notifyRequester: false }));
    res.status(201).json(result);
  }),
);

// ----------------------------------------------------------------------------
// Alterar. Diferente da alteração pelo solicitante: não volta para análise
// (aprovada continua aprovada), não exige os 3 dias de antecedência, pode trocar
// o tipo de atividade e a sala. Continua valendo o horário de funcionamento, a
// capacidade da sala e a checagem de conflito.
// ----------------------------------------------------------------------------

adminActionsRouter.put(
  "/reservations/:id",
  asyncHandler(async (req, res) => {
    const input = adminUpdateReservationSchema.parse(req.body);
    const { title, expectedAttendees } = summarizeActivity(input);
    assertValidDuration(input.startTime, input.endTime);
    const window = reservedWindow(input);
    assertValidDuration(window.start, window.end);
    const requestedResources = await normalizeRequestedResources(prisma, input.requestedResources);

    let before: AdminEditBefore | null = null;
    const updatedIds = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const { reservation, targets } = await resolveTargets(tx, req.params.id!, input.scope);
      before = { startTime: reservation.startTime, endTime: reservation.endTime, roomName: roomLabel(reservation.room) };

      const shiftMs = window.start.getTime() - reservation.startTime.getTime();
      const durationMs = window.end.getTime() - window.start.getTime();
      const planned = targets.map((target) => {
        const start = new Date(target.startTime.getTime() + shiftMs);
        const end = new Date(start.getTime() + durationMs);
        // Mudar o horário para domingo, feriado ou fora das 07h–22h só com a autorização do Art. 6º §1º.
        const unchanged = start.getTime() === target.startTime.getTime() && end.getTime() === target.endTime.getTime();
        const outside = checkAdminSchedule(start, end, input.extraordinaryAuthorized || (unchanged && target.outsideRegularHours));
        if (start <= now && !unchanged) {
          throw new AppError(400, "RESERVATION_IN_PAST", "Não dá para mover uma reserva para um horário que já passou.");
        }
        // Só a reserva aprovada troca de sala; a pendente continua sem sala (é alocada ao aprovar).
        const roomId = target.status === "APPROVED" ? (input.roomId ?? target.roomId) : target.roomId;
        // Art. 12: realocar exige autorização da Divisão Acadêmica e da Diretoria.
        if (target.status === "APPROVED" && roomId !== target.roomId && !input.relocationAuthorized) {
          throw new AppError(
            400,
            "RELOCATION_NEEDS_AUTHORIZATION",
            "Para realocar uma reserva aprovada em outra sala, confirme a autorização da Divisão Acadêmica e da Diretoria (Portaria 2793, Art. 12).",
          );
        }
        return { id: target.id, start, end, roomId, outside };
      });

      // Conflito e capacidade, sala por sala (a sala é travada antes de checar).
      const byRoom = new Map<string, typeof planned>();
      for (const p of planned) if (p.roomId) byRoom.set(p.roomId, [...(byRoom.get(p.roomId) ?? []), p]);
      for (const [roomId, occurrences] of byRoom) {
        await lockRoomForUpdate(tx, roomId);
        const room = await tx.room.findUnique({ where: { id: roomId } });
        if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
        if (room.status !== "ACTIVE" && roomId !== reservation.roomId) {
          throw new AppError(409, "ROOM_NOT_ACTIVE", "Só é possível mover a reserva para uma sala Ativa.");
        }
        assertCapacity(expectedAttendees, room.capacity);
        assertCoffeeBreakAllowed(input.coffeeBreak, room);
        const conflicting = await findConflictingOccurrences(tx, roomId, occurrences, planned.map((p) => p.id));
        if (conflicting.length > 0) {
          throw new AppError(
            409,
            "RESERVATION_CONFLICT",
            `A sala ${room.name} já está ocupada ${conflicting.length === 1 ? "nesse horário" : "em algumas dessas datas"}. Escolha outro horário ou outra sala.`,
            { conflictingDates: conflicting.map((c) => c.start) },
          );
        }
      }

      try {
        for (const p of planned) {
          await tx.reservation.update({
            where: { id: p.id },
            data: {
              title,
              description: input.description,
              activityType: input.activityType,
              activityDetails: input.details,
              expectedAttendees,
              requestedResources,
              supportNotes: input.supportNotes ?? null,
              coffeeBreak: input.coffeeBreak,
              setupMinutes: input.setupMinutes,
              outsideRegularHours: p.outside,
              startTime: p.start,
              endTime: p.end,
              roomId: p.roomId,
              modifiedByAdminAt: now,
            },
          });
        }
      } catch (error) {
        if (isOverlapViolation(error)) {
          throw new AppError(409, "RESERVATION_CONFLICT", "A sala acabou de ser ocupada nesse horário. Recarregue e tente de novo.");
        }
        throw error;
      }
      return planned.map((p) => p.id);
    });

    sendInBackground("reserva alterada pelo SAD", () => adminModifiedMails(updatedIds, before));
    res.json({ updatedIds });
  }),
);

// ----------------------------------------------------------------------------
// Cancelar (com motivo). Libera o horário da sala na hora.
// ----------------------------------------------------------------------------

adminActionsRouter.post(
  "/reservations/:id/cancel",
  asyncHandler(async (req, res) => {
    const { reason, scope } = adminCancelReservationSchema.parse(req.body);
    const adminId = req.user!.id;

    const cancelledIds = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const { targets } = await resolveTargets(tx, req.params.id!, scope);
      const ids = targets.filter((t) => t.endTime > now).map((t) => t.id);
      if (ids.length === 0) {
        throw new AppError(400, "RESERVATION_IN_PAST", "Esta reserva já terminou; não há o que cancelar.");
      }
      const updated = await tx.reservation.updateMany({
        where: { id: { in: ids }, status: { in: ACTIVE_STATUSES } },
        data: { status: "CANCELLED", cancelledAt: now, cancelledById: adminId, cancellationReason: reason },
      });
      if (updated.count !== ids.length) {
        throw new AppError(409, "RESERVATION_NOT_ACTIVE", "A situação desta reserva mudou enquanto você cancelava. Recarregue.");
      }
      return ids;
    });

    sendInBackground("reserva cancelada pelo SAD", () => adminCancelledMails(cancelledIds));
    res.json({ cancelledIds });
  }),
);

// ----------------------------------------------------------------------------
// Não comparecimento (Portaria 2793, Art. 9º §2º): o SAD registra quando o
// espaço reservado não foi usado nem cancelado. 3 ou mais em 12 meses =
// recorrência, sujeita a notificação e sanções (ver routes/sanctions.ts).
// ----------------------------------------------------------------------------

adminActionsRouter.post(
  "/reservations/:id/no-show",
  asyncHandler(async (req, res) => {
    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id } });
    if (!reservation) throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
    if (reservation.status !== "APPROVED") {
      throw new AppError(409, "NOT_APPROVED", "Só dá para registrar ausência em reserva aprovada.");
    }
    if (reservation.startTime > new Date()) {
      throw new AppError(400, "NOT_STARTED", "A reserva ainda não começou.");
    }
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { noShowAt: reservation.noShowAt ?? new Date(), noShowById: reservation.noShowById ?? req.user!.id },
    });
    const noShows = await noShowsInLastYear(prisma, reservation.userId);
    res.json({ noShowCount: noShows.length });
  }),
);

adminActionsRouter.delete(
  "/reservations/:id/no-show",
  asyncHandler(async (req, res) => {
    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id } });
    if (!reservation) throw new AppError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
    await prisma.reservation.update({ where: { id: reservation.id }, data: { noShowAt: null, noShowById: null } });
    const noShows = await noShowsInLastYear(prisma, reservation.userId);
    res.json({ noShowCount: noShows.length });
  }),
);

// ----------------------------------------------------------------------------
// E-mail de teste: confere a configuração de envio (Brevo/SMTP) na hora.
// ----------------------------------------------------------------------------

adminActionsRouter.post(
  "/test-email",
  asyncHandler(async (req, res) => {
    const { to } = z.object({ to: z.string().email() }).parse(req.body);
    try {
      await sendNow({
        to: [to],
        subject: "[Reservas FMUSP] E-mail de teste",
        text: "Se você recebeu esta mensagem, o envio de e-mails do sistema de reservas está funcionando.",
        html: "<p>Se você recebeu esta mensagem, o envio de e-mails do sistema de reservas está funcionando.</p>",
      });
    } catch (error) {
      throw new AppError(502, "MAIL_FAILED", `Não foi possível enviar: ${error instanceof Error ? error.message : String(error)}`);
    }
    res.json({ sent: true, mailEnabled: env.MAIL_ENABLED, transport: env.BREVO_API_KEY ? "brevo" : "smtp", redirectTo: env.MAIL_REDIRECT_TO ?? null });
  }),
);

// ----------------------------------------------------------------------------
// Agenda: todas as reservas de um dia (qualquer status) e as salas ativas, para
// a tela mostrar o que acontece em cada sala e quais ficam livres.
// ----------------------------------------------------------------------------

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

adminActionsRouter.get(
  "/agenda",
  asyncHandler(async (req, res) => {
    const date = dateKeySchema.parse(req.query.date);
    const { start, end } = zonedDayRange(date);

    const [reservations, blocks, rooms] = await Promise.all([
      prisma.reservation.findMany({
        where: { startTime: { gte: start, lt: end } },
        include: adminReservationInclude,
        orderBy: [{ startTime: "asc" }, { title: "asc" }],
      }),
      prisma.roomBlock.findMany({
        where: { startTime: { lt: end }, endTime: { gt: start } },
        select: { id: true, roomId: true, reason: true, startTime: true, endTime: true },
      }),
      prisma.room.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          building: true,
          floor: true,
          capacity: true,
          roomType: true,
          photos: { ...roomPhotosInclude, take: 1 },
        },
      }),
    ]);

    res.json({ date, reservations, blocks, rooms });
  }),
);

// Quantas reservas há em cada dia do mês, por situação (para o calendário do mês).
adminActionsRouter.get(
  "/agenda/month",
  asyncHandler(async (req, res) => {
    const month = z
      .string()
      .regex(/^\d{4}-\d{2}$/, "Mês no formato AAAA-MM.")
      .parse(req.query.month);
    const [year, monthNumber] = month.split("-").map(Number) as [number, number];
    const next = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
    const start = zonedDayRange(`${month}-01`).start;
    const end = zonedDayRange(`${next}-01`).start;

    const reservations = await prisma.reservation.findMany({
      where: { startTime: { gte: start, lt: end } },
      select: { startTime: true, status: true, modifiedByRequesterAt: true },
    });

    const days: Record<string, Record<string, number>> = {};
    for (const r of reservations) {
      const key = zonedDateKey(r.startTime);
      const day = (days[key] ??= { total: 0, PENDING: 0, MODIFIED: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 });
      day.total = (day.total ?? 0) + 1;
      const bucket = r.status === "PENDING" && r.modifiedByRequesterAt ? "MODIFIED" : r.status;
      day[bucket] = (day[bucket] ?? 0) + 1;
    }
    res.json({ month, days });
  }),
);
