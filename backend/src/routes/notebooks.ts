import { Prisma, type Notebook } from "@prisma/client";
import { Router } from "express";
import { diffFields, recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { uuidParam } from "../lib/params";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { createNotebookSchema, updateNotebookSchema } from "../schemas/notebook";

// Notebooks do SAD: só controle de patrimônio (backup no SAD ou transferidos
// para o NIT). Não entram nas reservas. Só o SAD (Admin) acessa.
export const notebooksRouter = Router();
notebooksRouter.use(requireAdmin);
notebooksRouter.param("id", uuidParam("NOTEBOOK_NOT_FOUND", "Notebook não encontrado."));

function translateError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new AppError(409, "NOTEBOOK_EXISTS", "Já existe um notebook com esse patrimônio.");
    if (error.code === "P2025") throw new AppError(404, "NOTEBOOK_NOT_FOUND", "Notebook não encontrado.");
  }
  throw error;
}

const snapshot = (n: Notebook) => ({ assetTag: n.assetTag, model: n.model, location: n.location, notes: n.notes });

notebooksRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const notebooks = await prisma.notebook.findMany({ orderBy: [{ location: "asc" }, { assetTag: "asc" }] });
    res.json({ notebooks });
  }),
);

notebooksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createNotebookSchema.parse(req.body);
    const notebook = await prisma
      .$transaction(async (tx) => {
        const created = await tx.notebook.create({ data: input });
        await recordAudit(tx, {
          actor: req.user!,
          action: "notebook.create",
          entityType: "notebook",
          entityId: created.id,
          label: created.assetTag,
          details: snapshot(created),
        });
        return created;
      })
      .catch(translateError);
    res.status(201).json({ notebook });
  }),
);

notebooksRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = updateNotebookSchema.parse(req.body);
    const notebook = await prisma
      .$transaction(async (tx) => {
        const before = await tx.notebook.findUniqueOrThrow({ where: { id: req.params.id } });
        const after = await tx.notebook.update({ where: { id: before.id }, data: input });
        const changes = diffFields(snapshot(before), snapshot(after));
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, { actor: req.user!, action: "notebook.update", entityType: "notebook", entityId: after.id, label: after.assetTag, changes });
        }
        return after;
      })
      .catch(translateError);
    res.json({ notebook });
  }),
);

notebooksRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma
      .$transaction(async (tx) => {
        const deleted = await tx.notebook.delete({ where: { id: req.params.id } });
        await recordAudit(tx, {
          actor: req.user!,
          action: "notebook.delete",
          entityType: "notebook",
          entityId: deleted.id,
          label: deleted.assetTag,
          details: snapshot(deleted),
        });
      })
      .catch(translateError);
    res.status(204).end();
  }),
);
