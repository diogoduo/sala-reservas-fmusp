import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { summarizeActivity } from "../reservations/activities";
import { expandRecurrence, type Occurrence } from "../reservations/recurrence";
import { normalizeRequestedResources } from "../reservations/requested-resources";
import { assertMinAdvance, assertValidDuration, assertWithinBusinessHours } from "../reservations/rules";
import { createReservationSchema } from "../schemas/reservation";

export const reservationsRouter = Router();

const reservationInclude = {
  room: true,
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

    res.status(201).json({ series, reservations });
  }),
);

// ----------------------------------------------------------------------------
// Consulta — suficiente para validar a Fase 4/5; a tela "Minhas Reservas" (com
// cancelamento) é a Fase 8, e o painel de aprovação/alocação do Admin é a Fase 6.
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
