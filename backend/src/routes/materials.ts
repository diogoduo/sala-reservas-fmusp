import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireStaff } from "../middleware/auth";

// Fase 18 — controle de pranchões (documento SAD/NUCEV, 5.2): quantos há, quantos
// estão em uso e onde, quantos estão disponíveis, para qual evento ou reserva,
// quem retirou e quem devolveu, e o histórico de cada movimentação. A retirada
// trava o material no banco: duas pessoas não retiram os mesmos pranchões.
export const materialsRouter = Router();
materialsRouter.use(requireStaff);

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const required = (max: number, message: string) => z.string().trim().min(2, message).max(max);
const when = z.coerce.date().optional();
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

const loanInclude = { event: { select: { id: true, protocol: true, title: true } } } satisfies Prisma.MaterialLoanInclude;

/** Em uso = o que foi retirado e ainda não voltou. */
async function inUse(db: Prisma.TransactionClient | typeof prisma, itemId: string) {
  const open = await db.materialLoan.findMany({ where: { itemId, returnedAt: null }, select: { quantity: true, returnedQuantity: true } });
  return open.reduce((sum, l) => sum + l.quantity - l.returnedQuantity, 0);
}

materialsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [items, loans, movements, events] = await Promise.all([
      prisma.materialItem.findMany({ orderBy: { name: "asc" } }),
      prisma.materialLoan.findMany({ where: { returnedAt: null }, include: loanInclude, orderBy: { takenAt: "asc" } }),
      prisma.materialMovement.findMany({ include: { item: { select: { name: true } }, loan: { include: loanInclude } }, orderBy: { at: "desc" }, take: 100 }),
      prisma.event.findMany({ where: { status: { notIn: ["CANCELLED", "REJECTED", "EXPIRED"] }, closedAt: null }, select: { id: true, protocol: true, title: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    res.json({
      items: items.map((item) => {
        const used = loans.filter((l) => l.itemId === item.id).reduce((sum, l) => sum + l.quantity - l.returnedQuantity, 0);
        return { ...item, inUse: used, available: item.total - used };
      }),
      loans: loans.map((l) => ({ ...l, expectedReturnAt: l.expectedReturnAt?.toISOString().slice(0, 10) ?? null })),
      movements,
      events,
    });
  }),
);

const itemSchema = z.object({
  name: required(80, "Dê um nome ao material."),
  total: z.number().int().min(0).max(100_000),
  homeLocation: required(200, "Diga onde fica guardado."),
  notes: text(1000),
});

materialsRouter.post(
  "/items",
  asyncHandler(async (req, res) => {
    const input = itemSchema.parse(req.body);
    try {
      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.materialItem.create({ data: input });
        await tx.materialMovement.create({
          data: { itemId: created.id, kind: "ADJUST", quantity: input.total, toLocation: input.homeLocation, at: new Date(), notes: "Cadastro do material", recordedByName: req.user!.name },
        });
        await recordAudit(tx, { actor: req.user!, action: "material.create", entityType: "material", entityId: created.id, label: created.name, details: { total: created.total } });
        return created;
      });
      res.status(201).json({ item });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new AppError(409, "DUPLICATE", "Já existe um material com esse nome.");
      throw error;
    }
  }),
);

/** Ajuste do estoque (comprou, quebrou, recontou) ou do local de guarda. */
materialsRouter.patch(
  "/items/:id",
  asyncHandler(async (req, res) => {
    const input = itemSchema.partial().extend({ reason: text(500) }).parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM material_items WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const found = await tx.materialItem.findUnique({ where: { id: req.params.id } });
      if (!found) throw new AppError(404, "NOT_FOUND", "Material não encontrado.");
      if (input.total !== undefined && input.total < (await inUse(tx, found.id))) {
        throw new AppError(409, "IN_USE", "O total não pode ficar menor do que o que está em uso agora.");
      }
      const updated = await tx.materialItem.update({
        where: { id: found.id },
        data: { name: input.name, total: input.total, homeLocation: input.homeLocation, notes: input.notes === undefined ? undefined : input.notes },
      });
      if (input.total !== undefined && input.total !== found.total) {
        await tx.materialMovement.create({
          data: { itemId: found.id, kind: "ADJUST", quantity: input.total - found.total, at: new Date(), notes: input.reason ?? "Ajuste do estoque", recordedByName: req.user!.name },
        });
      }
      await recordAudit(tx, {
        actor: req.user!,
        action: "material.update",
        entityType: "material",
        entityId: found.id,
        label: updated.name,
        changes: {
          ...(input.total !== undefined && input.total !== found.total ? { total: { from: found.total, to: input.total } } : {}),
          ...(input.homeLocation && input.homeLocation !== found.homeLocation ? { homeLocation: { from: found.homeLocation, to: input.homeLocation } } : {}),
        },
        details: input.reason ? { reason: input.reason } : undefined,
      });
      return updated;
    });
    res.json({ item });
  }),
);

const checkoutSchema = z.object({
  quantity: z.number().int().min(1).max(100_000),
  location: required(200, "Diga para onde vão."),
  eventId: z.string().uuid().nullable().optional(),
  reservationProtocol: z.string().trim().max(20).optional().transform((v) => v || null),
  purpose: text(500),
  takenBy: required(200, "Diga quem retirou."),
  takenAt: when,
  expectedReturnAt: dateKey.nullable().optional(),
});

materialsRouter.post(
  "/items/:id/checkout",
  asyncHandler(async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    const loan = await prisma.$transaction(async (tx) => {
      // Trava o material: duas retiradas ao mesmo tempo não passam do total.
      await tx.$queryRaw`SELECT id FROM material_items WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const item = await tx.materialItem.findUnique({ where: { id: req.params.id } });
      if (!item) throw new AppError(404, "NOT_FOUND", "Material não encontrado.");
      const available = item.total - (await inUse(tx, item.id));
      if (input.quantity > available) throw new AppError(409, "NOT_ENOUGH", `Só há ${available} disponíveis agora.`);
      if (input.eventId && !(await tx.event.findUnique({ where: { id: input.eventId }, select: { id: true } }))) throw new AppError(400, "VALIDATION_ERROR", "Evento não encontrado.");
      if (input.reservationProtocol && !(await tx.reservation.findFirst({ where: { protocol: input.reservationProtocol }, select: { id: true } }))) {
        throw new AppError(400, "VALIDATION_ERROR", "Nenhuma reserva com esse protocolo.");
      }
      const at = input.takenAt ?? new Date();
      const created = await tx.materialLoan.create({
        data: {
          itemId: item.id,
          quantity: input.quantity,
          location: input.location,
          eventId: input.eventId ?? null,
          reservationProtocol: input.reservationProtocol,
          purpose: input.purpose,
          takenBy: input.takenBy,
          takenAt: at,
          expectedReturnAt: input.expectedReturnAt ? new Date(`${input.expectedReturnAt}T00:00:00Z`) : null,
          recordedByName: req.user!.name,
        },
        include: loanInclude,
      });
      await tx.materialMovement.create({
        data: { itemId: item.id, loanId: created.id, kind: "CHECKOUT", quantity: input.quantity, fromLocation: item.homeLocation, toLocation: input.location, person: input.takenBy, at, notes: input.purpose, recordedByName: req.user!.name },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "material.checkout",
        entityType: "material",
        entityId: item.id,
        label: item.name,
        details: { quantity: input.quantity, location: input.location, takenBy: input.takenBy, event: created.event?.protocol ?? null, reservation: input.reservationProtocol },
      });
      return created;
    });
    res.status(201).json({ loan });
  }),
);

async function openLoan(tx: Prisma.TransactionClient, id: string) {
  const loan = await tx.materialLoan.findUnique({ where: { id }, include: { item: true } });
  if (!loan) throw new AppError(404, "NOT_FOUND", "Retirada não encontrada.");
  if (loan.returnedAt) throw new AppError(409, "ALREADY_RETURNED", "Esta retirada já foi devolvida.");
  return loan;
}

/** Devolução (de tudo ou de parte). */
materialsRouter.post(
  "/loans/:id/return",
  asyncHandler(async (req, res) => {
    const input = z.object({ quantity: z.number().int().min(1).optional(), returnedBy: required(200, "Diga quem devolveu."), at: when, notes: text(500) }).parse(req.body);
    const loan = await prisma.$transaction(async (tx) => {
      const found = await openLoan(tx, req.params.id!);
      const pending = found.quantity - found.returnedQuantity;
      const quantity = input.quantity ?? pending;
      if (quantity > pending) throw new AppError(400, "VALIDATION_ERROR", `Faltam devolver ${pending}.`);
      const at = input.at ?? new Date();
      const complete = found.returnedQuantity + quantity === found.quantity;
      const updated = await tx.materialLoan.update({
        where: { id: found.id },
        data: { returnedQuantity: { increment: quantity }, returnedBy: input.returnedBy, ...(complete ? { returnedAt: at } : {}) },
        include: loanInclude,
      });
      await tx.materialMovement.create({
        data: { itemId: found.itemId, loanId: found.id, kind: "RETURN", quantity, fromLocation: found.location, toLocation: found.item.homeLocation, person: input.returnedBy, at, notes: input.notes, recordedByName: req.user!.name },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "material.return",
        entityType: "material",
        entityId: found.itemId,
        label: found.item.name,
        details: { quantity, returnedBy: input.returnedBy, complete, from: found.location },
      });
      return updated;
    });
    res.json({ loan });
  }),
);

/** Movimentação: os pranchões retirados mudam de lugar (ex.: do Foyer para o Teatro). */
materialsRouter.post(
  "/loans/:id/move",
  asyncHandler(async (req, res) => {
    const input = z.object({ toLocation: required(200, "Diga para onde foram."), movedBy: required(200, "Diga quem levou."), at: when, notes: text(500) }).parse(req.body);
    const loan = await prisma.$transaction(async (tx) => {
      const found = await openLoan(tx, req.params.id!);
      const at = input.at ?? new Date();
      const updated = await tx.materialLoan.update({ where: { id: found.id }, data: { location: input.toLocation }, include: loanInclude });
      await tx.materialMovement.create({
        data: {
          itemId: found.itemId,
          loanId: found.id,
          kind: "MOVE",
          quantity: found.quantity - found.returnedQuantity,
          fromLocation: found.location,
          toLocation: input.toLocation,
          person: input.movedBy,
          at,
          notes: input.notes,
          recordedByName: req.user!.name,
        },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "material.move",
        entityType: "material",
        entityId: found.itemId,
        label: found.item.name,
        details: { from: found.location, to: input.toLocation, movedBy: input.movedBy },
      });
      return updated;
    });
    res.json({ loan });
  }),
);
