import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMissingSupportAreas, SUPPORT_AREAS } from "../../prisma/support-areas";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("aluno@usp.br");
});

afterAll(() => prisma.$disconnect());

const atrium = {
  name: "Átrio de teste",
  building: "Prédio Teste",
  floor: "Térreo",
  capacity: null,
  roomType: "SUPPORT_AREA",
  coffeeAllowed: true,
  recommendedAbove: 250,
  requiresBoardApproval: true,
  usageRules: "Só com autorização da Diretoria Executiva.",
};

describe("Áreas de apoio e coffee break no cadastro de espaços (Fase 9, bloco 3)", () => {
  it("área de apoio fica Ativa sem capacidade; sala, não", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const created = await sad.post("/api/rooms").send(atrium).expect(201);
    expect(created.body.room).toMatchObject({ capacity: null, status: "ACTIVE", recommendedAbove: 250, requiresBoardApproval: true });

    const classroom = await sad.post("/api/rooms").send({ ...atrium, name: "Sala sem capacidade", roomType: "CLASSROOM" }).expect(400);
    expect(JSON.stringify(classroom.body.error)).toContain("Informe a capacidade para deixar a sala Ativa.");

    // Virar sala sem informar a capacidade também é recusado.
    const patch = await sad.patch(`/api/rooms/${created.body.room.id}`).send({ roomType: "CLASSROOM" }).expect(400);
    expect(patch.body.error.code).toBe("CAPACITY_REQUIRED");
  });

  it("desligar o coffee apaga o máximo do coffee, e a mudança vai para o histórico", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const hall = await sad
      .post("/api/rooms")
      .send({ ...atrium, name: "Hall de teste", capacity: 100, coffeeCapacity: 60, requiresBoardApproval: false })
      .expect(201);
    expect(hall.body.room.coffeeCapacity).toBe(60);

    const res = await sad.patch(`/api/rooms/${hall.body.room.id}`).send({ coffeeAllowed: false }).expect(200);
    expect(res.body.room).toMatchObject({ coffeeAllowed: false, coffeeCapacity: null });

    const [entry] = await prisma.auditLog.findMany({ where: { action: "room.update", entityId: hall.body.room.id } });
    expect(entry!.changes).toEqual({ coffeeAllowed: { from: true, to: false }, coffeeCapacity: { from: 60, to: null } });
  });

  it("o solicitante vê o coffee, a indicação de público, a autorização e as regras", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    const { body } = await aluno.get("/api/rooms?status=ACTIVE").expect(200);
    const room = body.rooms.find((r: { name: string }) => r.name === atrium.name);
    expect(room).toMatchObject({
      coffeeAllowed: true,
      recommendedAbove: 250,
      requiresBoardApproval: true,
      usageRules: atrium.usageRules,
    });
  });

  it("a carga das áreas de apoio só cria o que falta e não mexe no que o SAD editou", async () => {
    expect(await createMissingSupportAreas(prisma)).toBe(SUPPORT_AREAS.length);
    const first = SUPPORT_AREAS[0]!;
    await prisma.room.update({
      where: { building_floor_name: { building: first.building, floor: first.floor, name: first.name } },
      data: { usageRules: "Editado pelo SAD" },
    });

    expect(await createMissingSupportAreas(prisma)).toBe(0);
    const edited = await prisma.room.findUniqueOrThrow({
      where: { building_floor_name: { building: first.building, floor: first.floor, name: first.name } },
    });
    expect(edited.usageRules).toBe("Editado pelo SAD");
  });
});
