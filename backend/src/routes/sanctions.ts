import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { addDays } from "../lib/calendar";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedDateKey } from "../lib/timezone";
import { sendInBackground } from "../mail/mailer";
import { adminCancelledMails } from "../mail/notifications";
import { requireAdmin } from "../middleware/auth";
import { activeSuspension, noShowsInLastYear } from "../reservations/portaria";
import { sanctionSchema } from "../schemas/review";

// Sanções aos solicitantes (Portaria 2793): advertência, multa e suspensão de
// novas reservas — por não comparecimento recorrente (Art. 9º §2º), uso
// inadequado (Art. 11, bloqueio de até 1 ano), inadimplência (Art. 17, até a
// regularização, com as reservas vigentes canceladas) ou descumprimento das
// normas (Art. 22). O sistema registra e aplica; quem decide é a Diretoria/SAD.
export const sanctionsRouter = Router();
sanctionsRouter.use(requireAdmin);

const sanctionInclude = {
  createdBy: { select: { id: true, name: true } },
  liftedBy: { select: { id: true, name: true } },
} as const;

/** Situação de um solicitante: ausências em 12 meses, sanções e suspensão em vigor. */
sanctionsRouter.get(
  "/users/:id/standing",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, email: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    const [noShows, sanctions, suspension] = await Promise.all([
      noShowsInLastYear(prisma, user.id),
      prisma.userSanction.findMany({ where: { userId: user.id }, include: sanctionInclude, orderBy: { createdAt: "desc" } }),
      activeSuspension(prisma, user.id),
    ]);
    res.json({ user, noShows, sanctions, activeSuspensionId: suspension?.id ?? null });
  }),
);

sanctionsRouter.post(
  "/users/:id/sanctions",
  asyncHandler(async (req, res) => {
    const input = sanctionSchema.parse(req.body);
    const adminId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (user.id === adminId) throw new AppError(400, "SELF_SANCTION", "Não é possível aplicar uma sanção a si mesmo.");

    // Suspensão com data: de hoje até no máximo 1 ano (Art. 11, 4). Sem data = até a regularização.
    const today = zonedDateKey(new Date());
    const untilKey = input.until ? input.until.toISOString().slice(0, 10) : null;
    if (untilKey && (untilKey < today || untilKey > addDays(today, 366))) {
      throw new AppError(400, "INVALID_UNTIL", "A suspensão vai de hoje até no máximo 1 ano (Portaria 2793, Art. 11).");
    }

    const now = new Date();
    const { sanction, cancelledGroups } = await prisma.$transaction(async (tx) => {
      const sanction = await tx.userSanction.create({
        data: {
          userId: user.id,
          type: input.type,
          reason: input.reason,
          until: untilKey ? new Date(`${untilKey}T00:00:00Z`) : null,
          createdById: adminId,
        },
        include: sanctionInclude,
      });

      // Art. 17: com inadimplência, as reservas vigentes são canceladas.
      let cancelledGroups: string[][] = [];
      if (input.type === "SUSPENSION" && input.cancelFutureReservations) {
        const future = await tx.reservation.findMany({
          where: { userId: user.id, status: { in: ["PENDING", "APPROVED"] }, startTime: { gt: now } },
          select: { id: true, seriesId: true },
        });
        if (future.length > 0) {
          await tx.reservation.updateMany({
            where: { id: { in: future.map((f) => f.id) } },
            data: { status: "CANCELLED", cancelledAt: now, cancelledById: adminId, cancellationReason: `Suspensão de reservas: ${input.reason}` },
          });
        }
        // Um e-mail por pedido (série ou data avulsa), como nos outros cancelamentos.
        const groups = new Map<string, string[]>();
        for (const f of future) groups.set(f.seriesId ?? f.id, [...(groups.get(f.seriesId ?? f.id) ?? []), f.id]);
        cancelledGroups = [...groups.values()];
      }
      return { sanction, cancelledGroups };
    });

    for (const ids of cancelledGroups) sendInBackground("reservas canceladas por suspensão", () => adminCancelledMails(ids));
    res.status(201).json({ sanction, cancelledCount: cancelledGroups.flat().length });
  }),
);

/** Retira uma suspensão antes do fim (ex.: situação regularizada junto à FFM). */
sanctionsRouter.post(
  "/sanctions/:id/lift",
  asyncHandler(async (req, res) => {
    const sanction = await prisma.userSanction.findUnique({ where: { id: req.params.id } });
    if (!sanction) throw new AppError(404, "SANCTION_NOT_FOUND", "Sanção não encontrada.");
    if (sanction.type !== "SUSPENSION" || sanction.liftedAt) {
      throw new AppError(409, "NOT_LIFTABLE", "Só uma suspensão em vigor pode ser retirada.");
    }
    const updated = await prisma.userSanction.update({
      where: { id: sanction.id },
      data: { liftedAt: new Date(), liftedById: req.user!.id },
      include: sanctionInclude,
    });
    res.json({ sanction: updated });
  }),
);

/** Suspensões em vigor (para a lista do SAD). */
sanctionsRouter.get(
  "/sanctions/active",
  asyncHandler(async (_req, res) => {
    const today = new Date(`${zonedDateKey(new Date())}T00:00:00Z`);
    const suspensions = await prisma.userSanction.findMany({
      where: { type: "SUSPENSION", liftedAt: null, OR: [{ until: null }, { until: { gte: today } }] },
      include: { ...sanctionInclude, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ suspensions });
  }),
);
