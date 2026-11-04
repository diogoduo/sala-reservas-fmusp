import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { UUID_PATTERN } from "../lib/params";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

// GET /api/fotos/<id>-thumb.webp | <id>-large.webp — as versões ficam no banco.
// Só para quem está logado; o id muda a cada foto nova, então o navegador pode
// guardar a resposta para sempre.
export const photosRouter = Router();

// O id precisa ser um UUID de verdade: um valor qualquer com 36 caracteres
// chegaria ao Prisma e viraria erro 500 em vez de 404.
const FILE_NAME = new RegExp(`^(${UUID_PATTERN.source.slice(1, -1)})-(thumb|large)\\.webp$`, "i");

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
