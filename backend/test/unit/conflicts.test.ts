import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isOverlapViolation, overlaps } from "../../src/reservations/conflicts";
import { atTime } from "../dates";

const at = (from: string, to: string) => ({ start: atTime("2026-11-19", from), end: atTime("2026-11-19", to) });

describe("conflito de horário: intervalo [início, fim), como a exclusion constraint", () => {
  it("sobreposição parcial ou total conflita", () => {
    expect(overlaps(at("10:00", "12:00"), at("11:00", "13:00"))).toBe(true);
    expect(overlaps(at("10:00", "12:00"), at("10:30", "11:00"))).toBe(true);
    expect(overlaps(at("10:30", "11:00"), at("10:00", "12:00"))).toBe(true);
    expect(overlaps(at("10:00", "12:00"), at("10:00", "12:00"))).toBe(true);
  });

  it("uma pode começar exatamente quando a outra termina", () => {
    expect(overlaps(at("10:00", "12:00"), at("12:00", "13:00"))).toBe(false);
    expect(overlaps(at("12:00", "13:00"), at("10:00", "12:00"))).toBe(false);
  });

  it("reconhece a violação da exclusion constraint (23P01) vinda do Prisma", () => {
    const violation = new Prisma.PrismaClientUnknownRequestError("violates exclusion constraint (SQLSTATE 23P01)", {
      clientVersion: Prisma.prismaVersion.client,
    });
    expect(isOverlapViolation(violation)).toBe(true);
    expect(isOverlapViolation(new Error("23P01"))).toBe(false);
  });
});
