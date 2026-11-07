import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { deliverNotices, queueNotice, sadEmails, staffEmails } from "../events/notices";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { isStaff, requireAdmin, requireAuth } from "../middleware/auth";
import { PAYMENT_INSTRUCTIONS_KEY } from "./event-workflow";

// Fase 13 — pagamento e confirmação do evento. Regra do documento (4.4): o
// comprovante sozinho não confirma nada. O solicitante envia, o NUCEV valida (ou
// recusa, e o solicitante envia outro) e o SAD confirma a reserva: a pré-reserva
// vira reserva efetivada (as reservas do evento perdem a validade).
export const eventPaymentRouter = Router();

function requireNucev(req: Request, _res: Response, next: NextFunction): void {
  const role = req.user?.role;
  if (role === "NUCEV" || role === "ADMIN") return next();
  next(new AppError(403, "FORBIDDEN", role ? "Só o NUCEV (ou o SAD) pode fazer isso." : "Faça login para continuar."));
}

const label = (e: { protocol: string; title: string }) => `${e.protocol} — ${e.title}`;

async function loadEvent(id: string) {
  const event = await prisma.event.findUnique({ where: { id }, include: { user: { select: { id: true, name: true, email: true } } } });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  return event;
}

/** PDF, JPEG ou PNG, pelo conteúdo (não só pela extensão). */
function receiptType(data: Buffer): string | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

// Corpo = o próprio arquivo (PDF ou foto); nome em ?nome=.
eventPaymentRouter.post(
  "/:id/receipts",
  requireAuth,
  express.raw({ type: ["application/pdf", "image/jpeg", "image/png"], limit: "10mb" }),
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    if (event.userId !== req.user!.id) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
    if (event.status !== "QUOTE_APPROVED") throw new AppError(409, "EVENT_WRONG_STATUS", "O comprovante é enviado depois de aprovar o orçamento.");
    const data = req.body;
    const mimeType = Buffer.isBuffer(data) ? receiptType(data) : null;
    if (!mimeType) throw new AppError(400, "INVALID_RECEIPT", "Envie o comprovante em PDF, JPG ou PNG (até 10 MB).");
    const fileName = z.string().trim().min(1).max(200).catch("comprovante").parse(req.query.nome);

    const noticeId = await prisma.$transaction(async (tx) => {
      const receipt = await tx.eventReceipt.create({
        data: { eventId: event.id, fileName, mimeType, size: data.length, data: new Uint8Array(data), uploadedByName: req.user!.name },
        select: { id: true },
      });
      await tx.event.update({ where: { id: event.id }, data: { status: "PAYMENT_SUBMITTED" } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.payment_receipt",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: { status: { from: event.status, to: "PAYMENT_SUBMITTED" } },
        details: { receiptId: receipt.id, fileName, size: data.length },
      });
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: await staffEmails(tx),
        subject: `Comprovante de pagamento enviado: ${event.title}`,
        heading: "Comprovante de pagamento enviado",
        paragraphs: [`${event.user.name} enviou o comprovante de pagamento do evento ${event.protocol}. Confira e valide.`],
        path: `/admin/eventos/${event.id}`,
      });
      return notice.id;
    });
    deliverNotices([noticeId]);
    res.status(201).json({ ok: true });
  }),
);

// Abre o comprovante no navegador: quem pediu e a equipe.
eventPaymentRouter.get(
  "/:id/receipts/:receiptId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    if (event.userId !== req.user!.id && !isStaff(req.user!.role)) throw new AppError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
    const receipt = await prisma.eventReceipt.findFirst({ where: { id: req.params.receiptId, eventId: event.id } });
    if (!receipt) throw new AppError(404, "FILE_NOT_FOUND", "Arquivo não encontrado.");
    res.set({
      "Content-Type": receipt.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(receipt.fileName)}`,
      "Cache-Control": "private, max-age=300",
    });
    res.send(Buffer.from(receipt.data));
  }),
);

async function pendingReceipt(eventId: string) {
  const receipt = await prisma.eventReceipt.findFirst({ where: { eventId, status: "PENDING" }, orderBy: { uploadedAt: "desc" } });
  if (!receipt) throw new AppError(409, "NO_PENDING_RECEIPT", "Não há comprovante aguardando conferência.");
  return receipt;
}

eventPaymentRouter.post(
  "/:id/payment/validate",
  requireNucev,
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
    const event = await loadEvent(req.params.id!);
    if (event.status !== "PAYMENT_SUBMITTED") throw new AppError(409, "EVENT_WRONG_STATUS", "Não há pagamento aguardando validação.");
    const receipt = await pendingReceipt(event.id);
    const ids = await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.eventReceipt.update({ where: { id: receipt.id }, data: { status: "VALIDATED", reviewedAt: now, reviewedByName: req.user!.name, reviewNote: note || null } });
      await tx.event.update({ where: { id: event.id }, data: { status: "PAYMENT_VALIDATED", paymentValidatedAt: now, paymentValidatedByName: req.user!.name } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.payment_validate",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: { status: { from: event.status, to: "PAYMENT_VALIDATED" } },
        details: { receiptId: receipt.id, ...(note && { note }) },
      });
      const toSad = await queueNotice(tx, {
        eventId: event.id,
        to: await sadEmails(tx),
        subject: `Pagamento validado, confirmar a reserva: ${event.title}`,
        heading: "Pagamento validado",
        paragraphs: [`O NUCEV validou o pagamento do evento ${event.protocol}. Falta o SAD confirmar a reserva.`],
        path: `/admin/eventos/${event.id}`,
      });
      const toRequester = await queueNotice(tx, {
        eventId: event.id,
        to: [event.user.email],
        subject: `Pagamento validado: ${event.title}`,
        heading: "Pagamento validado",
        paragraphs: [`O pagamento do evento ${event.protocol} foi validado. O SAD vai confirmar a reserva.`],
        path: `/eventos/${event.id}`,
      });
      return [toSad.id, toRequester.id];
    });
    deliverNotices(ids);
    res.json({ ok: true });
  }),
);

eventPaymentRouter.post(
  "/:id/payment/refuse",
  requireNucev,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(1, "Informe o motivo.").max(1000) }).parse(req.body);
    const event = await loadEvent(req.params.id!);
    if (event.status !== "PAYMENT_SUBMITTED") throw new AppError(409, "EVENT_WRONG_STATUS", "Não há pagamento aguardando validação.");
    const receipt = await pendingReceipt(event.id);
    const noticeId = await prisma.$transaction(async (tx) => {
      await tx.eventReceipt.update({ where: { id: receipt.id }, data: { status: "REFUSED", reviewedAt: new Date(), reviewedByName: req.user!.name, reviewNote: reason } });
      // Volta a aguardar o pagamento: o solicitante envia outro comprovante (a pré-reserva continua com a validade).
      await tx.event.update({ where: { id: event.id }, data: { status: "QUOTE_APPROVED" } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.payment_refuse",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: { status: { from: event.status, to: "QUOTE_APPROVED" } },
        details: { receiptId: receipt.id, reason },
      });
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: [event.user.email],
        subject: `Comprovante não aceito: ${event.title}`,
        heading: "Comprovante não aceito",
        paragraphs: [`O NUCEV não conseguiu validar o comprovante do evento ${event.protocol}.`, `Motivo: ${reason}`, "Envie um novo comprovante na página do evento."],
        path: `/eventos/${event.id}`,
      });
      return notice.id;
    });
    deliverNotices([noticeId]);
    res.json({ ok: true });
  }),
);

/** O SAD confirma: a pré-reserva vira reserva efetivada. */
eventPaymentRouter.post(
  "/:id/confirm",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req.params.id!);
    if (event.status !== "PAYMENT_VALIDATED") throw new AppError(409, "EVENT_WRONG_STATUS", "A reserva é confirmada depois do pagamento validado.");
    const ids = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const reservations = await tx.reservation.updateMany({
        where: { eventId: event.id, status: { in: ["PENDING", "APPROVED"] } },
        data: { preReservedUntil: null, status: "APPROVED" },
      });
      if (reservations.count === 0) throw new AppError(409, "NO_RESERVATIONS", "O evento não tem salas pré-reservadas: faça a pré-reserva antes de confirmar.");
      await tx.event.update({ where: { id: event.id }, data: { status: "CONFIRMED", preReservedUntil: null, confirmedAt: now, confirmedByName: req.user!.name } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "event.confirm",
        entityType: "event",
        entityId: event.protocol,
        label: label(event),
        changes: { status: { from: event.status, to: "CONFIRMED" } },
        details: { reservations: reservations.count },
      });
      const toRequester = await queueNotice(tx, {
        eventId: event.id,
        to: [event.user.email],
        subject: `Reserva confirmada: ${event.title}`,
        heading: "Reserva confirmada",
        paragraphs: [`A reserva dos espaços do evento ${event.protocol} está confirmada.`],
        path: `/eventos/${event.id}`,
      });
      const toStaff = await queueNotice(tx, {
        eventId: event.id,
        to: await staffEmails(tx),
        subject: `Evento confirmado: ${event.title}`,
        heading: "Evento confirmado",
        paragraphs: [`O SAD confirmou a reserva do evento ${event.protocol}.`],
        path: `/admin/eventos/${event.id}`,
      });
      return [toRequester.id, toStaff.id];
    });
    deliverNotices(ids);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Orientações de pagamento (texto que a equipe edita)
// ---------------------------------------------------------------------------

export const settingsRouter = Router();

settingsRouter.get(
  "/payment-instructions",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const row = await prisma.appSetting.findUnique({ where: { key: PAYMENT_INSTRUCTIONS_KEY } });
    res.json({ value: row?.value ?? "", updatedAt: row?.updatedAt ?? null, updatedByName: row?.updatedByName ?? null });
  }),
);

settingsRouter.put(
  "/payment-instructions",
  requireNucev,
  asyncHandler(async (req, res) => {
    const { value } = z.object({ value: z.string().trim().min(10, "Escreva as orientações de pagamento.").max(4000) }).parse(req.body);
    const before = await prisma.appSetting.findUnique({ where: { key: PAYMENT_INSTRUCTIONS_KEY } });
    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.appSetting.upsert({
        where: { key: PAYMENT_INSTRUCTIONS_KEY },
        update: { value, updatedByName: req.user!.name },
        create: { key: PAYMENT_INSTRUCTIONS_KEY, value, updatedByName: req.user!.name },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "settings.update",
        entityType: "price",
        entityId: PAYMENT_INSTRUCTIONS_KEY,
        label: "Orientações de pagamento dos eventos",
        changes: { paymentInstructions: { from: before?.value ?? null, to: value } },
      });
      return saved;
    });
    res.json({ value: row.value, updatedAt: row.updatedAt, updatedByName: row.updatedByName });
  }),
);
