import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey, zonedTime } from "../../src/lib/timezone";
import { createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let eventId: string;
let vanessaId: string;

const inDays = (days: number) => zonedDateKey(new Date(Date.now() + days * 86_400_000));
const day1 = inDays(20);
const day2 = inDays(21);
let categoryId: string;

const eventPayload = (title: string) => ({
  title,
  kind: "CONGRESS",
  description: "Programação de teste.",
  targetAudience: "Alunos",
  expectedAttendees: 80,
  entity: "DEPARTMENT",
  hasRegistrationFee: false,
  sponsored: false,
  responsible: "Prof. Teste",
  responsibleContact: "teste@fm.usp.br",
  department: "Departamento Teste",
  coffeeBreak: false,
  termsAccepted: true,
  days: [
    { date: day1, start: "08:00", end: "18:00" },
    { date: day2, start: "08:00", end: "12:00" },
  ],
  spaces: [{ categoryId, count: 1 }],
});

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  vanessaId = (await createUser("vanessa@fm.usp.br", "NUCEV")).id;
  await createUser("aluno@usp.br");
  const salas = await prisma.priceCategory.create({ data: { name: "Salas de aula e salas de reunião", unit: "HOUR", didactic: true } });
  categoryId = salas.id;
  await createUser("outro@usp.br");
  await prisma.room.create({ data: { name: "Sala Org", building: "Prédio Teste", floor: "1º andar", capacity: 90, roomType: "CLASSROOM", priceCategoryId: salas.id } });
  const aluno = await loginAs(app, "aluno@usp.br");
  const { body } = await aluno.post("/api/events").send(eventPayload("Simpósio de Organização")).expect(201);
  eventId = body.event.id;
});

afterAll(() => prisma.$disconnect());

describe("Organização do evento confirmado (Fase 16)", () => {
  it("só abre depois da confirmação; o solicitante não vê esta área", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    const { body } = await nucev.get(`/api/events/${eventId}/organization`).expect(200);
    expect(body).toMatchObject({ editable: false, closable: false, plan: null, schedule: [], people: [], tasks: [] });
    expect(body.team.map((p: { name: string }) => p.name).sort()).toEqual(["admin", "vanessa"]);
    const res = await nucev.put(`/api/events/${eventId}/organization/plan`).send({ buffetNeeded: false, parkingNeeded: false }).expect(409);
    expect(res.body.error.code).toBe("EVENT_NOT_CONFIRMED");
    await (await loginAs(app, "aluno@usp.br")).get(`/api/events/${eventId}/organization`).expect(403);
    // Daqui em diante, o evento confirmado (o fluxo até a confirmação tem os testes dele).
    await prisma.event.update({ where: { id: eventId }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedByName: "admin" } });
  });

  it("logística: buffet e estacionamento, estrutura e equipamentos", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    const { body } = await nucev
      .put(`/api/events/${eventId}/organization/plan`)
      .send({ buffetNeeded: true, buffetDetails: "Almoço para 80 no dia 1", parkingNeeded: true, parkingSpots: 6, parkingDetails: "Palestrantes", equipment: "4 microfones" })
      .expect(200);
    expect(body.plan).toMatchObject({ buffetNeeded: true, parkingSpots: 6, equipment: "4 microfones", updatedByName: "vanessa" });
    // Sem estacionamento, as vagas somem.
    const off = await nucev.put(`/api/events/${eventId}/organization/plan`).send({ buffetNeeded: true, buffetDetails: "Almoço", parkingNeeded: false, parkingSpots: 6 }).expect(200);
    expect(off.body.plan).toMatchObject({ parkingNeeded: false, parkingSpots: null, parkingDetails: null });
  });

  it("programação: só nos dias do evento, com o fim depois do início", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    await nucev.post(`/api/events/${eventId}/organization/schedule`).send({ date: day2, start: "09:00", end: "10:00", title: "Mesa-redonda" }).expect(201);
    const { body } = await nucev
      .post(`/api/events/${eventId}/organization/schedule`)
      .send({ date: day1, start: "08:30", end: "09:00", title: "Abertura", location: "Sala Org", speaker: "Diretoria" })
      .expect(201);
    await nucev.patch(`/api/events/${eventId}/organization/schedule/${body.item.id}`).send({ date: day1, start: "08:00", end: "09:00", title: "Abertura oficial" }).expect(200);
    await nucev.post(`/api/events/${eventId}/organization/schedule`).send({ date: inDays(40), start: "09:00", end: "10:00", title: "Fora" }).expect(400);
    await nucev.post(`/api/events/${eventId}/organization/schedule`).send({ date: day1, start: "10:00", end: "09:00", title: "Ao contrário" }).expect(400);
    const org = (await nucev.get(`/api/events/${eventId}/organization`).expect(200)).body;
    expect(org.schedule.map((s: { title: string; date: string; start: string }) => [s.date, s.start, s.title])).toEqual([
      [day1, "08:00", "Abertura oficial"],
      [day2, "09:00", "Mesa-redonda"],
    ]);
  });

  it("pessoas: organização, palestrantes e a lista de participantes colada, sem repetir nomes", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    await sad.post(`/api/events/${eventId}/organization/people`).send({ kind: "ORGANIZER", name: "Vanessa", affiliation: "NUCEV" }).expect(201);
    const speaker = (await sad.post(`/api/events/${eventId}/organization/people`).send({ kind: "SPEAKER", name: "Dra. Ana", affiliation: "Unifesp", notes: "Precisa de hospedagem" }).expect(201)).body.person;
    await sad.patch(`/api/events/${eventId}/organization/people/${speaker.id}`).send({ name: "Dra. Ana Lima", affiliation: "Unifesp" }).expect(200);
    const imported = await sad
      .post(`/api/events/${eventId}/organization/people/import`)
      .send({ kind: "PARTICIPANT", text: "João Silva; joao@usp.br; FMUSP\nMaria Souza\tmaria@usp.br\n\njoão silva\nx" })
      .expect(201);
    expect(imported.body).toEqual({ added: 2, skipped: 1 });
    const people = (await sad.get(`/api/events/${eventId}/organization`).expect(200)).body.people;
    expect(people.filter((p: { kind: string }) => p.kind === "PARTICIPANT").map((p: { name: string; contact: string }) => [p.name, p.contact])).toEqual([
      ["João Silva", "joao@usp.br"],
      ["Maria Souza", "maria@usp.br"],
    ]);
    expect(people.find((p: { kind: string }) => p.kind === "SPEAKER")).toMatchObject({ name: "Dra. Ana Lima", notes: null });
  });

  it("pendências: para alguém da equipe, com prazo; concluir e reabrir", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    const { body } = await nucev.post(`/api/events/${eventId}/organization/tasks`).send({ title: "Confirmar o buffet", assigneeId: vanessaId, dueDate: day1 }).expect(201);
    expect(body.task).toMatchObject({ assigneeName: "vanessa", status: "OPEN", createdByName: "vanessa" });
    const aluno = await prisma.user.findUniqueOrThrow({ where: { email: "aluno@usp.br" } });
    await nucev.post(`/api/events/${eventId}/organization/tasks`).send({ title: "Para fora da equipe", assigneeId: aluno.id }).expect(400);
    const done = await nucev.patch(`/api/events/${eventId}/organization/tasks/${body.task.id}`).send({ done: true }).expect(200);
    expect(done.body.task).toMatchObject({ status: "DONE", doneByName: "vanessa" });
    const reopened = await nucev.patch(`/api/events/${eventId}/organization/tasks/${body.task.id}`).send({ done: false }).expect(200);
    expect(reopened.body.task).toMatchObject({ status: "OPEN", doneAt: null });
    await nucev.post(`/api/events/${eventId}/organization/tasks`).send({ title: "Devolver os pranchões" }).expect(201);
  });

  it("encerramento: só a partir do último dia; depois fica só para consulta", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    expect((await nucev.post(`/api/events/${eventId}/close`).send({}).expect(409)).body.error.code).toBe("EVENT_NOT_OVER");
    // O evento aconteceu ontem e anteontem.
    const days = await prisma.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" } });
    for (const [i, d] of days.entries()) {
      const key = inDays(i - 2);
      await prisma.eventDay.update({ where: { id: d.id }, data: { date: new Date(`${key}T00:00:00Z`), startTime: zonedTime(key, "08:00"), endTime: zonedTime(key, "12:00") } });
    }
    expect((await nucev.get(`/api/events/${eventId}/organization`).expect(200)).body.closable).toBe(true);
    const { body } = await nucev.post(`/api/events/${eventId}/close`).send({ actualAttendees: 72, notes: "Tudo certo." }).expect(200);
    expect(body.openTasks).toBe(2);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({ actualAttendees: 72, closingNotes: "Tudo certo.", closedByName: "vanessa" });
    expect((await nucev.post(`/api/events/${eventId}/organization/tasks`).send({ title: "Depois" }).expect(409)).body.error.code).toBe("EVENT_CLOSED");
    await nucev.post(`/api/events/${eventId}/close`).send({}).expect(409);
    expect((await nucev.get(`/api/events/${eventId}/organization`).expect(200)).body).toMatchObject({ editable: false, closable: false });
    // Tudo no Histórico.
    expect(await prisma.auditLog.count({ where: { action: "event.organization" } })).toBeGreaterThan(8);
    expect(await prisma.auditLog.count({ where: { action: "event.close" } })).toBe(1);
  });
});

describe("Palestrantes, participantes e veículos: quem pediu informa, antes ou depois da confirmação", () => {
  let id: string;

  it("antes da confirmação, quem pediu inclui palestrantes, participantes e veículos", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    id = (await aluno.post("/api/events").send(eventPayload("Jornada com convidados")).expect(201)).body.event.id;
    await aluno.post(`/api/events/${id}/organization/people`).send({ kind: "SPEAKER", name: "Dr. Convidado", affiliation: "Unicamp" }).expect(201);
    expect((await aluno.post(`/api/events/${id}/organization/people/import`).send({ kind: "PARTICIPANT", text: "Ana\nBruno" }).expect(201)).body.added).toBe(2);
    const { body } = await aluno.post(`/api/events/${id}/vehicles`).send({ plate: "abc-1d23", model: "Gol prata", driver: "Dr. Convidado" }).expect(201);
    expect(body.vehicle).toMatchObject({ plate: "ABC1D23", addedByName: "aluno" });
    expect((await aluno.post(`/api/events/${id}/vehicles`).send({ plate: "ABC1D23" }).expect(409)).body.error.code).toBe("DUPLICATE_PLATE");
    await aluno.post(`/api/events/${id}/vehicles`).send({ plate: "1234" }).expect(400);
    await aluno.post(`/api/events/${id}/vehicles`).send({ plate: "XYZ9876" }).expect(201);

    const mine = (await aluno.get(`/api/events/${id}/guests`).expect(200)).body;
    expect(mine.editable).toBe(true);
    expect(mine.people.map((p: { name: string; addedByName: string }) => [p.name, p.addedByName])).toEqual([
      ["Dr. Convidado", "aluno"],
      ["Ana", "aluno"],
      ["Bruno", "aluno"],
    ]);
    expect(mine.vehicles.map((v: { plate: string }) => v.plate)).toEqual(["ABC1D23", "XYZ9876"]);
  });

  it("a organização da equipe continua só com o NUCEV e o SAD; outra pessoa não vê nada", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    await aluno.post(`/api/events/${id}/organization/people`).send({ kind: "ORGANIZER", name: "Eu mesmo" }).expect(403);
    await aluno.post(`/api/events/${id}/organization/schedule`).send({ date: day1, start: "09:00", end: "10:00", title: "Abertura" }).expect(403);
    const outro = await loginAs(app, "outro@usp.br");
    await outro.get(`/api/events/${id}/guests`).expect(404);
    await outro.post(`/api/events/${id}/vehicles`).send({ plate: "DEF4567" }).expect(404);
    // A equipe vê o que foi informado desde o pedido, e também edita.
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    const org = (await nucev.get(`/api/events/${id}/organization`).expect(200)).body;
    expect(org).toMatchObject({ editable: false, guestsEditable: true });
    expect(org.vehicles).toHaveLength(2);
    const vehicle = org.vehicles[1];
    await nucev.patch(`/api/events/${id}/vehicles/${vehicle.id}`).send({ plate: "XYZ9876", model: "Onix branco" }).expect(200);
    await nucev.delete(`/api/events/${id}/vehicles/${vehicle.id}`).expect(200);
  });

  it("pedido cancelado: as listas ficam só para consulta", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    await aluno.post(`/api/events/${id}/cancel`).send({}).expect(200);
    expect((await aluno.get(`/api/events/${id}/guests`).expect(200)).body.editable).toBe(false);
    expect((await aluno.post(`/api/events/${id}/vehicles`).send({ plate: "GHI1J23" }).expect(409)).body.error.code).toBe("EVENT_CLOSED");
    await aluno.post(`/api/events/${id}/organization/people`).send({ kind: "PARTICIPANT", name: "Depois" }).expect(409);
  });
});
