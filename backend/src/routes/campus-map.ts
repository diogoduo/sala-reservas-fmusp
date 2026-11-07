import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";

// Mapa 3D da faculdade: os prédios (posição no campus, contorno de cada andar,
// escadas, elevadores e acessos), a planta de cada andar (as paredes, como piso)
// e a posição de cada sala. Os dados vêm das plantas locais (npm run db:mapa);
// o SAD ajusta a posição das salas pelo próprio mapa.
export const campusMapRouter = Router();

campusMapRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [buildings, rooms] = await Promise.all([
      prisma.mapBuilding.findMany({
        include: { plans: { select: { id: true, floor: true, bounds: true, updatedAt: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.room.findMany({ where: { status: "ACTIVE" }, select: { id: true, mapX: true, mapY: true } }),
    ]);
    res.json({ buildings, rooms });
  }),
);

/** A planta tratada de um andar (imagem com transparência). */
campusMapRouter.get(
  "/plans/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const plan = await prisma.mapFloorPlan.findUnique({ where: { id: req.params.id }, select: { image: true, mimeType: true, updatedAt: true } });
    if (!plan) throw new AppError(404, "NOT_FOUND", "Planta não encontrada.");
    res.set("Content-Type", plan.mimeType);
    res.set("Cache-Control", "private, max-age=86400");
    res.set("Last-Modified", plan.updatedAt.toUTCString());
    res.send(Buffer.from(plan.image));
  }),
);

/** O SAD posiciona a sala no andar (metros, no sistema do prédio); null volta à posição automática. */
campusMapRouter.patch(
  "/rooms/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = z.object({ mapX: z.number().min(-2000).max(2000).nullable(), mapY: z.number().min(-2000).max(2000).nullable() }).parse(req.body);
    const room = await prisma.room.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, mapX: true, mapY: true } });
    if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
    const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.room.update({ where: { id: room.id }, data: { mapX: round(input.mapX), mapY: round(input.mapY) }, select: { id: true, mapX: true, mapY: true } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "map.room_position",
        entityType: "room",
        entityId: room.id,
        label: room.name,
        changes: { position: { from: room.mapX === null ? null : `${room.mapX}, ${room.mapY}`, to: saved.mapX === null ? null : `${saved.mapX}, ${saved.mapY}` } },
      });
      return saved;
    });
    res.json({ room: updated });
  }),
);
