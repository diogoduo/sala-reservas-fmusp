import type { Room } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { expireOverduePreReservations } from "../../src/events/expiry";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey } from "../../src/lib/timezone";
import { createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let salaA: Room;
let salaB: Room;
let atrio: Room;
let eventId: string;
let salasCategoryId: string;

const inDays = (days: number) => zonedDateKey(new Date(Date.now() + days * 86_400_000));
const day1 = inDays(20);
const day2 = inDays(21);

const eventBody = (extra: Record<string, unknown> = {}) => ({
  title: "Simpósio de Teste",
  kind: "CONGRESS",
  description: "Programação de teste.",
  targetAudience: "Alunos",
  expectedAttendees: 160,
  entity: "DEPARTMENT",
  hasRegistrationFee: false,
  sponsored: false,
  responsible: "Prof. Teste",
  responsibleContact: "teste@fm.usp.br",
  department: "Departamento Teste",
  termsAccepted: true,
  days: [
    { date: day1, start: "08:00", end: "18:00" },
    { date: day2, start: "08:00", end: "18:00" },
  ],
  spaces: [
    { categoryId: salasCategoryId, count: 2, minCapacity: 80, purpose: "Salas das mesas" },
    { roomId: atrio.id, purpose: "Coffee break", dates: [day1] },
  ],
  ...extra,
});

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("vanessa@fm.usp.br", "NUCEV");
  await createUser("aluno@usp.br");
  await createUser("outro@usp.br");
  const salas = await prisma.priceCategory.create({ data: { name: "Salas de aula e salas de reunião", unit: "HOUR", didactic: true } });
  const atrios = await prisma.priceCategory.create({ data: { name: "Átrio (por átrio)", unit: "HOUR", didactic: false } });
  salasCategoryId = salas.id;
  await prisma.priceTable.create({
    data: {
      name: "Portaria 2794/2026",
      validFrom: new Date("2026-06-02T00:00:00Z"),
      entries: { create: [{ categoryId: salas.id, amountCents: 12500 }, { categoryId: atrios.id, amountCents: 150000 }] },
    },
  });
  const room = (name: string, capacity: number | null, extra = {}) =>
    prisma.room.create({ data: { name, building: "Prédio Teste", floor: "1º andar", capacity, roomType: "CLASSROOM", priceCategoryId: salas.id, ...extra } });
  salaA = await room("Sala A", 90);
  salaB = await room("Sala B", 90);
  atrio = await room("Átrio Teste", null, { roomType: "SUPPORT_AREA", priceCategoryId: atrios.id, requiresBoardApproval: true, coffeeAllowed: true });

  const aluno = await loginAs(app, "aluno@usp.br");
  eventId = (await aluno.post("/api/events").send(eventBody()).expect(201)).body.event.id;
});

afterAll(() => prisma.$disconnect());

describe("Gestão do evento (Fase 12)", () => {
  it("o NUCEV inicia a análise e fica como responsável; a pré-reserva é só do SAD", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    await nucev.post(`/api/events/${eventId}/review`).expect(200);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(event).toMatchObject({ status: "IN_REVIEW", assigneeName: "vanessa" });
    await nucev.post(`/api/events/${eventId}/pre-reserve`).send({ validUntil: inDays(10), allocations: [] }).expect(403);
  });

  it("o SAD vê as salas que servem e pré-reserva com a validade que escolhe; a sala fica ocupada", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const { body } = await sad.get(`/api/events/${eventId}/candidates`).expect(200);
    expect(body.spaces[0].rooms.map((r: { name: string }) => r.name)).toEqual(["Sala A", "Sala B"]);
    expect(body.spaces[1]).toMatchObject({ needed: 1, dates: [day1] });

    const [space1, space2] = body.spaces;
    await sad
      .post(`/api/events/${eventId}/pre-reserve`)
      .send({ validUntil: inDays(10), allocations: [{ spaceId: space1.spaceId, roomIds: [salaA.id, salaB.id] }, { spaceId: space2.spaceId, roomIds: [atrio.id] }] })
      .expect(200);
    const reservations = await prisma.reservation.findMany({ where: { eventId, status: "APPROVED" } });
    expect(reservations).toHaveLength(5); // 2 salas × 2 dias + o átrio no 1º dia
    expect(reservations.every((r) => r.preReservedUntil !== null)).toBe(true);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe("PRE_RESERVED");

    // Outro evento não consegue a mesma sala no mesmo dia.
    const outro = await loginAs(app, "outro@usp.br");
    const other = (await outro.post("/api/events").send(eventBody({ title: "Outro evento" })).expect(201)).body.event;
    const candidates = (await sad.get(`/api/events/${other.id}/candidates`).expect(200)).body.spaces;
    expect(candidates[0].rooms[0].busyDates).toEqual([day1, day2]);
    const conflict = await sad
      .post(`/api/events/${other.id}/pre-reserve`)
      .send({ validUntil: inDays(10), allocations: [{ spaceId: candidates[0].spaceId, roomIds: [salaA.id] }] })
      .expect(409);
    expect(conflict.body.error.code).toBe("ROOM_CONFLICT");

    // O NUCEV recusa esse outro pedido, com o motivo.
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    await nucev.post(`/api/events/${other.id}/reject`).send({ reason: "Sem salas na data" }).expect(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("REJECTED");
  });

  it("orçamento das salas pré-reservadas, com versões: alteração pedida, isenção e aprovação", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    // Salas: 2 × 2 dias × (10 h + 2 h) × R$ 125; átrio: 10 h × R$ 1.500. Departamento da FMUSP: −25%.
    const preview = (await nucev.post(`/api/events/${eventId}/quotes/preview`).send({}).expect(200)).body;
    expect(preview.quote).toMatchObject({ subtotalCents: 2_100_000, discountCents: 525_000, totalCents: 1_575_000 });
    const v1 = (await nucev.post(`/api/events/${eventId}/quotes`).send({ notes: "Valores da Portaria 2794." }).expect(201)).body.quote;
    expect(v1).toMatchObject({ version: 1, status: "SENT", totalCents: 1_575_000 });

    const aluno = await loginAs(app, "aluno@usp.br");
    await aluno.post(`/api/events/${eventId}/quotes/${v1.id}/decision`).send({ decision: "CHANGES" }).expect(400);
    await aluno.post(`/api/events/${eventId}/quotes/${v1.id}/decision`).send({ decision: "CHANGES", note: "Somos da FMUSP, sem inscrição." }).expect(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe("CHANGES_REQUESTED");

    const v2 = (await nucev.post(`/api/events/${eventId}/quotes`).send({ exemptionReason: "Evento institucional sem inscrição (Art. 4º I)" }).expect(201)).body.quote;
    expect(v2).toMatchObject({ version: 2, totalCents: 0 });
    expect((await prisma.eventQuote.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("SUPERSEDED");
    // A versão antiga não aceita mais resposta.
    await aluno.post(`/api/events/${eventId}/quotes/${v1.id}/decision`).send({ decision: "APPROVE" }).expect(409);
    await aluno.post(`/api/events/${eventId}/quotes/${v2.id}/decision`).send({ decision: "APPROVE" }).expect(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe("QUOTE_APPROVED");
  });

  it("autorização da Diretoria pelo link do e-mail, sem login", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    await nucev.post(`/api/events/${eventId}/authorization`).send({ note: "Coffee no átrio" }).expect(201);
    await nucev.post(`/api/events/${eventId}/authorization`).send({}).expect(409);
    const notice = await prisma.eventNotice.findFirstOrThrow({ where: { eventId, to: { has: "diretoria.demo@fm.usp.br" } } });
    const token = notice.link!.split("/autorizacao/")[1]!;

    const publicAgent = (await import("supertest")).default.agent(app);
    const page = (await publicAgent.get(`/api/authorizations/${token}`).expect(200)).body;
    expect(page).toMatchObject({ authorization: { status: "PENDING", spaces: "Átrio Teste" }, event: { title: "Simpósio de Teste" } });
    await publicAgent.post(`/api/authorizations/${token}`).send({ decision: "AUTHORIZE", note: "De acordo." }).expect(200);
    await publicAgent.post(`/api/authorizations/${token}`).send({ decision: "DENY" }).expect(409);
    await publicAgent.get("/api/authorizations/token-que-nao-existe").expect(404);
  });

  it("conversa e e-mails: cada lado vê o que é dele; o token da Diretoria não aparece para o solicitante", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    await aluno.post(`/api/events/${eventId}/messages`).send({ body: "Podemos montar às 7h?" }).expect(201);
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    await nucev.post(`/api/events/${eventId}/messages`).send({ body: "Pode, sim." }).expect(201);

    const mine = (await aluno.get(`/api/events/${eventId}`).expect(200)).body.management;
    expect(mine.messages.map((m: { body: string }) => m.body)).toEqual(["Podemos montar às 7h?", "Pode, sim."]);
    expect(mine.notices.every((n: { to: string[] }) => n.to.includes("aluno@usp.br"))).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("/autorizacao/");
    expect(mine.authorizations[0]).toMatchObject({ status: "AUTHORIZED" });
    expect(mine.reservations).toHaveLength(5);

    const staff = (await nucev.get(`/api/events/${eventId}`).expect(200)).body.management;
    expect(staff.notices.some((n: { link: string | null }) => n.link?.includes("/autorizacao/"))).toBe(true);
  });

  it("pré-reserva vencida: o sistema cancela as reservas e libera as salas", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { preReservedUntil: new Date(Date.now() - 60_000) } });
    expect(await expireOverduePreReservations()).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe("EXPIRED");
    expect(await prisma.reservation.count({ where: { eventId, status: "APPROVED" } })).toBe(0);
    const [entry] = await prisma.auditLog.findMany({ where: { action: "event.expire" } });
    expect(entry).toMatchObject({ actorId: null });
  });
});
