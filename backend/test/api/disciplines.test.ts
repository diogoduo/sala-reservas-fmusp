import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedTime } from "../../src/lib/timezone";
import { createUser, loginAs, resetDatabase, undergraduateRequest } from "./helpers";

const app = createApp();
// Um dia útil bem à frente (antecedência do pedido).
const at = (time: string) => zonedTime("2026-12-14", time);

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("docente@fm.usp.br");
  await createUser("secretaria@fm.usp.br", "USER", ["REQUEST_UNDERGRADUATE"]);
});

afterAll(() => prisma.$disconnect());

describe("Disciplinas dos docentes (Fase 19)", () => {
  it("o SAD cola a planilha: cria as disciplinas, liga os docentes e libera a permissão", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const { body } = await sad
      .post("/api/disciplines/import")
      .send({ text: "MCM0101; Clínica Médica; docente@fm.usp.br; Clínica Médica; G\nPGD5000\tPós em Teste\tdocente@fm.usp.br\t\tP\nXX; inválida\nmcm0102; Outra; ninguem@usp.br" })
      .expect(201);
    expect(body).toMatchObject({ lines: 4, created: 3, linked: 2, missing: ["ninguem@usp.br"], invalid: ["XX"] });
    const docente = await prisma.user.findUniqueOrThrow({ where: { email: "docente@fm.usp.br" } });
    expect(docente.permissions).toEqual(expect.arrayContaining(["REQUEST_UNDERGRADUATE", "REQUEST_GRADUATE"]));
    const all = (await sad.get("/api/disciplines").expect(200)).body.disciplines;
    expect(all.map((d: { code: string; level: string }) => [d.code, d.level])).toEqual([
      ["MCM0101", "UNDERGRADUATE"],
      ["MCM0102", "UNDERGRADUATE"],
      ["PGD5000", "GRADUATE"],
    ]);
  });

  it("qualquer pessoa logada busca a disciplina pelo código (nome, departamento e docentes)", async () => {
    const secretaria = await loginAs(app, "secretaria@fm.usp.br");
    const docente = await prisma.user.findUniqueOrThrow({ where: { email: "docente@fm.usp.br" } });
    const { body } = await secretaria.get("/api/disciplines/lookup/mcm0101").expect(200);
    expect(body.discipline).toEqual({ code: "MCM0101", name: "Clínica Médica", department: "Clínica Médica", level: "UNDERGRADUATE", teachers: [docente.name] });
    expect((await secretaria.get("/api/disciplines/lookup/ABC9999").expect(200)).body.discipline).toBeNull();
    await secretaria.get("/api/disciplines/lookup/XX").expect(400);
  });

  it("o docente pede só para as disciplinas dele", async () => {
    const docente = await loginAs(app, "docente@fm.usp.br");
    expect((await docente.get("/api/disciplines/mine").expect(200)).body.disciplines.map((d: { code: string }) => d.code)).toEqual(["MCM0101", "PGD5000"]);
    const other = undergraduateRequest("Outra", at("09:00"), at("11:00"));
    (other.details as Record<string, unknown>).disciplineCode = "MCM0102";
    expect((await docente.post("/api/reservations").send(other).expect(403)).body.error.code).toBe("DISCIPLINE_NOT_LINKED");
    await docente.post("/api/reservations").send(undergraduateRequest("Clínica Médica", at("09:00"), at("11:00"))).expect(201);
  });

  it("quem não tem disciplina ligada (a secretaria) continua pedindo para qualquer uma", async () => {
    const secretaria = await loginAs(app, "secretaria@fm.usp.br");
    const other = undergraduateRequest("Outra", at("14:00"), at("16:00"));
    (other.details as Record<string, unknown>).disciplineCode = "MCM0102";
    await secretaria.post("/api/reservations").send(other).expect(201);
  });

  it("desligar o docente tira a restrição; só o SAD mexe", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const docente = await prisma.user.findUniqueOrThrow({ where: { email: "docente@fm.usp.br" } });
    const mcm = await prisma.discipline.findUniqueOrThrow({ where: { code: "MCM0101" } });
    await (await loginAs(app, "docente@fm.usp.br")).post("/api/disciplines/import").send({ text: "ABC1234; X" }).expect(403);
    await sad.delete(`/api/disciplines/${mcm.id}/teachers/${docente.id}`).expect(200);
    expect(await prisma.auditLog.count({ where: { action: { in: ["discipline.import", "discipline.unlink"] } } })).toBe(2);
  });
});
