import express, { Router } from "express";
import { z } from "zod";
import { diffFields, recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { uuidParam } from "../lib/params";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";

// Regulamento de uso dos espaços (as portarias). O solicitante aceita no
// "Li e concordo" do formulário; o SAD edita o texto e anexa os PDFs.
export const regulationRouter = Router();
regulationRouter.param("id", uuidParam("FILE_NOT_FOUND", "Arquivo não encontrado."));

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
    const regulation = await prisma.$transaction(async (tx) => {
      const before = await tx.regulation.findUnique({ where: { id: 1 }, select: { title: true, body: true } });
      const after = await tx.regulation.upsert({
        where: { id: 1 },
        update: { ...input, updatedById: req.user!.id },
        create: { id: 1, ...input, updatedById: req.user!.id },
        select: { title: true, body: true, updatedAt: true },
      });
      // O texto inteiro não vai para o histórico (pode ter dezenas de páginas): só o título e se o texto mudou.
      const bodyChanged = before?.body !== after.body;
      if (bodyChanged || before?.title !== after.title) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "regulation.update",
          entityType: "regulation",
          entityId: "1",
          label: after.title,
          changes: diffFields({ title: before?.title ?? null }, { title: after.title }),
          details: { bodyChanged, bodyLength: after.body.length },
        });
      }
      return after;
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
    const file = await prisma.$transaction(async (tx) => {
      const last = await tx.regulationFile.aggregate({ _max: { position: true } });
      const created = await tx.regulationFile.create({
        data: {
          fileName: fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`,
          mimeType: "application/pdf",
          size: data.length,
          data: new Uint8Array(data),
          position: (last._max.position ?? -1) + 1,
        },
        select: fileSelect,
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "regulation.file_add",
        entityType: "regulation",
        entityId: "1",
        label: created.fileName,
        details: { fileId: created.id, fileName: created.fileName, size: created.size },
      });
      return created;
    });
    res.status(201).json({ file });
  }),
);

regulationRouter.delete(
  "/files/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const file = await tx.regulationFile.findUnique({ where: { id: req.params.id }, select: fileSelect });
      if (!file) throw new AppError(404, "FILE_NOT_FOUND", "Arquivo não encontrado.");
      await tx.regulationFile.delete({ where: { id: file.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "regulation.file_delete",
        entityType: "regulation",
        entityId: "1",
        label: file.fileName,
        details: { fileId: file.id, fileName: file.fileName, size: file.size },
      });
    });
    res.status(204).end();
  }),
);

// Abre o PDF no navegador (inline), com o nome original.
regulationRouter.get(
  "/files/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Id malformado já respondeu 404 em regulationRouter.param("id").
    const file = await prisma.regulationFile.findUnique({ where: { id: req.params.id } });
    if (!file) throw new AppError(404, "FILE_NOT_FOUND", "Arquivo não encontrado.");
    res.set({
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, max-age=300",
    });
    res.send(Buffer.from(file.data));
  }),
);
