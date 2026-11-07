import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedTime } from "../../src/lib/timezone";
import { createPendingReservation, createRoom, createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
// Um dia útil fixo, para o teste não depender de quando roda.
const DAY = "2026-12-01";
let eventId: string;
let mariaId: string;

beforeAll(async () => {
  await resetDatabase();
  const admin = await createUser("admin@fm.usp.br", "ADMIN");
  const vanessa = await createUser("vanessa@fm.usp.br", "NUCEV");
  mariaId = (await createUser("maria@fm.usp.br", "NUCEV")).id;
  const aluno = await createUser("aluno@usp.br");
  const sala = await createRoom("Sala Plantão", 40);
  // Uma reserva confirmada e uma aguardando, no dia.
  const ok = await createPendingReservation(aluno.id, zonedTime(DAY, "09:00"), zonedTime(DAY, "11:00"));
  await prisma.reservation.update({ where: { id: ok.id }, data: { status: "APPROVED", roomId: sala.id, title: "Aula confirmada" } });
  await createPendingReservation(aluno.id, zonedTime(DAY, "14:00"), zonedTime(DAY, "16:00"));
  // Um evento confirmado nesse dia, com uma pendência aberta.
  const event = await prisma.event.create({
    data: {
      protocol: "EV-999001/2026",
      userId: aluno.id,
      title: "Jornada do Plantão",
      kind: "CONGRESS",
      description: "Teste",
      targetAudience: "Alunos",
      expectedAttendees: 50,
      entity: "DEPARTMENT",
      institutional: true,
      hasRegistrationFee: false,
      sponsored: false,
      responsible: "Prof. Teste",
      responsibleContact: "teste@fm.usp.br",
      department: "Teste",
      status: "CONFIRMED",
      assigneeId: vanessa.id,
      assigneeName: vanessa.name,
      days: { create: [{ date: new Date(`${DAY}T00:00:00Z`), startTime: zonedTime(DAY, "08:00"), endTime: zonedTime(DAY, "12:00") }] },
    },
  });
  eventId = event.id;
  await prisma.operationalTask.create({ data: { eventId, title: "Conferir o som", dueDate: new Date(`${DAY}T00:00:00Z`), priority: true, createdById: admin.id, createdByName: admin.name } });
});

afterAll(() => prisma.$disconnect());

describe("Plantão: retrato do dia e passagem (Fase 17)", () => {
  let handoverId: string;

  it("o dia: eventos, reservas confirmadas e aguardando, tarefas e quem cuida de quê", async () => {
    const vanessa = await loginAs(app, "vanessa@fm.usp.br");
    const { body } = await vanessa.get(`/api/plantao/day?date=${DAY}`).expect(200);
    expect(body.events).toEqual([expect.objectContaining({ title: "Jornada do Plantão", start: "08:00", end: "12:00", openTasks: 1, assigneeName: "vanessa" })]);
    expect(body.reservations.confirmed.map((r: { title: string }) => r.title)).toEqual(["Aula confirmada"]);
    expect(body.reservations.awaiting).toHaveLength(1);
    expect(body.tasks.priority.map((t: { title: string }) => t.title)).toEqual(["Conferir o som"]);
    expect(body.people).toEqual(expect.arrayContaining([expect.objectContaining({ name: "vanessa", events: ["Jornada do Plantão"] })]));
    await (await loginAs(app, "aluno@usp.br")).get(`/api/plantao/day?date=${DAY}`).expect(403);
  });

  it("a passagem guarda o geral, o evento e o retrato do dia; vazia, não passa", async () => {
    const vanessa = await loginAs(app, "vanessa@fm.usp.br");
    await vanessa.post("/api/plantao/handovers").send({ date: DAY }).expect(400);
    const { body } = await vanessa
      .post("/api/plantao/handovers")
      .send({
        date: DAY,
        shiftLabel: "Manhã → Tarde",
        summary: "Manhã tranquila.",
        pending: "Conferir o som da Jornada.",
        nextResponsibleId: mariaId,
        events: [{ eventId, situation: "ATTENTION", done: "Credenciamento aberto", doneBy: "Vanessa", pending: "Som do auditório", nextResponsibleName: "Maria" }],
      })
      .expect(201);
    handoverId = body.handover.id;
    expect(body.handover).toMatchObject({ date: DAY, nextResponsibleName: "maria", createdByName: "vanessa", acknowledgedAt: null });
    expect(body.handover.events).toEqual([expect.objectContaining({ eventLabel: "EV-999001/2026 — Jornada do Plantão", situation: "ATTENTION" })]);
    expect(body.handover.snapshot.reservations.confirmed).toHaveLength(1);
  });

  it("quem assume confirma que recebeu (uma vez); quem passou não confirma a própria", async () => {
    const vanessa = await loginAs(app, "vanessa@fm.usp.br");
    expect((await vanessa.post(`/api/plantao/handovers/${handoverId}/acknowledge`).expect(409)).body.error.code).toBe("OWN_HANDOVER");
    const maria = await loginAs(app, "maria@fm.usp.br");
    const { body } = await maria.post(`/api/plantao/handovers/${handoverId}/acknowledge`).expect(200);
    expect(body.handover).toMatchObject({ acknowledgedByName: "maria" });
    await maria.post(`/api/plantao/handovers/${handoverId}/acknowledge`).expect(409);
    const list = (await maria.get("/api/plantao/handovers").expect(200)).body;
    expect(list.handovers).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityType: "handover", entityId: handoverId } })).toBe(2);
  });
});
