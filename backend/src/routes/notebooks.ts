import { Prisma } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { createNotebookSchema, updateNotebookSchema } from "../schemas/notebook";

// Notebooks do SAD: só controle de patrimônio (backup no SAD ou transferidos
// para o NIT). Não entram nas reservas. Só o SAD (Admin) acessa.
export const notebooksRouter = Router();
notebooksRouter.use(requireAdmin);

function translateError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new AppError(409, "NOTEBOOK_EXISTS", "Já existe um notebook com esse patrimônio.");
    if (error.code === "P2025") throw new AppError(404, "NOTEBOOK_NOT_FOUND", "Notebook não encontrado.");
  }
  throw error;
}

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
    const notebook = await prisma.notebook.create({ data: input }).catch(translateError);
    res.status(201).json({ notebook });
  }),
);

notebooksRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = updateNotebookSchema.parse(req.body);
    const notebook = await prisma.notebook.update({ where: { id: req.params.id }, data: input }).catch(translateError);
    res.json({ notebook });
  }),
);

notebooksRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.notebook.delete({ where: { id: req.params.id } }).catch(translateError);
    res.status(204).end();
  }),
);
