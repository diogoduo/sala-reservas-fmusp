import type { Prisma, PrismaClient, PriceUnit, RoomType } from "@prisma/client";
import { zonedDateKey } from "../lib/timezone";

// Fase 9, bloco 4 — preços da Portaria 2794. As categorias e a primeira tabela
// entram pela migration price_tables; aqui ficam a categoria padrão de um espaço
// novo, a tabela vigente e o formato dos valores.

type Db = PrismaClient | Prisma.TransactionClient;

/** Mesma regra da migration: pelo tipo do espaço ou, nas áreas de apoio, pelo nome. */
export function defaultPriceCategoryName(room: { roomType: RoomType; name: string }): string | null {
  switch (room.roomType) {
    case "THEATER":
      return "Teatro da FMUSP";
    case "AUDITORIUM":
      return "Anfiteatros";
    case "SUPPORT_AREA":
      break;
    default:
      return "Salas de aula e salas de reunião";
  }
  const byName: [RegExp, string][] = [
    [/^Átrio/i, "Átrio (por átrio)"],
    [/^Hall de transição/i, "Hall de transição – 4º andar"],
    [/^(Hall|Foyer) do Teatro/i, "Foyer do Teatro"],
    [/^Hall do NINA/i, "Hall do NINA"],
    [/^Copa do 5º/i, "Copa – 5º andar"],
    [/^Copa do Teatro/i, "Copa do Teatro"],
    [/^Área de coffee do 5º/i, "Área de coffee do 5º andar"],
  ];
  return byName.find(([pattern]) => pattern.test(room.name))?.[1] ?? null;
}

/** Id da categoria padrão, se ela existir no banco (num banco de teste vazio, não existe). */
export async function defaultPriceCategoryId(db: Db, room: { roomType: RoomType; name: string }): Promise<string | null> {
  const name = defaultPriceCategoryName(room);
  if (!name) return null;
  return (await db.priceCategory.findUnique({ where: { name }, select: { id: true } }))?.id ?? null;
}

/** A tabela que vale num dia: a de vigência mais recente que já começou. */
export function priceTableOn(db: Db, at: Date = new Date()) {
  return db.priceTable.findFirst({
    where: { validFrom: { lte: new Date(`${zonedDateKey(at)}T00:00:00Z`) } },
    orderBy: { validFrom: "desc" },
    include: { entries: true },
  });
}

export type PriceTableWithEntries = NonNullable<Awaited<ReturnType<typeof priceTableOn>>>;

/** O preço de um espaço na tabela: nulo quando o espaço não tem categoria. */
export interface RoomPrice {
  categoryId: string;
  categoryName: string;
  unit: PriceUnit;
  didactic: boolean;
  /** Em centavos; nulo = a definir. */
  amountCents: number | null;
  tableName: string | null;
  validFrom: string | null;
}

export function roomPrice(
  room: { priceCategory: { id: string; name: string; unit: PriceUnit; didactic: boolean } | null },
  table: PriceTableWithEntries | null,
): RoomPrice | null {
  const category = room.priceCategory;
  if (!category) return null;
  const entry = table?.entries.find((e) => e.categoryId === category.id);
  return {
    categoryId: category.id,
    categoryName: category.name,
    unit: category.unit,
    didactic: category.didactic,
    amountCents: entry?.amountCents ?? null,
    tableName: table?.name ?? null,
    validFrom: table ? table.validFrom.toISOString().slice(0, 10) : null,
  };
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 375,00/hora" ou "a definir" (para o Histórico). */
export function priceText(amountCents: number | null | undefined, unit: PriceUnit): string {
  if (amountCents === null || amountCents === undefined) return "a definir";
  return `${brl.format(amountCents / 100)}/${unit === "HOUR" ? "hora" : "dia"}`;
}
