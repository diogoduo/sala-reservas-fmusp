import type { PriceUnit } from "@prisma/client";

// Fase 10 — orçamento de locação pela Portaria 2794. Função pura: recebe os
// espaços (com o valor da tabela que vale na data do evento), os dias de uso e as
// regras da tabela, e devolve cada linha e o total. Quem chama resolve preços e
// datas; aqui ficam só as contas, cada regra com o seu teste
// (test/unit/quote.test.ts).
//
//  - Espaço didático por hora (Art. 2º): em cada dia, as horas de uso, com a
//    cobrança mínima, mais as horas de preparação antes e depois (§1º).
//  - Área de apoio por hora (Art. 3º): as horas de uso, já com montagem e
//    desmontagem (§1º); sem mínimo e sem preparação.
//  - Área de apoio por dia: um valor por dia de uso.
//  - Pernoite (Art. 3º §2º): não conta, porque cada dia é cobrado só no
//    intervalo em que o espaço é usado.
//  - Coffee break na própria sala de aula (Art. 5º §2º): adicional sobre o valor da sala.
//  - Desconto institucional (Art. 4º III): sobre o total, sem somar com outros.
//  - Isenção (Art. 4º I e II): marcada por quem analisa, com o motivo; zera o total.
//  - Valor a definir: a linha fica sem valor e o total sai como parcial.

export interface QuoteRules {
  minimumHours: number;
  prepHoursBefore: number;
  prepHoursAfter: number;
  coffeeSurchargePercent: number;
  institutionalDiscountPercent: number;
}

/** Uso do espaço num dia, já com a montagem e a desmontagem do evento. */
export interface QuoteDay {
  start: Date;
  end: Date;
}

export interface QuoteItemInput {
  /** "Salas de aula e salas de reunião" ou o nome da sala. */
  label: string;
  categoryName: string;
  unit: PriceUnit;
  didactic: boolean;
  /** Em centavos; null = a definir. */
  rateCents: number | null;
  /** Quantos espaços iguais (ex.: 10 salas). */
  count: number;
  days: QuoteDay[];
  /** Coffee break na própria sala (Art. 5º §2º). Só vale em espaço por hora. */
  coffeeInRoom: boolean;
}

export interface QuoteInput {
  items: QuoteItemInput[];
  rules: QuoteRules;
  /** Unidade do Sistema FMUSP/HC, USP, SES ou Instituto Adolfo Lutz (Art. 4º III). */
  institutional: boolean;
  /** Motivo da isenção (Art. 4º I e II); sem motivo = não é isento. */
  exemptionReason?: string | null;
}

export interface QuoteLineDay {
  /** Horas de uso no dia (por hora) ou 1 (por dia). */
  usedHours: number;
  /** Horas cobradas no dia: com o mínimo e a preparação, nos espaços didáticos. */
  billedHours: number;
}

export interface QuoteLine {
  label: string;
  categoryName: string;
  unit: PriceUnit;
  didactic: boolean;
  rateCents: number | null;
  count: number;
  days: QuoteLineDay[];
  /** Por espaço: horas cobradas no total (por hora) ou número de dias (por dia). */
  quantity: number;
  coffeeInRoom: boolean;
  /** Valor × quantidade × espaços, sem o adicional. null = a definir. */
  baseCents: number | null;
  surchargeCents: number | null;
  subtotalCents: number | null;
}

export interface QuoteResult {
  lines: QuoteLine[];
  /** Soma das linhas com valor (com os adicionais). */
  subtotalCents: number;
  discountPercent: number;
  discountCents: number;
  totalCents: number;
  /** Alguma linha está a definir: o total é parcial. */
  hasUndefined: boolean;
  exempt: boolean;
  exemptionReason: string | null;
}

const HOUR_MS = 3_600_000;
/** Horas com até 2 casas (montagem em múltiplos de 15 min dá horas exatas: 2,25 h). */
const hours = (ms: number) => Math.round((ms / HOUR_MS) * 100) / 100;

function lineFor(item: QuoteItemInput, rules: QuoteRules): QuoteLine {
  const days: QuoteLineDay[] = item.days.map(({ start, end }) => {
    const used = hours(Math.max(0, end.getTime() - start.getTime()));
    if (item.unit === "DAY") return { usedHours: used, billedHours: 0 };
    if (!item.didactic) return { usedHours: used, billedHours: used };
    return { usedHours: used, billedHours: Math.max(used, rules.minimumHours) + rules.prepHoursBefore + rules.prepHoursAfter };
  });
  const quantity = item.unit === "DAY" ? days.length : Math.round(days.reduce((sum, d) => sum + d.billedHours, 0) * 100) / 100;
  const coffeeInRoom = item.coffeeInRoom && item.unit === "HOUR";

  if (item.rateCents === null) {
    return { ...item, coffeeInRoom, days, quantity, baseCents: null, surchargeCents: null, subtotalCents: null };
  }
  const baseCents = Math.round(item.rateCents * quantity * item.count);
  const surchargeCents = coffeeInRoom ? Math.round((baseCents * rules.coffeeSurchargePercent) / 100) : 0;
  return { ...item, coffeeInRoom, days, quantity, baseCents, surchargeCents, subtotalCents: baseCents + surchargeCents };
}

export function calculateQuote(input: QuoteInput): QuoteResult {
  const lines = input.items.map((item) => lineFor(item, input.rules));
  const subtotalCents = lines.reduce((sum, l) => sum + (l.subtotalCents ?? 0), 0);
  const exemptionReason = input.exemptionReason?.trim() || null;
  const exempt = exemptionReason !== null;
  // A isenção não soma com o desconto: com isenção, o total é zero.
  const discountPercent = !exempt && input.institutional ? input.rules.institutionalDiscountPercent : 0;
  const discountCents = Math.round((subtotalCents * discountPercent) / 100);
  return {
    lines,
    subtotalCents,
    discountPercent,
    discountCents,
    totalCents: exempt ? 0 : subtotalCents - discountCents,
    hasUndefined: lines.some((l) => l.subtotalCents === null),
    exempt,
    exemptionReason,
  };
}
