import express, { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";

// Regulamento de uso dos espaços (as portarias). O solicitante aceita no
// "Li e concordo" do formulário; o SAD edita o texto e anexa os PDFs.
export const regulationRouter = Router();

const fileSelect = { id: true, fileName: true, size: true, createdAt: true } as const;

regulationRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [regulation, files] = await Promise.all([
      prisma.regulation.findUnique({ where: { id: 1 }, select: { title: true, body: true, updatedAt: true } }),
      prisma.regulationFile.findMany({ select: fileSelect, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    ]);
    res.json({ regulation, files });
  }),
);

const regulationSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200),
  body: z.string().trim().max(50_000),
});

regulationRouter.put(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = regulationSchema.parse(req.body);
    const regulation = await prisma.regulation.upsert({
      where: { id: 1 },
      update: { ...input, updatedById: req.user!.id },
      create: { id: 1, ...input, updatedById: req.user!.id },
      select: { title: true, body: true, updatedAt: true },
    });
    res.json({ regulation });
  }),
);

// Corpo = o próprio PDF (Content-Type application/pdf); nome do arquivo em ?nome=.
regulationRouter.post(
  "/files",
  requireAdmin,
  express.raw({ type: "application/pdf", limit: "20mb" }),
  asyncHandler(async (req, res) => {
    const data = req.body;
    if (!Buffer.isBuffer(data) || data.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new AppError(400, "INVALID_PDF", "Envie um arquivo PDF.");
    }
    const fileName = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .catch("portaria.pdf")
      .parse(req.query.nome);
    const last = await prisma.regulationFile.aggregate({ _max: { position: true } });
    const file = await prisma.regulationFile.create({
      data: {
        fileName: fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`,
        mimeType: "application/pdf",
        size: data.length,
        data: new Uint8Array(data),
        position: (last._max.position ?? -1) + 1,
      },
      select: fileSelect,
    });
    res.status(201).json({ file });
  }),
);

regulationRouter.delete(
  "/files/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const deleted = await prisma.regulationFile.deleteMany({ where: { id: req.params.id } });
    if (deleted.count === 0) throw new AppError(404, "FILE_NOT_FOUND", "Arquivo não encontrado.");
    res.status(204).end();
  }),
);

// Abre o PDF no navegador (inline), com o nome original.
regulationRouter.get(
  "/files/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const file = id.success ? await prisma.regulationFile.findUnique({ where: { id: id.data } }) : null;
    if (!file) throw new AppError(404, "FILE_NOT_FOUND", "Arquivo não encontrado.");
    res.set({
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, max-age=300",
    });
    res.send(Buffer.from(file.data));
  }),
);
