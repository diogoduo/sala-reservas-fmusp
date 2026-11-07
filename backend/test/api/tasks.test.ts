import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey } from "../../src/lib/timezone";
import { createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let mariaId: string;
const today = zonedDateKey(new Date());
const inDays = (days: number) => zonedDateKey(new Date(Date.now() + days * 86_400_000));

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("vanessa@fm.usp.br", "NUCEV");
  mariaId = (await createUser("maria@fm.usp.br", "NUCEV")).id;
  await createUser("aluno@usp.br");
});

afterAll(() => prisma.$disconnect());

describe("Checklist do dia (Fase 17)", () => {
  let taskId: string;

  it("a Vanessa cria e atribui à Maria, com prazo e prioridade; quem não é da equipe não vê", async () => {
    const vanessa = await loginAs(app, "vanessa@fm.usp.br");
    const { body } = await vanessa.post("/api/tasks").send({ title: "Conferir as chaves do Teatro", assigneeId: mariaId, dueDate: today, priority: true }).expect(201);
    taskId = body.task.id;
    expect(body.task).toMatchObject({ assigneeName: "maria", priority: true, createdByName: "vanessa", status: "OPEN", dueDate: today });
    await vanessa.post("/api/tasks").send({ title: "Atrasada", dueDate: inDays(-2) }).expect(201);
    await vanessa.post("/api/tasks").send({ title: "Sem prazo" }).expect(201);
    await vanessa.post("/api/tasks").send({ title: "Semana que vem", dueDate: inDays(7) }).expect(201);
    const aluno = await prisma.user.findUniqueOrThrow({ where: { email: "aluno@usp.br" } });
    await vanessa.post("/api/tasks").send({ title: "Para fora", assigneeId: aluno.id }).expect(400);
    await (await loginAs(app, "aluno@usp.br")).get("/api/tasks").expect(403);
  });

  it("o dia mostra as atrasadas, as do dia e as sem prazo (não as de outro dia)", async () => {
    const maria = await loginAs(app, "maria@fm.usp.br");
    const { body } = await maria.get(`/api/tasks?date=${today}`).expect(200);
    expect(body.tasks.map((t: { title: string }) => t.title).sort()).toEqual(["Atrasada", "Conferir as chaves do Teatro", "Sem prazo"]);
    // A prioritária vem primeiro.
    expect(body.tasks[0].title).toBe("Conferir as chaves do Teatro");
    expect(body.team.map((p: { name: string }) => p.name)).toEqual(["admin", "maria", "vanessa"]);
  });

  it("a Maria conclui; fica registrado quem fez e quando, e o Histórico guarda as mudanças", async () => {
    const maria = await loginAs(app, "maria@fm.usp.br");
    const done = await maria.patch(`/api/tasks/${taskId}`).send({ done: true }).expect(200);
    expect(done.body.task).toMatchObject({ status: "DONE", doneByName: "maria", updatedByName: "maria" });
    // Concluída hoje: continua no checklist de hoje.
    expect((await maria.get(`/api/tasks?date=${today}`).expect(200)).body.tasks.some((t: { id: string; status: string }) => t.id === taskId && t.status === "DONE")).toBe(true);
    const vanessa = await loginAs(app, "vanessa@fm.usp.br");
    await vanessa.patch(`/api/tasks/${taskId}`).send({ done: false, dueDate: inDays(1) }).expect(200);
    const history = await prisma.auditLog.findMany({ where: { entityType: "task", entityId: taskId }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.action)).toEqual(["task.create", "task.done", "task.reopen"]);
    expect(history[2]!.changes).toMatchObject({ dueDate: { from: today, to: inDays(1) } });
    // O NUCEV consulta pelo Histórico (filtro por tarefa).
    await vanessa.get(`/api/audit?entityType=task&entityId=${taskId}`).expect(200);
    await vanessa.get("/api/audit?entityType=setting").expect(200);
  });

  it("apagar fica no Histórico", async () => {
    const vanessa = await loginAs(app, "vanessa@fm.usp.br");
    await vanessa.delete(`/api/tasks/${taskId}`).expect(200);
    await vanessa.delete(`/api/tasks/${taskId}`).expect(404);
    expect(await prisma.auditLog.count({ where: { action: "task.delete", entityId: taskId } })).toBe(1);
  });
});
