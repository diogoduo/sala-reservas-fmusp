import type { Room, User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { addDays, weekdayOf } from "../../src/lib/calendar";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey } from "../../src/lib/timezone";
import { atTime, upcoming } from "../dates";
import { createPendingReservation, createRoom, createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let room: Room;
let ana: User;
let bruno: User;

beforeAll(async () => {
  await resetDatabase();
  ana = await createUser("ana@usp.br");
  bruno = await createUser("bruno@usp.br");
  await createUser("admin@fm.usp.br", "ADMIN");
  room = await createRoom("Sala 101");
});

afterAll(() => prisma.$disconnect());

describe("aprovação concorrente na mesma sala", () => {
  it("dois pedidos no mesmo horário aprovados ao mesmo tempo: um passa, o outro recebe 409", async () => {
    const admin = await loginAs(app, "admin@fm.usp.br");
    // Algumas rodadas, em horários diferentes, para a corrida acontecer de verdade.
    // Cada rodada termina antes da próxima começar (a 2ª reserva vai até 2h15 depois).
    for (const hour of ["07:00", "10:00", "13:00", "16:00", "19:00"]) {
      const start = upcoming(3, 10, hour);
      const end = new Date(start.getTime() + 90 * 60_000);
      const first = await createPendingReservation(ana.id, start, end);
      // O segundo só encosta pela metade: também conflita.
      const second = await createPendingReservation(bruno.id, new Date(start.getTime() + 45 * 60_000), new Date(end.getTime() + 45 * 60_000));

      const responses = await Promise.all(
        [first, second].map((r) => admin.post(`/api/admin/reservations/${r.id}/approve`).send({ roomId: room.id })),
      );

      expect(responses.map((r) => r.status).sort(), hour).toEqual([200, 409]);
      const refused = responses.find((r) => r.status === 409)!;
      expect(refused.body.error.code).toBe("RESERVATION_CONFLICT");

      const statuses = await prisma.reservation.findMany({ where: { id: { in: [first.id, second.id] } }, select: { status: true, roomId: true } });
      expect(statuses.map((s) => s.status).sort()).toEqual(["APPROVED", "PENDING"]);
      expect(statuses.find((s) => s.status === "PENDING")!.roomId).toBeNull();
    }
  });

  it("pedido que encosta no horário de outro pode ser aprovado na mesma sala", async () => {
    const admin = await loginAs(app, "admin@fm.usp.br");
    const start = upcoming(4, 10, "08:00");
    const middle = new Date(start.getTime() + 60 * 60_000);
    const before = await createPendingReservation(ana.id, start, middle);
    const after = await createPendingReservation(bruno.id, middle, new Date(middle.getTime() + 60 * 60_000));
    await admin.post(`/api/admin/reservations/${before.id}/approve`).send({ roomId: room.id }).expect(200);
    await admin.post(`/api/admin/reservations/${after.id}/approve`).send({ roomId: room.id }).expect(200);
  });
});

describe("pedido vencido", () => {
  it("não pode ser aprovado, mas pode ser rejeitado", async () => {
    const admin = await loginAs(app, "admin@fm.usp.br");
    // Um dia de semana que já passou, em horário regular (o CHECK do banco exige).
    let day = zonedDateKey(new Date(Date.now() - 2 * 86_400_000));
    while (weekdayOf(day) === 0) day = addDays(day, -1);
    const start = atTime(day, "10:00");
    const past = await createPendingReservation(ana.id, start, new Date(start.getTime() + 60 * 60_000));

    const approve = await admin.post(`/api/admin/reservations/${past.id}/approve`).send({ roomId: room.id }).expect(400);
    expect(approve.body.error.code).toBe("RESERVATION_IN_PAST");

    const reject = await admin.post(`/api/admin/reservations/${past.id}/reject`).send({ reason: "A data já passou." }).expect(200);
    expect(reject.body.rejectedIds).toEqual([past.id]);
  });
});
