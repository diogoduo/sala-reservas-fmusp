import { describe, expect, it } from "vitest";
import { previewWeeklyDates } from "../../../frontend/src/lib/recurrence";
import { addDays } from "../../src/lib/calendar";
import { AppError } from "../../src/lib/errors";
import { zonedDateKey } from "../../src/lib/timezone";
import { reservedWindow } from "../../src/reservations/portaria";
import { expandRecurrence } from "../../src/reservations/recurrence";
import { requesterCreateSchema } from "../../src/schemas/reservation";
import { atTime, local } from "../dates";

const weekly = (days: string, interval = 1) => `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${days}`;
/** Fim do dia `dateKey` em São Paulo — é o "até" que o formulário manda. */
const endOfDay = (dateKey: string) => new Date(atTime(dateKey, "23:59").getTime() + 59_000);

function expectAppError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`esperava o erro ${code}`);
}

describe("expandRecurrence: o dia da semana é o de São Paulo", () => {
  it("quarta às 21:00 continua quarta (em UTC já é quinta)", () => {
    const start = atTime("2026-11-11", "21:00");
    expect(start.toISOString()).toBe("2026-11-12T00:00:00.000Z");

    const dates = expandRecurrence(weekly("WE"), start, atTime("2026-11-11", "22:00"), endOfDay("2026-12-09"));
    expect(dates.map((d) => local(d.start))).toEqual([
      "2026-11-11 21:00",
      "2026-11-18 21:00",
      "2026-11-25 21:00",
      "2026-12-02 21:00",
      "2026-12-09 21:00",
    ]);
    expect(dates.every((d) => d.end.getTime() - d.start.getTime() === 60 * 60_000)).toBe(true);
  });

  it("sábado às 23:00 continua sábado", () => {
    const dates = expandRecurrence(weekly("SA"), atTime("2026-11-07", "23:00"), atTime("2026-11-07", "23:45"), endOfDay("2026-11-21"));
    expect(dates.map((d) => local(d.start))).toEqual(["2026-11-07 23:00", "2026-11-14 23:00", "2026-11-21 23:00"]);
  });

  it("com montagem, a série começa antes e continua no mesmo dia", () => {
    // Aula de quinta às 21:30 com 30 min de montagem: a reserva começa às 21:00.
    const window = reservedWindow({ startTime: atTime("2026-11-05", "21:30"), endTime: atTime("2026-11-05", "22:30"), setupMinutes: 30 });
    const dates = expandRecurrence(weekly("TH"), window.start, window.end, endOfDay("2026-11-26"));
    expect(dates.map((d) => local(d.start))).toEqual(["2026-11-05 21:00", "2026-11-12 21:00", "2026-11-19 21:00", "2026-11-26 21:00"]);
    expect(dates.map((d) => local(d.end))).toEqual(["2026-11-05 22:30", "2026-11-12 22:30", "2026-11-19 22:30", "2026-11-26 22:30"]);
  });

  it("quinzenal (a cada 2 semanas), terça e sexta às 21:15", () => {
    const dates = expandRecurrence(weekly("TU,FR", 2), atTime("2026-11-10", "21:15"), atTime("2026-11-10", "22:00"), endOfDay("2026-12-31"));
    // Semanas começam na segunda: pula as semanas de 16/11, 30/11, 14/12 e 28/12.
    expect(dates.map((d) => zonedDateKey(d.start))).toEqual([
      "2026-11-10",
      "2026-11-13",
      "2026-11-24",
      "2026-11-27",
      "2026-12-08",
      "2026-12-11",
      "2026-12-22",
      "2026-12-25",
    ]);
  });

  it("acerta o horário em fuso com horário de verão (Nova York, março e novembro)", () => {
    const tz = "America/New_York";
    const at = (iso: string) => new Date(iso);
    const march = expandRecurrence(weekly("MO"), at("2026-03-02T21:00:00-05:00"), at("2026-03-02T22:00:00-05:00"), at("2026-03-23T23:59:00-04:00"), tz);
    const hour = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    expect(march.map((d) => hour(d.start))).toEqual(["Mon 21:00", "Mon 21:00", "Mon 21:00", "Mon 21:00"]);
    const november = expandRecurrence(weekly("MO"), at("2026-10-26T21:00:00-04:00"), at("2026-10-26T22:00:00-04:00"), at("2026-11-16T23:59:00-05:00"), tz);
    expect(november.map((d) => hour(d.start))).toEqual(["Mon 21:00", "Mon 21:00", "Mon 21:00", "Mon 21:00"]);
  });
});

describe("expandRecurrence: limites", () => {
  const start = atTime("2026-11-11", "10:00");
  const end = atTime("2026-11-11", "11:00");

  it("recusa série de mais de 1 ano", () => {
    expectAppError(() => expandRecurrence(weekly("WE"), start, end, endOfDay("2027-11-13")), "RECURRENCE_TOO_LONG");
  });

  it("aceita até 1 ano depois da primeira data", () => {
    expect(expandRecurrence(weekly("WE"), start, end, endOfDay("2027-11-10"))).toHaveLength(53);
  });

  it("sem data final, vai até 1 ano (e não estoura o limite)", () => {
    expect(expandRecurrence(weekly("WE"), start, end, null).length).toBeGreaterThanOrEqual(52);
  });

  it("recusa mais de 260 datas", () => {
    expectAppError(() => expandRecurrence(weekly("MO,TU,WE,TH,FR,SA,SU"), start, end, endOfDay("2027-10-01")), "TOO_MANY_OCCURRENCES");
  });

  it("recusa regra que não gera nenhuma data", () => {
    expectAppError(() => expandRecurrence(weekly("TH"), start, end, endOfDay("2026-11-11")), "INVALID_RRULE");
  });
});

describe("recorrência: back-end e prévia do formulário geram as mesmas datas", () => {
  const sets = ["WE", "TU,TH", "MO,WE,FR", "SA"];
  const times = ["07:00", "21:00", "21:45"];

  it("em ~3 mil combinações de início, intervalo (1 a 4 semanas), dias e horário", () => {
    let compared = 0;
    for (let offset = 0; offset < 730; offset += 11) {
      const startKey = addDays("2026-01-01", offset);
      const untilKey = addDays(startKey, 20 + ((offset * 7) % 340));
      for (const interval of [1, 2, 3, 4]) {
        for (const days of sets) {
          for (const time of times) {
            const start = atTime(startKey, time);
            let backend: string[];
            try {
              backend = expandRecurrence(weekly(days, interval), start, new Date(start.getTime() + 45 * 60_000), endOfDay(untilKey)).map((d) =>
                zonedDateKey(d.start),
              );
            } catch (error) {
              // Sem nenhuma data, o back-end recusa e a prévia fica vazia: também é concordar.
              if (error instanceof AppError && error.code === "INVALID_RRULE") backend = [];
              else throw error;
            }
            const preview = previewWeeklyDates(startKey, untilKey, new Set(days.split(",")), interval);
            expect(backend, `${startKey}..${untilKey} ${weekly(days, interval)} ${time}`).toEqual(preview);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(3000);
  });
});

describe("formato da regra aceito pela API", () => {
  const body = (rrule: string) => ({
    activityType: "ADMINISTRATIVE",
    description: "Reunião",
    termsAccepted: true,
    noAlcoholCommitment: true,
    startTime: "2026-11-11T10:00:00-03:00",
    endTime: "2026-11-11T11:00:00-03:00",
    details: { kind: "MEETING", meetingTitle: "Reunião", participantCount: 5, responsible: "Fulana", department: "SAD" },
    recurrence: { rrule, until: "2026-12-09T23:59:59-03:00" },
  });
  const rruleIssue = (rrule: string) => {
    const result = requesterCreateSchema.safeParse(body(rrule));
    return result.success ? null : result.error.issues.map((i) => i.path.join(".")).join(", ");
  };

  it("aceita o que o formulário gera", () => {
    expect(rruleIssue("FREQ=WEEKLY;INTERVAL=1;BYDAY=WE")).toBeNull();
    expect(rruleIssue("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR")).toBeNull();
    expect(rruleIssue("FREQ=WEEKLY;INTERVAL=4;BYDAY=MO,TU,WE,TH,FR,SA,SU")).toBeNull();
  });

  it.each([
    ["FREQ=SECONDLY;INTERVAL=1;BYDAY=WE"],
    ["FREQ=WEEKLY;INTERVAL=1;BYDAY=WE\nEXDATE:20261118T130000Z"],
    ["FREQ=WEEKLY;INTERVAL=5;BYDAY=WE"],
    ["FREQ=WEEKLY;INTERVAL=0;BYDAY=WE"],
    ["FREQ=WEEKLY;INTERVAL=1;BYDAY=WE,WE"],
    ["FREQ=WEEKLY;BYDAY=WE"],
    ["FREQ=WEEKLY;INTERVAL=1;BYDAY=WE;COUNT=1000"],
  ])("recusa %j", (rrule) => {
    expect(rruleIssue(rrule)).toBe("recurrence.rrule");
  });
});
