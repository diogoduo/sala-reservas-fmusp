import type { Reservation, Room } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { upcoming } from "../dates";
import { createPendingReservation, createRoom, createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let room: Room;
let othersReservation: Reservation;
let ownReservation: Reservation;

beforeAll(async () => {
  await resetDatabase();
  const aluno = await createUser("aluno@usp.br");
  const outra = await createUser("outra@usp.br");
  await createUser("admin@fm.usp.br", "ADMIN");
  room = await createRoom("Sala 101");
  const start = upcoming(2, 10, "10:00");
  const end = new Date(start.getTime() + 60 * 60_000);
  ownReservation = await createPendingReservation(aluno.id, start, end);
  othersReservation = await createPendingReservation(outra.id, start, end);
});

afterAll(() => prisma.$disconnect());

describe("permissões", () => {
  it("sem login: 401 nas rotas autenticadas", async () => {
    const res = await request(app).get("/api/reservations").expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    await request(app).get("/api/admin/reservations").expect(401);
  });

  it("solicitante não entra nas rotas do SAD", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    const res = await aluno.get("/api/admin/reservations").expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    await aluno.post(`/api/admin/reservations/${ownReservation.id}/approve`).send({ roomId: room.id }).expect(403);
    await aluno.post(`/api/admin/users/${othersReservation.userId}/sanctions`).send({ type: "WARNING", reason: "x" }).expect(403);
    await aluno.post("/api/rooms").send({}).expect(403);
  });

  it("SAD entra nas rotas do SAD", async () => {
    const admin = await loginAs(app, "admin@fm.usp.br");
    const res = await admin.get("/api/admin/reservations").expect(200);
    expect(res.body.reservations).toHaveLength(2);
  });

  it("solicitante vê e altera só as próprias reservas (a dos outros responde 404)", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    await aluno.get(`/api/reservations/${ownReservation.id}`).expect(200);
    const res = await aluno.get(`/api/reservations/${othersReservation.id}`).expect(404);
    expect(res.body.error.code).toBe("RESERVATION_NOT_FOUND");
    await aluno.post(`/api/reservations/${othersReservation.id}/cancel`).send({}).expect(404);
    const mine = await aluno.get("/api/reservations").expect(200);
    expect(mine.body.reservations.map((r: { id: string }) => r.id)).toEqual([ownReservation.id]);
  });
});

describe("id malformado responde 404, não 500", () => {
  it.each([
    ["/api/reservations/abc", "RESERVATION_NOT_FOUND"],
    ["/api/rooms/abc", "ROOM_NOT_FOUND"],
    ["/api/admin/users/abc/standing", "USER_NOT_FOUND"],
  ])("GET %s", async (path, code) => {
    const admin = await loginAs(app, "admin@fm.usp.br");
    const res = await admin.get(path).expect(404);
    expect(res.body.error.code).toBe(code);
  });

  it("nas ações do SAD", async () => {
    const admin = await loginAs(app, "admin@fm.usp.br");
    const approve = await admin.post("/api/admin/reservations/abc/approve").send({ roomId: room.id }).expect(404);
    expect(approve.body.error.code).toBe("RESERVATION_NOT_FOUND");
    const lift = await admin.post("/api/admin/sanctions/abc/lift").expect(404);
    expect(lift.body.error.code).toBe("SANCTION_NOT_FOUND");
    const notebook = await admin.delete("/api/notebooks/abc").expect(404);
    expect(notebook.body.error.code).toBe("NOTEBOOK_NOT_FOUND");
  });
});
