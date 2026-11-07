import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedTime } from "../../src/lib/timezone";
import { createPendingReservation, createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let protocol: string;
const path = () => `/api/conversations/${encodeURIComponent(protocol)}`;

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("vanessa@fm.usp.br", "NUCEV");
  const aluno = await createUser("aluno@usp.br");
  await createUser("outro@usp.br");
  protocol = (await createPendingReservation(aluno.id, zonedTime("2026-12-01", "09:00"), zonedTime("2026-12-01", "11:00"))).protocol;
});

afterAll(() => prisma.$disconnect());

describe("Conversa da reserva (Fase 19)", () => {
  it("quem pediu e o SAD conversam; fica o autor, o papel e a hora", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    expect((await aluno.get(path()).expect(200)).body).toMatchObject({ protocol, canWrite: true, messages: [] });
    await aluno.post(path()).send({ body: "Dá para trocar para a sala com projetor?" }).expect(201);
    const sad = await loginAs(app, "admin@fm.usp.br");
    await sad.post(path()).send({ body: "Dá, sim: Sala 1107." }).expect(201);
    await sad.post(path()).send({ body: "   " }).expect(400);
    const { body } = await aluno.get(path()).expect(200);
    expect(body.messages.map((m: { authorName: string; authorRole: string; body: string }) => [m.authorName, m.authorRole, m.body])).toEqual([
      ["aluno", "USER", "Dá para trocar para a sala com projetor?"],
      ["admin", "ADMIN", "Dá, sim: Sala 1107."],
    ]);
    expect(body.messages[0].createdAt).toBeTruthy();
  });

  it("o NUCEV acompanha sem escrever; outra pessoa não vê", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    const { body } = await nucev.get(path()).expect(200);
    expect(body).toMatchObject({ canWrite: false });
    expect(body.messages).toHaveLength(2);
    await nucev.post(path()).send({ body: "Oi" }).expect(403);
    const outro = await loginAs(app, "outro@usp.br");
    await outro.get(path()).expect(404);
    await outro.post(path()).send({ body: "Oi" }).expect(404);
    await outro.get(`/api/conversations/${encodeURIComponent("999999/2099")}`).expect(404);
  });
});
