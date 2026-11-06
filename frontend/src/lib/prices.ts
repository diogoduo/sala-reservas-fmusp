import type { PriceUnit, RoomPrice } from "./types";

// Fase 9, bloco 4 — valores da Portaria 2794 em texto.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = { HOUR: "por hora", DAY: "por dia" };

/** "R$ 375,00" */
export const formatMoney = (cents: number) => brl.format(cents / 100);

/** "R$ 375,00/hora" ou "A definir". */
export function priceText(amountCents: number | null | undefined, unit: PriceUnit): string {
  if (amountCents === null || amountCents === undefined) return "A definir";
  return `${formatMoney(amountCents)}/${unit === "HOUR" ? "hora" : "dia"}`;
}

/** O valor de um espaço, ou "A definir" quando não tem categoria ou valor. */
export const roomPriceText = (price: RoomPrice | null) => (price ? priceText(price.amountCents, price.unit) : "A definir");

/** Centavos → "375,00" (campo de edição). */
export const centsToInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

/** "375", "375,5", "1.500,00" → centavos; "" → null (a definir); inválido → undefined. */
export function inputToCents(value: string): number | null | undefined {
  const text = value.trim();
  if (text === "") return null;
  const normalized = text.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  return Math.round(Number(normalized) * 100);
}

/** "02/06/2026" */
export const formatDateKey = (key: string) => key.split("-").reverse().join("/");
