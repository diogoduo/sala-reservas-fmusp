import type { Room, User } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedTime } from "../../src/lib/timezone";
import { createPendingReservation, createRoom, createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let aluno: User;
let sala: Room;
let outra: Room;

// Relógio fixo num dia útil às 10h, para o teste não depender da hora em que roda.
const DAY = "2026-12-01";
const at = (time: string) => zonedTime(DAY, time);

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("vanessa@fm.usp.br", "NUCEV");
  aluno = await createUser("aluno@usp.br");
  sala = await createRoom("Sala TV 1", 40);
  outra = await createRoom("Sala TV 2", 40);
});

afterAll(() => prisma.$disconnect());

describe("Painel da TV (Fase 15)", () => {
  let token: string;

  it("só o SAD gera o link; o NUCEV vê, mas não gera", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    expect((await nucev.get("/api/settings/tv").expect(200)).body.token).toBeNull();
    await nucev.post("/api/settings/tv").expect(403);
    const sad = await loginAs(app, "admin@fm.usp.br");
    token = (await sad.post("/api/settings/tv").expect(200)).body.token;
    expect(token).toMatch(/^[\w-]{32}$/);
    const [entry] = await prisma.auditLog.findMany({ where: { action: "tv.link_create" } });
    expect(entry).toMatchObject({ entityType: "setting" });
  });

  it("abre sem login e mostra o dia, sem dados pessoais; a sala ocupada agora não conta como livre", async () => {
    // Uma reserva acontecendo agora (aprovada) e uma cancelada, que não aparece.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("10:00"));
    const now = await createPendingReservation(aluno.id, at("09:30"), at("10:30"));
    await prisma.reservation.update({ where: { id: now.id }, data: { status: "APPROVED", roomId: sala.id, title: "Aula agora" } });
    const cancelled = await createPendingReservation(aluno.id, at("09:30"), at("10:30"));
    await prisma.reservation.update({ where: { id: cancelled.id }, data: { status: "CANCELLED", roomId: outra.id, title: "Aula cancelada" } });

    const { body } = await request(app).get(`/api/tv/${token}`).expect(200);
    vi.useRealTimers();
    expect(body.date).toBe(DAY);
    expect(body.rooms).toMatchObject({ total: 2, busyNow: 1, freeNow: 1 });
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Aula agora"]);
    expect(body.items[0]).toMatchObject({ kind: "reservation", status: "CONFIRMED", rooms: [{ name: "Sala TV 1" }] });
    expect(JSON.stringify(body)).not.toContain("aluno@usp.br");
  });

  it("link errado, trocado ou desativado não abre", async () => {
    await request(app).get("/api/tv/link-que-nao-existe").expect(404);
    const sad = await loginAs(app, "admin@fm.usp.br");
    const next = (await sad.post("/api/settings/tv").expect(200)).body.token;
    await request(app).get(`/api/tv/${token}`).expect(404);
    await request(app).get(`/api/tv/${next}`).expect(200);
    await sad.delete("/api/settings/tv").expect(200);
    await request(app).get(`/api/tv/${next}`).expect(404);
    expect(await prisma.auditLog.count({ where: { action: "tv.link_disable" } })).toBe(1);
  });
});
