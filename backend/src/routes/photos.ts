import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

// GET /api/fotos/<id>-thumb.webp | <id>-large.webp — as versões ficam no banco.
// Só para quem está logado; o id muda a cada foto nova, então o navegador pode
// guardar a resposta para sempre.
export const photosRouter = Router();

const FILE_NAME = /^([0-9a-f-]{36})-(thumb|large)\.webp$/;

photosRouter.get(
  "/:file",
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = FILE_NAME.exec(req.params.file ?? "");
    if (!match) throw new AppError(404, "PHOTO_NOT_FOUND", "Foto não encontrada.");
    const [, id, size] = match;

    // Lê só a versão pedida: a outra (até ~300 KB) nem sai do banco.
    const data =
      size === "thumb"
        ? (await prisma.roomPhoto.findUnique({ where: { id }, select: { thumb: true } }))?.thumb
        : (await prisma.roomPhoto.findUnique({ where: { id }, select: { large: true } }))?.large;
    if (!data) throw new AppError(404, "PHOTO_NOT_FOUND", "Foto não encontrada.");

    res.set({ "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" });
    res.send(Buffer.from(data));
  }),
);
