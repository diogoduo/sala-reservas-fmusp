import type { PriceCategory, Room, User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey, zonedTime } from "../../src/lib/timezone";
import { createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let salas: PriceCategory;
let atrios: PriceCategory;
let sala90a: Room;
let atrio: Room;
let aluno: User;

const inDays = (days: number) => zonedDateKey(new Date(Date.now() + days * 86_400_000));
const day1 = inDays(20);
const day2 = inDays(21);

const eventBody = (extra: Record<string, unknown> = {}) => ({
  title: "Jornada de Teste",
  kind: "CONGRESS",
  description: "Programação de teste.",
  targetAudience: "Alunos",
  expectedAttendees: 180,
  entity: "DEPARTMENT",
  hasRegistrationFee: false,
  sponsored: false,
  responsible: "Prof. Teste",
  responsibleContact: "teste@fm.usp.br",
  department: "Departamento Teste",
  coffeeBreak: true,
  coffeeAttendees: 180,
  termsAccepted: true,
  days: [
    { date: day1, start: "08:00", end: "18:00", setupMinutes: 60 },
    { date: day2, start: "08:00", end: "18:00" },
  ],
  spaces: [
    { categoryId: salas.id, count: 2, minCapacity: 80, purpose: "Salas das mesas" },
    { roomId: atrio.id, purpose: "Coffee break", dates: [day1] },
  ],
  ...extra,
});

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("vanessa@fm.usp.br", "NUCEV");
  await createUser("juliana@fm.usp.br", "USER", ["REQUEST_UNDERGRADUATE", "REQUEST_GRADUATE"]);
  aluno = await createUser("aluno@usp.br");
  await createUser("outro@usp.br");
  salas = await prisma.priceCategory.create({ data: { name: "Salas de aula e salas de reunião", unit: "HOUR", didactic: true } });
  atrios = await prisma.priceCategory.create({ data: { name: "Átrio (por átrio)", unit: "HOUR", didactic: false } });
  await prisma.priceTable.create({
    data: {
      name: "Portaria 2794/2026",
      validFrom: new Date("2026-06-02T00:00:00Z"),
      entries: { create: [{ categoryId: salas.id, amountCents: 12500 }, { categoryId: atrios.id, amountCents: 150000 }] },
    },
  });
  const room = (name: string, capacity: number | null, extra = {}) =>
    prisma.room.create({ data: { name, building: "Prédio Teste", floor: "1º andar", capacity, roomType: "CLASSROOM", priceCategoryId: salas.id, ...extra } });
  sala90a = await room("Sala 90 A", 90);
  await room("Sala 90 B", 90);
  await room("Sala 50", 50);
  atrio = await room("Átrio Teste", null, { roomType: "SUPPORT_AREA", priceCategoryId: atrios.id });
  // A Sala 90 A já está ocupada na manhã do 1º dia.
  await prisma.reservation.create({
    data: {
      protocol: "000001/2099", userId: aluno.id, roomId: sala90a.id, title: "Aula", description: "[teste]", activityType: "ADMINISTRATIVE",
      expectedAttendees: 10, termsAccepted: true, status: "APPROVED", startTime: zonedTime(day1, "09:00"), endTime: zonedTime(day1, "11:00"),
    },
  });
});

afterAll(() => prisma.$disconnect());

describe("Solicitar evento (Fase 11)", () => {
  it("é de quem pede Cultura e Extensão: sem essa permissão, 403", async () => {
    const juliana = await loginAs(app, "juliana@fm.usp.br");
    const res = await juliana.post("/api/events").send(eventBody()).expect(403);
    expect(res.body.error.code).toBe("ACTIVITY_NOT_ALLOWED");
  });

  it("mostra quantos espaços livres há em cada dia, com sugestões", async () => {
    const agent = await loginAs(app, "aluno@usp.br");
    const { body } = await agent
      .post("/api/events/availability")
      .send({ days: eventBody().days, spaces: eventBody().spaces })
      .expect(200);
    // 2 salas para 80+: no 1º dia só a 90 B está livre; no 2º, as duas.
    expect(body.spaces[0].days).toEqual([
      { date: day1, needed: 2, free: 1, suggestions: ["Sala 90 B"] },
      { date: day2, needed: 2, free: 2, suggestions: ["Sala 90 A", "Sala 90 B"] },
    ]);
    // O átrio só no 1º dia.
    expect(body.spaces[1].days).toEqual([{ date: day1, needed: 1, free: 1, suggestions: ["Átrio Teste"] }]);
  });

  it("o pedido entra como Recebido, com protocolo, dias, espaços e o orçamento estimado", async () => {
    const agent = await loginAs(app, "aluno@usp.br");
    const { body } = await agent.post("/api/events").send(eventBody()).expect(201);
    expect(body.event).toMatchObject({ status: "SUBMITTED", institutional: true, title: "Jornada de Teste" });
    // A sequência não volta a 1 entre as rodadas de teste: confere o formato.
    expect(body.event.protocol).toMatch(/^EV-\d{6}\/\d{4}$/);
    expect(body.event.days).toEqual([
      expect.objectContaining({ date: day1, start: "08:00", end: "18:00", setupMinutes: 60 }),
      expect.objectContaining({ date: day2, start: "08:00", end: "18:00", setupMinutes: 0 }),
    ]);
    // Salas: 1º dia 11 h de uso (com a montagem) + 2 h; 2º dia 10 h + 2 h = 25 h × R$ 125 × 2 salas.
    // Átrio: 11 h × R$ 1.500 no 1º dia. Unidade da FMUSP: −25%.
    const quote = body.event.estimate.quote;
    expect(quote.lines.map((l: { subtotalCents: number }) => l.subtotalCents)).toEqual([625_000, 1_650_000]);
    expect(quote).toMatchObject({ subtotalCents: 2_275_000, discountCents: 568_750, totalCents: 1_706_250 });

    const [entry] = await prisma.auditLog.findMany({ where: { action: "event.request" } });
    expect(entry).toMatchObject({ entityType: "event", entityId: body.event.protocol });

    // E-mails: a confirmação para quem pediu e o aviso para o NUCEV e o SAD.
    const notices = await prisma.eventNotice.findMany({ where: { eventId: body.event.id } });
    const received = notices.find((n) => n.subject === "Pedido de evento recebido: Jornada de Teste");
    const staff = notices.find((n) => n.subject === "Novo pedido de evento: Jornada de Teste");
    expect(received?.to).toEqual(["aluno@usp.br"]);
    expect(received?.body).toContain(body.event.protocol);
    expect(staff?.to.sort()).toEqual(["admin@fm.usp.br", "vanessa@fm.usp.br"]);
  });

  it("o solicitante vê os seus; outra pessoa não; o NUCEV e o SAD veem todos", async () => {
    const agent = await loginAs(app, "aluno@usp.br");
    const mine = (await agent.get("/api/events/mine").expect(200)).body.events;
    expect(mine).toHaveLength(1);

    const outro = await loginAs(app, "outro@usp.br");
    await outro.get(`/api/events/${mine[0].id}`).expect(404);
    await outro.get("/api/events").expect(403);

    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    const detail = await nucev.get(`/api/events/${encodeURIComponent(mine[0].protocol)}`).expect(200);
    // Departamento da FMUSP, sem inscrição e sem patrocínio: pode ser isento (Art. 4º I).
    expect(detail.body.possiblyExempt).toBe(true);
    expect((await nucev.get("/api/events?status=SUBMITTED").expect(200)).body.events).toHaveLength(1);
    // O pedido novo entra nas pendências do SAD, para pré-reservar.
    const pending = (await nucev.get("/api/events/sad-pending").expect(200)).body.events;
    expect(pending.map((e: { id: string; sadAction: string }) => [e.id, e.sadAction])).toEqual([[mine[0].id, "PRE_RESERVE"]]);
    await outro.get("/api/events/sad-pending").expect(403);
  });

  it("cancelar antes da pré-reserva; depois de cancelado, não dá de novo", async () => {
    const agent = await loginAs(app, "aluno@usp.br");
    const [event] = (await agent.get("/api/events/mine")).body.events;
    const res = await agent.post(`/api/events/${event.id}/cancel`).send({ reason: "Mudou a data" }).expect(200);
    expect(res.body.event.status).toBe("CANCELLED");
    const confirmation = await prisma.eventNotice.findFirstOrThrow({ where: { eventId: event.id, subject: { startsWith: "Cancelamento registrado" } } });
    expect(confirmation.to).toEqual(["aluno@usp.br"]);
    await agent.post(`/api/events/${event.id}/cancel`).send({}).expect(409);
  });

  it("valida: 3 dias de antecedência, dias repetidos e coffee sem número de pessoas", async () => {
    const agent = await loginAs(app, "aluno@usp.br");
    const soon = await agent.post("/api/events").send(eventBody({ days: [{ date: inDays(1), start: "08:00", end: "12:00" }], spaces: [{ categoryId: salas.id }] })).expect(400);
    expect(soon.body.error.code).toBe("BOOKING_TOO_SOON");
    await agent.post("/api/events").send(eventBody({ days: [eventBody().days[0], eventBody().days[0]] })).expect(400);
    await agent.post("/api/events").send(eventBody({ coffeeAttendees: undefined })).expect(400);
  });
});
