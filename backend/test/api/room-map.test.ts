import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedTime } from "../../src/lib/timezone";
import { createPendingReservation, createRoom, createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
const DAY = "2026-12-01";
let free: string;
let busy: string;
let blocked: string;

beforeAll(async () => {
  await resetDatabase();
  const admin = await createUser("admin@fm.usp.br", "ADMIN");
  const aluno = await createUser("aluno@usp.br");
  free = (await createRoom("Sala Livre", 30)).id;
  busy = (await createRoom("Sala Ocupada", 30)).id;
  blocked = (await createRoom("Sala Bloqueada", 30)).id;
  const r = await createPendingReservation(aluno.id, zonedTime(DAY, "09:00"), zonedTime(DAY, "11:00"));
  await prisma.reservation.update({ where: { id: r.id }, data: { status: "APPROVED", roomId: busy } });
  await prisma.roomBlock.create({ data: { roomId: blocked, reason: "Pintura", startTime: zonedTime(DAY, "08:00"), endTime: zonedTime(DAY, "18:00"), createdById: admin.id } });
});

afterAll(() => prisma.$disconnect());

describe("Mapa das salas (Fase 19)", () => {
  it("livre, ocupada e bloqueada no horário; os horários do dia, sem dizer quem", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    const { body } = await aluno.get(`/api/rooms/map/status?date=${DAY}&start=10:00&end=11:00`).expect(200);
    const state = (id: string) => body.rooms.find((r: { id: string }) => r.id === id);
    expect(state(free)).toMatchObject({ state: "FREE", busy: [] });
    expect(state(busy)).toMatchObject({ state: "BUSY", busy: [{ start: "09:00", end: "11:00" }] });
    expect(state(blocked)).toMatchObject({ state: "BLOCKED", blocks: [{ reason: "Pintura" }] });
    expect(JSON.stringify(body)).not.toContain("aluno");
    // Fora do horário da reserva, a sala fica livre.
    const later = (await aluno.get(`/api/rooms/map/status?date=${DAY}&start=14:00&end=15:00`).expect(200)).body;
    expect(later.rooms.find((r: { id: string }) => r.id === busy).state).toBe("FREE");
    await aluno.get(`/api/rooms/map/status?date=${DAY}&start=15:00&end=14:00`).expect(400);
  });
});
