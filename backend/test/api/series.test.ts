import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previewWeeklyDates } from "../../../frontend/src/lib/recurrence";
import { createApp } from "../../src/app";
import { addDays, holidayName } from "../../src/lib/calendar";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey } from "../../src/lib/timezone";
import { atTime, local, upcoming } from "../dates";
import { createUser, loginAs, resetDatabase, undergraduateRequest } from "./helpers";

const app = createApp();

interface CreatedReservation {
  id: string;
  protocol: string;
  seriesId: string | null;
  status: string;
  roomId: string | null;
  startTime: string;
  endTime: string;
}

beforeAll(async () => {
  await resetDatabase();
  await createUser("aluno@usp.br");
});

afterAll(() => prisma.$disconnect());

/** O que a prévia do formulário mostra, sem os feriados (que o back-end tira da série). */
const expectedDates = (startKey: string, untilKey: string, days: string, interval: number) =>
  previewWeeklyDates(startKey, untilKey, new Set(days.split(",")), interval).filter((key) => !holidayName(key));
const counts = async () => ({ series: await prisma.reservationSeries.count(), reservations: await prisma.reservation.count() });

describe("criação de série pelo solicitante", () => {
  it("quarta às 21:00: todas as datas na quarta, numa série só, com um protocolo", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    const start = upcoming(3, 7, "21:00");
    const startKey = zonedDateKey(start);
    const untilKey = addDays(startKey, 28);

    const res = await aluno
      .post("/api/reservations")
      .send(
        undergraduateRequest("Quarta à noite", start, new Date(start.getTime() + 60 * 60_000), {
          recurrence: { rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=WE", until: atTime(untilKey, "23:59").toISOString() },
        }),
      )
      .expect(201);

    const created: CreatedReservation[] = res.body.reservations;
    expect(created.map((r) => zonedDateKey(new Date(r.startTime)))).toEqual(expectedDates(startKey, untilKey, "WE", 1));
    expect(created.every((r) => local(new Date(r.startTime)).endsWith("21:00"))).toBe(true);
    expect(new Set(created.map((r) => r.protocol))).toEqual(new Set([res.body.protocol]));
    expect(created.every((r) => r.status === "PENDING" && r.roomId === null && r.seriesId === res.body.series.id)).toBe(true);
    expect(await prisma.reservation.count({ where: { seriesId: res.body.series.id } })).toBe(created.length);
  });

  it("quinzenal, terça e sexta às 21:15, com 30 min de montagem", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    const activityStart = upcoming(2, 7, "21:15");
    const startKey = zonedDateKey(activityStart);
    const untilKey = addDays(startKey, 56);

    const res = await aluno
      .post("/api/reservations")
      .send(
        undergraduateRequest("Quinzenal", activityStart, atTime(startKey, "22:00"), {
          setupMinutes: 30,
          recurrence: { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", until: atTime(untilKey, "23:59").toISOString() },
        }),
      )
      .expect(201);

    const created: CreatedReservation[] = res.body.reservations;
    expect(created.map((r) => zonedDateKey(new Date(r.startTime)))).toEqual(expectedDates(startKey, untilKey, "TU,FR", 2));
    // A reserva começa na montagem (20:45) e termina com a atividade (22:00).
    expect(created.every((r) => local(new Date(r.startTime)).endsWith("20:45") && local(new Date(r.endTime)).endsWith("22:00"))).toBe(true);
    for (const skipped of res.body.skippedDates) expect(holidayName(skipped.date)).toBe(skipped.holiday);
  });

  it("regra fora do formato ou longa demais: 400 e nada gravado", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    const start = upcoming(3, 7, "10:00");
    const end = new Date(start.getTime() + 60 * 60_000);
    const before = await counts();

    const invalid = await aluno
      .post("/api/reservations")
      .send(undergraduateRequest("Inválida", start, end, { recurrence: { rrule: "FREQ=SECONDLY;INTERVAL=1;BYDAY=WE", until: addDays(zonedDateKey(start), 30) } }))
      .expect(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    const tooLong = await aluno
      .post("/api/reservations")
      .send(undergraduateRequest("Longa", start, end, { recurrence: { rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=WE", until: addDays(zonedDateKey(start), 400) } }))
      .expect(400);
    expect(tooLong.body.error.code).toBe("RECURRENCE_TOO_LONG");

    expect(await counts()).toEqual(before);
  });
});
