import { Prisma } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { createResourceSchema, updateResourceSchema } from "../schemas/resource";

export const resourcesRouter = Router();

resourcesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const resources = await prisma.resource.findMany({ orderBy: { name: "asc" } });
    res.json({ resources });
  }),
);

resourcesRouter.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createResourceSchema.parse(req.body);
    try {
      const resource = await prisma.resource.create({ data: input });
      res.status(201).json({ resource });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(409, "RESOURCE_NAME_TAKEN", "Já existe um recurso com esse nome.");
      }
      throw error;
    }
  }),
);

resourcesRouter.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = updateResourceSchema.parse(req.body);
    try {
      const resource = await prisma.resource.update({ where: { id: req.params.id }, data: input });
      res.json({ resource });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") throw new AppError(404, "RESOURCE_NOT_FOUND", "Recurso não encontrado.");
        if (error.code === "P2002") throw new AppError(409, "RESOURCE_NAME_TAKEN", "Já existe um recurso com esse nome.");
      }
      throw error;
    }
  }),
);

// Exclusão em cascata dos vínculos com salas (room_resources.resource_id é ON DELETE CASCADE).
// `reservations.requested_resources` guarda os ids como jsonb solto (sem FK), então excluir um
// recurso não é bloqueado pelo banco — mas pode deixar ids "órfãos" em reservas antigas.
// TODO (Fase 4+): ao exibir uma reserva, ignorar ids de requestedResources que não existirem mais.
resourcesRouter.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await prisma.resource.delete({ where: { id: req.params.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new AppError(404, "RESOURCE_NOT_FOUND", "Recurso não encontrado.");
      }
      throw error;
    }
    res.status(204).end();
  }),
);
