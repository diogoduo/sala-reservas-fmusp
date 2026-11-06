import { describe, expect, it } from "vitest";
import { calculateQuote, type QuoteItemInput, type QuoteRules } from "../../src/quotes/engine";
import { atTime } from "../dates";

// Portaria 2794: cada regra do orçamento com um caso.
const RULES: QuoteRules = { minimumHours: 2, prepHoursBefore: 1, prepHoursAfter: 1, coffeeSurchargePercent: 20, institutionalDiscountPercent: 25 };

const day = (date: string, from: string, to: string) => ({ start: atTime(date, from), end: atTime(date, to) });
const sala = (extra: Partial<QuoteItemInput> = {}): QuoteItemInput => ({
  label: "Salas de aula e salas de reunião",
  categoryName: "Salas de aula e salas de reunião",
  unit: "HOUR",
  didactic: true,
  rateCents: 12500,
  count: 1,
  days: [day("2026-12-01", "08:00", "18:00")],
  coffeeInRoom: false,
  ...extra,
});

describe("orçamento da Portaria 2794 (calculateQuote)", () => {
  it("espaço didático: horas de uso + 1 h antes + 1 h depois (Art. 2º §1º)", () => {
    const q = calculateQuote({ items: [sala()], rules: RULES, institutional: false });
    expect(q.lines[0]).toMatchObject({ quantity: 12, baseCents: 150_000, subtotalCents: 150_000 });
    expect(q.totalCents).toBe(150_000);
  });

  it("cobrança mínima de 2 h antes da preparação (Art. 2º)", () => {
    const q = calculateQuote({ items: [sala({ days: [day("2026-12-01", "10:00", "11:00")] })], rules: RULES, institutional: false });
    // 1 h vira 2 h, mais 2 h de preparação.
    expect(q.lines[0]!.days[0]).toEqual({ usedHours: 1, billedHours: 4 });
    expect(q.totalCents).toBe(4 * 12500);
  });

  it("vários dias: preparação em cada dia; o pernoite não é cobrado (Art. 3º §2º)", () => {
    const days = [day("2026-12-01", "08:00", "18:00"), day("2026-12-02", "08:00", "12:00")];
    const q = calculateQuote({ items: [sala({ days })], rules: RULES, institutional: false });
    expect(q.lines[0]!.quantity).toBe(12 + 6);
  });

  it("o exemplo do documento: 10 salas grandes e 3 pequenas, um dia de 10 h, com desconto institucional", () => {
    const items = [sala({ label: "Salas para 90", count: 10 }), sala({ label: "Salas para 50", count: 3 })];
    const q = calculateQuote({ items, rules: RULES, institutional: true });
    expect(q.lines.map((l) => l.subtotalCents)).toEqual([1_500_000, 450_000]);
    expect(q.subtotalCents).toBe(1_950_000);
    expect(q.discountCents).toBe(487_500);
    expect(q.totalCents).toBe(1_462_500);
  });

  it("área de apoio por hora: sem mínimo e sem preparação (Art. 3º)", () => {
    const atrio = sala({ label: "Átrio", categoryName: "Átrio (por átrio)", didactic: false, rateCents: 150_000, days: [day("2026-12-01", "09:00", "10:30")] });
    const q = calculateQuote({ items: [atrio], rules: RULES, institutional: false });
    expect(q.lines[0]).toMatchObject({ quantity: 1.5, subtotalCents: 225_000 });
  });

  it("área de apoio por dia: um valor por dia de uso", () => {
    const foyer = sala({ label: "Foyer", categoryName: "Foyer do Teatro", unit: "DAY", didactic: false, rateCents: 50_000, days: [day("2026-12-01", "08:00", "20:00"), day("2026-12-02", "08:00", "12:00")] });
    const q = calculateQuote({ items: [foyer], rules: RULES, institutional: false });
    expect(q.lines[0]).toMatchObject({ quantity: 2, subtotalCents: 100_000 });
  });

  it("coffee break na própria sala de aula: +20% sobre o valor da sala (Art. 5º §2º)", () => {
    const q = calculateQuote({ items: [sala({ label: "Sala de Aula 2366", coffeeInRoom: true })], rules: RULES, institutional: false });
    expect(q.lines[0]).toMatchObject({ baseCents: 150_000, surchargeCents: 30_000, subtotalCents: 180_000 });
  });

  it("isenção zera o total e não soma com o desconto (Art. 4º)", () => {
    const q = calculateQuote({ items: [sala()], rules: RULES, institutional: true, exemptionReason: "Evento institucional da FMUSP, sem inscrição" });
    expect(q).toMatchObject({ exempt: true, discountCents: 0, totalCents: 0, subtotalCents: 150_000 });
  });

  it("valor a definir: a linha fica sem valor e o total é parcial", () => {
    const nina = sala({ label: "Hall do NINA", categoryName: "Hall do NINA", unit: "DAY", didactic: false, rateCents: null });
    const q = calculateQuote({ items: [sala(), nina], rules: RULES, institutional: false });
    expect(q.lines[1]!.subtotalCents).toBeNull();
    expect(q).toMatchObject({ hasUndefined: true, totalCents: 150_000 });
  });
});
