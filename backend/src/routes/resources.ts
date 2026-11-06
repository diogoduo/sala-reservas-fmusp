import { Prisma, type Resource } from "@prisma/client";
import { Router } from "express";
import { diffFields, recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { uuidParam } from "../lib/params";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { createResourceSchema, updateResourceSchema } from "../schemas/resource";

export const resourcesRouter = Router();
resourcesRouter.param("id", uuidParam("RESOURCE_NOT_FOUND", "Recurso não encontrado."));

const snapshot = (r: Resource) => ({
  name: r.name,
  description: r.description,
  requestsQuantity: r.requestsQuantity,
  requestable: r.requestable,
  detailPrompt: r.detailPrompt,
  detailOptions: r.detailOptions,
});

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
      const resource = await prisma.$transaction(async (tx) => {
        const created = await tx.resource.create({ data: input });
        await recordAudit(tx, {
          actor: req.user!,
          action: "resource.create",
          entityType: "resource",
          entityId: created.id,
          label: created.name,
          details: snapshot(created),
        });
        return created;
      });
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
      const resource = await prisma.$transaction(async (tx) => {
        const before = await tx.resource.findUniqueOrThrow({ where: { id: req.params.id } });
        const after = await tx.resource.update({ where: { id: before.id }, data: input });
        const changes = diffFields(snapshot(before), snapshot(after));
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, { actor: req.user!, action: "resource.update", entityType: "resource", entityId: after.id, label: after.name, changes });
        }
        return after;
      });
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
      await prisma.$transaction(async (tx) => {
        const deleted = await tx.resource.delete({ where: { id: req.params.id } });
        await recordAudit(tx, {
          actor: req.user!,
          action: "resource.delete",
          entityType: "resource",
          entityId: deleted.id,
          label: deleted.name,
          details: snapshot(deleted),
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new AppError(404, "RESOURCE_NOT_FOUND", "Recurso não encontrado.");
      }
      throw error;
    }
    res.status(204).end();
  }),
);
