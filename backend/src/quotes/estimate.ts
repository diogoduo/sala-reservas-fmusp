import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { zonedTime } from "../lib/timezone";
import { priceTableOn } from "../prices/catalog";
import { calculateQuote, type QuoteDay, type QuoteItemInput } from "./engine";

// Fase 10 — estimativa de orçamento: resolve espaços e datas e chama o motor.
// O formulário de evento (Fase 11) e o simulador da tela Preços usam isto; o
// orçamento emitido ao solicitante (Fase 12) guarda o resultado numa versão.

type Db = PrismaClient | Prisma.TransactionClient;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido.");

export const quoteDaySchema = z
  .object({ date: dateKey, start: time, end: time })
  .refine((d) => d.end > d.start, { message: "O término precisa ser depois do início.", path: ["end"] });

export const estimateSchema = z.object({
  /** Dias do evento; cada espaço pode ter os seus (`items[].days`). */
  days: z.array(quoteDaySchema).min(1, "Informe ao menos um dia.").max(60),
  items: z
    .array(
      z
        .object({
          categoryId: z.string().uuid().optional(),
          roomId: z.string().uuid().optional(),
          count: z.number().int().min(1).max(200).default(1),
          coffeeInRoom: z.boolean().default(false),
          days: z.array(quoteDaySchema).min(1).max(60).optional(),
        })
        .refine((i) => Boolean(i.categoryId) !== Boolean(i.roomId), { message: "Escolha uma categoria ou uma sala." }),
    )
    .min(1, "Escolha ao menos um espaço.")
    .max(100),
  institutional: z.boolean().default(false),
  exemptionReason: z.string().trim().max(500).optional(),
});

export type EstimateInput = z.infer<typeof estimateSchema>;
type QuoteDayInput = z.infer<typeof quoteDaySchema>;

const toQuoteDays = (days: QuoteDayInput[]): QuoteDay[] =>
  days.map((d) => ({ start: zonedTime(d.date, d.start), end: zonedTime(d.date, d.end) }));

export async function estimateQuote(db: Db, input: EstimateInput) {
  // A tabela que vale no primeiro dia do evento.
  const firstDay = [...input.days, ...input.items.flatMap((i) => i.days ?? [])].map((d) => d.date).sort()[0]!;
  const table = await priceTableOn(db, zonedTime(firstDay, "12:00"));
  if (!table) throw new AppError(409, "NO_PRICE_TABLE", "Não há tabela de preços valendo na data do evento.");

  const categoryIds = input.items.flatMap((i) => (i.categoryId ? [i.categoryId] : []));
  const roomIds = input.items.flatMap((i) => (i.roomId ? [i.roomId] : []));
  const [categories, rooms] = await Promise.all([
    db.priceCategory.findMany({ where: { id: { in: categoryIds } } }),
    db.room.findMany({ where: { id: { in: roomIds } }, include: { priceCategory: true } }),
  ]);
  const rate = (categoryId: string | null | undefined) =>
    categoryId ? (table.entries.find((e) => e.categoryId === categoryId)?.amountCents ?? null) : null;

  const items: QuoteItemInput[] = input.items.map((item) => {
    const days = toQuoteDays(item.days ?? input.days);
    if (item.roomId) {
      const room = rooms.find((r) => r.id === item.roomId);
      if (!room) throw new AppError(400, "ROOM_NOT_FOUND", "Sala não encontrada.");
      const category = room.priceCategory;
      return {
        label: room.name,
        categoryName: category?.name ?? "Sem categoria de preço",
        unit: category?.unit ?? "HOUR",
        didactic: category?.didactic ?? false,
        rateCents: rate(category?.id),
        count: item.count,
        days,
        // Art. 5º: coffee na própria sala, só nas salas de aula que permitem.
        coffeeInRoom: item.coffeeInRoom && room.roomType === "CLASSROOM" && room.coffeeAllowed,
      };
    }
    const category = categories.find((c) => c.id === item.categoryId);
    if (!category) throw new AppError(400, "PRICE_CATEGORY_NOT_FOUND", "Categoria de preço não encontrada.");
    return {
      label: category.name,
      categoryName: category.name,
      unit: category.unit,
      didactic: category.didactic,
      rateCents: rate(category.id),
      count: item.count,
      days,
      coffeeInRoom: false,
    };
  });

  const rules = {
    minimumHours: table.minimumHours,
    prepHoursBefore: table.prepHoursBefore,
    prepHoursAfter: table.prepHoursAfter,
    coffeeSurchargePercent: table.coffeeSurchargePercent,
    institutionalDiscountPercent: table.institutionalDiscountPercent,
  };
  const quote = calculateQuote({ items, rules, institutional: input.institutional, exemptionReason: input.exemptionReason });
  return {
    quote,
    table: { id: table.id, name: table.name, validFrom: table.validFrom.toISOString().slice(0, 10) },
    rules,
  };
}
