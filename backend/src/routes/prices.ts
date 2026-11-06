import { PriceUnit, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { diffFields, recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { uuidParam } from "../lib/params";
import { prisma } from "../lib/prisma";
import { zonedDateKey } from "../lib/timezone";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { priceTableOn, priceText } from "../prices/catalog";

// Fase 9, bloco 4 — Preços (Portaria 2794). Todos consultam (os valores são
// públicos, da portaria); só o SAD altera. O NUCEV vê a tela, sem editar.
// O reajuste anual é uma tabela nova, copiada da atual, com outra data de início:
// a anterior continua guardada para os orçamentos já emitidos.
export const pricesRouter = Router();
pricesRouter.param("id", uuidParam("PRICE_NOT_FOUND", "Tabela ou categoria de preço não encontrada."));

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (key: string) => new Date(`${key}T00:00:00Z`);

const tableInclude = { entries: { include: { category: { select: { name: true, unit: true } } } } } satisfies Prisma.PriceTableInclude;
type TableWithEntries = Prisma.PriceTableGetPayload<{ include: typeof tableInclude }>;

const serializeTable = (t: TableWithEntries) => ({
  ...t,
  validFrom: dateOnly(t.validFrom),
  entries: t.entries.map(({ category: _category, ...entry }) => entry),
});

/** O que o Histórico compara: as regras e o valor de cada categoria, em texto. */
function tableSnapshot(t: TableWithEntries) {
  return {
    name: t.name,
    validFrom: dateOnly(t.validFrom),
    minimumHours: t.minimumHours,
    prepHoursBefore: t.prepHoursBefore,
    prepHoursAfter: t.prepHoursAfter,
    coffeeSurchargePercent: t.coffeeSurchargePercent,
    institutionalDiscountPercent: t.institutionalDiscountPercent,
    notes: t.notes,
    ...Object.fromEntries(t.entries.map((e) => [e.category.name, priceText(e.amountCents, e.category.unit)])),
  };
}

pricesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [categories, tables, current] = await Promise.all([
      prisma.priceCategory.findMany({
        orderBy: [{ position: "asc" }, { name: "asc" }],
        include: { rooms: { select: { id: true, name: true, building: true, floor: true, status: true }, orderBy: { name: "asc" } } },
      }),
      prisma.priceTable.findMany({ orderBy: { validFrom: "desc" }, include: tableInclude }),
      priceTableOn(prisma),
    ]);
    res.json({ categories, tables: tables.map(serializeTable), currentTableId: current?.id ?? null });
  }),
);

const rules = {
  name: z.string().trim().min(2, "Informe o nome da tabela.").max(120),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de início."),
  minimumHours: z.number().int().min(0).max(24),
  prepHoursBefore: z.number().int().min(0).max(12),
  prepHoursAfter: z.number().int().min(0).max(12),
  coffeeSurchargePercent: z.number().int().min(0).max(100),
  institutionalDiscountPercent: z.number().int().min(0).max(100),
  notes: z.string().trim().max(2000).nullish().transform((v) => v || null),
};

const updateTableSchema = z.object(rules).partial().extend({
  entries: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        // Em centavos; null = a definir.
        amountCents: z.number().int().min(0).max(100_000_000).nullable(),
      }),
    )
    .max(200)
    .optional(),
});

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const DUPLICATE_DATE = new AppError(409, "PRICE_TABLE_DATE_TAKEN", "Já existe uma tabela de preços com essa data de início.");

pricesRouter.patch(
  "/tables/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { entries, validFrom, ...fields } = updateTableSchema.parse(req.body);
    try {
      const table = await prisma.$transaction(async (tx) => {
        const before = await tx.priceTable.findUnique({ where: { id: req.params.id }, include: tableInclude });
        if (!before) throw new AppError(404, "PRICE_NOT_FOUND", "Tabela de preços não encontrada.");
        await tx.priceTable.update({ where: { id: before.id }, data: { ...fields, ...(validFrom && { validFrom: toDate(validFrom) }) } });
        for (const entry of entries ?? []) {
          await tx.priceEntry.upsert({
            where: { tableId_categoryId: { tableId: before.id, categoryId: entry.categoryId } },
            update: { amountCents: entry.amountCents },
            create: { tableId: before.id, categoryId: entry.categoryId, amountCents: entry.amountCents },
          });
        }
        const after = await tx.priceTable.findUniqueOrThrow({ where: { id: before.id }, include: tableInclude });
        const changes = diffFields(tableSnapshot(before), tableSnapshot(after));
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, { actor: req.user!, action: "price.table_update", entityType: "price", entityId: after.id, label: after.name, changes });
        }
        return after;
      });
      res.json({ table: serializeTable(table) });
    } catch (error) {
      if (isUniqueViolation(error)) throw DUPLICATE_DATE;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new AppError(400, "PRICE_CATEGORY_NOT_FOUND", "Categoria de preço não encontrada.");
      }
      throw error;
    }
  }),
);

const createTableSchema = z.object({
  copyFromId: z.string().uuid(),
  name: rules.name,
  validFrom: rules.validFrom,
});

/** Reajuste: tabela nova copiada de outra (regras e valores), a partir de uma data. */
pricesRouter.post(
  "/tables",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createTableSchema.parse(req.body);
    try {
      const table = await prisma.$transaction(async (tx) => {
        const source = await tx.priceTable.findUnique({ where: { id: input.copyFromId }, include: { entries: true } });
        if (!source) throw new AppError(404, "PRICE_NOT_FOUND", "Tabela de preços não encontrada.");
        const created = await tx.priceTable.create({
          data: {
            name: input.name,
            validFrom: toDate(input.validFrom),
            minimumHours: source.minimumHours,
            prepHoursBefore: source.prepHoursBefore,
            prepHoursAfter: source.prepHoursAfter,
            coffeeSurchargePercent: source.coffeeSurchargePercent,
            institutionalDiscountPercent: source.institutionalDiscountPercent,
            notes: source.notes,
            entries: { create: source.entries.map((e) => ({ categoryId: e.categoryId, amountCents: e.amountCents })) },
          },
          include: tableInclude,
        });
        await recordAudit(tx, {
          actor: req.user!,
          action: "price.table_create",
          entityType: "price",
          entityId: created.id,
          label: created.name,
          details: { validFrom: input.validFrom, copiedFrom: source.name },
        });
        return created;
      });
      res.status(201).json({ table: serializeTable(table) });
    } catch (error) {
      if (isUniqueViolation(error)) throw DUPLICATE_DATE;
      throw error;
    }
  }),
);

/** Só uma tabela que ainda não começou a valer (ex.: reajuste criado por engano). */
pricesRouter.delete(
  "/tables/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const table = await tx.priceTable.findUnique({ where: { id: req.params.id } });
      if (!table) throw new AppError(404, "PRICE_NOT_FOUND", "Tabela de preços não encontrada.");
      if (dateOnly(table.validFrom) <= zonedDateKey(new Date())) {
        throw new AppError(409, "PRICE_TABLE_IN_FORCE", "Esta tabela já começou a valer: ela fica guardada. Para mudar valores, crie uma tabela nova.");
      }
      await tx.priceTable.delete({ where: { id: table.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "price.table_delete",
        entityType: "price",
        entityId: table.id,
        label: table.name,
        details: { validFrom: dateOnly(table.validFrom) },
      });
    });
    res.status(204).end();
  }),
);

const categoryFields = {
  name: z.string().trim().min(2, "Informe o nome da categoria.").max(120),
  unit: z.nativeEnum(PriceUnit),
  didactic: z.boolean(),
};

pricesRouter.post(
  "/categories",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = z.object(categoryFields).parse(req.body);
    try {
      const category = await prisma.$transaction(async (tx) => {
        const last = await tx.priceCategory.aggregate({ _max: { position: true } });
        const created = await tx.priceCategory.create({ data: { ...input, position: (last._max.position ?? 0) + 1 } });
        await recordAudit(tx, {
          actor: req.user!,
          action: "price.category_create",
          entityType: "price",
          entityId: created.id,
          label: created.name,
          details: { unit: created.unit, didactic: created.didactic },
        });
        return created;
      });
      res.status(201).json({ category });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, "PRICE_CATEGORY_EXISTS", "Já existe uma categoria com esse nome.");
      throw error;
    }
  }),
);

pricesRouter.patch(
  "/categories/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = z.object(categoryFields).partial().parse(req.body);
    try {
      const category = await prisma.$transaction(async (tx) => {
        const before = await tx.priceCategory.findUnique({ where: { id: req.params.id } });
        if (!before) throw new AppError(404, "PRICE_NOT_FOUND", "Categoria de preço não encontrada.");
        const after = await tx.priceCategory.update({ where: { id: before.id }, data: input });
        const changes = diffFields(before, after, ["name", "unit", "didactic"]);
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, { actor: req.user!, action: "price.category_update", entityType: "price", entityId: after.id, label: after.name, changes });
        }
        return after;
      });
      res.json({ category });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, "PRICE_CATEGORY_EXISTS", "Já existe uma categoria com esse nome.");
      throw error;
    }
  }),
);
