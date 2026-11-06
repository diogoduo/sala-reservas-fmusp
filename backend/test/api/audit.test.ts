import type { Room, User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { upcoming } from "../dates";
import { createPendingReservation, createRoom, createUser, loginAs, resetDatabase, undergraduateRequest } from "./helpers";

const app = createApp();
let room: Room;
let ana: User;
let admin: User;

beforeAll(async () => {
  await resetDatabase();
  ana = await createUser("ana@usp.br");
  admin = await createUser("admin@fm.usp.br", "ADMIN");
  room = await createRoom("Sala 101");
});

afterAll(() => prisma.$disconnect());

const entriesFor = (entityId: string) => prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });

describe("histórico (auditoria)", () => {
  it("o pedido do solicitante fica registrado com o protocolo e quem pediu", async () => {
    const agent = await loginAs(app, "ana@usp.br");
    const start = upcoming(2, 10, "10:00");
    const res = await agent
      .post("/api/reservations")
      .send(undergraduateRequest("Anatomia I", start, new Date(start.getTime() + 2 * 3_600_000)))
      .expect(201);

    const [entry] = await entriesFor(res.body.protocol);
    expect(entry).toMatchObject({
      action: "reservation.request",
      entityType: "reservation",
      actorId: ana.id,
      actorName: ana.name,
      label: `${res.body.protocol} — MCM0101 — Anatomia I`,
    });
    expect(entry!.details).toMatchObject({ count: 1, activityType: "UNDERGRADUATE", expectedAttendees: 20 });
  });

  it("aprovar grava quem aprovou, a mudança de status e a sala", async () => {
    const start = upcoming(3, 10, "14:00");
    const pending = await createPendingReservation(ana.id, start, new Date(start.getTime() + 3_600_000));
    const agent = await loginAs(app, "admin@fm.usp.br");
    await agent.post(`/api/admin/reservations/${pending.id}/approve`).send({ roomId: room.id }).expect(200);

    const [entry] = await entriesFor(pending.protocol);
    expect(entry).toMatchObject({ action: "reservation.approve", actorId: admin.id });
    expect(entry!.changes).toEqual({
      status: { from: "PENDING", to: "APPROVED" },
      room: { from: null, to: "Sala 101 — Prédio Teste, Térreo" },
    });

    // Uma ação que falha não deixa rastro: a transação inteira é desfeita.
    await agent.post(`/api/admin/reservations/${pending.id}/approve`).send({ roomId: room.id }).expect(409);
    expect(await entriesFor(pending.protocol)).toHaveLength(1);
  });

  it("alterar uma sala grava só o que mudou; salvar sem mudança não grava nada", async () => {
    const agent = await loginAs(app, "admin@fm.usp.br");
    await agent.patch(`/api/rooms/${room.id}`).send({ capacity: 55 }).expect(200);
    await agent.patch(`/api/rooms/${room.id}`).send({ capacity: 55 }).expect(200);

    const entries = await prisma.auditLog.findMany({ where: { entityType: "room", entityId: room.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.changes).toEqual({ capacity: { from: 40, to: 55 } });
  });

  it("só o SAD consulta o histórico, do mais recente para o mais antigo, em páginas", async () => {
    const requester = await loginAs(app, "ana@usp.br");
    await requester.get("/api/audit").expect(403);

    const agent = await loginAs(app, "admin@fm.usp.br");
    const all = await agent.get("/api/audit").expect(200);
    const times = all.body.items.map((i: { createdAt: string }) => i.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(all.body.nextCursor).toBeNull();

    const first = await agent.get("/api/audit?limit=1").expect(200);
    expect(first.body.items).toHaveLength(1);
    const second = await agent.get(`/api/audit?limit=1&cursor=${first.body.nextCursor}`).expect(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect(second.body.items[0].id).toBe(all.body.items[1].id);

    const rooms = await agent.get("/api/audit?entityType=room").expect(200);
    expect(rooms.body.items.every((i: { entityType: string }) => i.entityType === "room")).toBe(true);

    await agent.get("/api/audit?cursor=nao-e-um-cursor").expect(400);
  });
});
