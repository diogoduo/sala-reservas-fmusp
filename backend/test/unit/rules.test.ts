import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors";
import { reservedWindow, withoutHolidays } from "../../src/reservations/portaria";
import {
  assertMinAdvance,
  assertRegularSchedule,
  assertValidDuration,
  isExtraordinarySchedule,
  isWithinRequesterDeadline,
  regularScheduleIssue,
} from "../../src/reservations/rules";
import { atTime } from "../dates";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : "erro inesperado";
  }
};
const slot = (day: string, from: string, to: string) => [atTime(day, from), atTime(day, to)] as const;

describe("horário regular (Portaria 2793, Art. 6º)", () => {
  it("dia útil e sábado, das 07h às 22h", () => {
    expect(regularScheduleIssue(...slot("2026-11-19", "07:00", "08:00"))).toBeNull();
    expect(regularScheduleIssue(...slot("2026-11-19", "21:00", "22:00"))).toBeNull();
    expect(regularScheduleIssue(...slot("2026-11-14", "10:00", "12:00"))).toBeNull(); // sábado
  });

  it("domingo, feriado e fora das 07h–22h", () => {
    expect(regularScheduleIssue(...slot("2026-11-22", "10:00", "12:00"))).toBe("22/11 é domingo");
    expect(regularScheduleIssue(...slot("2026-11-20", "10:00", "12:00"))).toBe("20/11 é feriado ou ponto facultativo (Dia da Consciência Negra)");
    expect(regularScheduleIssue(...slot("2026-11-19", "06:30", "08:00"))).toMatch(/07h às 22h/);
    expect(regularScheduleIssue(...slot("2026-11-19", "21:00", "22:15"))).toMatch(/07h às 22h/);
  });

  it("o solicitante é barrado; o SAD só fica marcado como extraordinário", () => {
    expect(codeOf(() => assertRegularSchedule(...slot("2026-11-22", "10:00", "12:00")))).toBe("OUTSIDE_BUSINESS_HOURS");
    expect(codeOf(() => assertRegularSchedule(...slot("2026-11-19", "10:00", "12:00")))).toBeNull();
    expect(isExtraordinarySchedule(...slot("2026-11-22", "10:00", "12:00"))).toBe(true);
    expect(isExtraordinarySchedule(...slot("2026-11-19", "10:00", "12:00"))).toBe(false);
  });

  it("não atravessa a meia-noite (nem para o SAD)", () => {
    const start = atTime("2026-11-19", "23:00");
    const end = atTime("2026-11-20", "00:30");
    expect(codeOf(() => assertRegularSchedule(start, end))).toBe("OUTSIDE_BUSINESS_HOURS");
    expect(codeOf(() => isExtraordinarySchedule(start, end))).toBe("OUTSIDE_BUSINESS_HOURS");
  });
});

describe("duração e antecedência", () => {
  const start = atTime("2026-11-19", "10:00");
  const plus = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

  it("de 30 minutos a 15 horas", () => {
    expect(codeOf(() => assertValidDuration(start, start))).toBe("INVALID_TIME_RANGE");
    expect(codeOf(() => assertValidDuration(start, plus(29)))).toBe("DURATION_OUT_OF_RANGE");
    expect(codeOf(() => assertValidDuration(start, plus(30)))).toBeNull();
    expect(codeOf(() => assertValidDuration(start, plus(15 * 60)))).toBeNull();
    expect(codeOf(() => assertValidDuration(start, plus(15 * 60 + 1)))).toBe("DURATION_OUT_OF_RANGE");
  });

  it("pedido com no mínimo 72 horas de antecedência", () => {
    const now = new Date(start.getTime() - 72 * 3_600_000);
    expect(codeOf(() => assertMinAdvance(start, now))).toBeNull();
    expect(codeOf(() => assertMinAdvance(start, new Date(now.getTime() + 60_000)))).toBe("BOOKING_TOO_SOON");
  });

  it("alterar ou cancelar: até o 3º dia útil antes, pelo dia de São Paulo", () => {
    const thursday = atTime("2026-11-12", "10:00");
    // Segunda 23:30 em São Paulo (terça 02:30 em UTC) ainda está no prazo.
    expect(isWithinRequesterDeadline(thursday, atTime("2026-11-09", "23:30"))).toBe(true);
    expect(isWithinRequesterDeadline(thursday, atTime("2026-11-10", "00:30"))).toBe(false);
  });
});

describe("montagem e feriados na série", () => {
  it("a montagem entra antes do início (Art. 19)", () => {
    const window = reservedWindow({ startTime: atTime("2026-11-19", "14:00"), endTime: atTime("2026-11-19", "16:00"), setupMinutes: 90 });
    expect(window.start).toEqual(atTime("2026-11-19", "12:30"));
    expect(window.end).toEqual(atTime("2026-11-19", "16:00"));
  });

  it("datas em feriado saem da série", () => {
    const occ = (day: string) => ({ start: atTime(day, "10:00"), end: atTime(day, "11:00") });
    const { kept, skipped } = withoutHolidays([occ("2026-11-13"), occ("2026-11-20"), occ("2026-11-27")]);
    expect(kept).toEqual([occ("2026-11-13"), occ("2026-11-27")]);
    expect(skipped).toEqual([{ date: "2026-11-20", holiday: "Dia da Consciência Negra" }]);
    expect(codeOf(() => withoutHolidays([occ("2026-11-20")]))).toBe("ONLY_HOLIDAYS");
  });
});
