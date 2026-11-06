import type { PriceCategory, PriceTable } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey } from "../../src/lib/timezone";
import { priceText } from "../../src/prices/catalog";
import { createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let amphitheaters: PriceCategory;
let classrooms: PriceCategory;
let table2794: PriceTable;

const inDays = (days: number) => zonedDateKey(new Date(Date.now() + days * 86_400_000));

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("vanessa@fm.usp.br", "NUCEV");
  await createUser("aluno@usp.br");
  // A migration price_tables carrega a Portaria 2794; o banco dos testes é zerado, então recria o essencial.
  amphitheaters = await prisma.priceCategory.create({ data: { name: "Anfiteatros", unit: "HOUR", didactic: true, position: 1 } });
  classrooms = await prisma.priceCategory.create({ data: { name: "Salas de aula e salas de reunião", unit: "HOUR", didactic: true, position: 2 } });
  table2794 = await prisma.priceTable.create({
    data: {
      name: "Portaria 2794/2026",
      validFrom: new Date("2026-06-02T00:00:00Z"),
      entries: { create: [{ categoryId: amphitheaters.id, amountCents: 37500 }, { categoryId: classrooms.id, amountCents: null }] },
    },
  });
});

afterAll(() => prisma.$disconnect());

describe("Preços da Portaria 2794 (Fase 9, bloco 4)", () => {
  it("espaço novo recebe a categoria pelo tipo, e todos veem o valor vigente", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const created = await sad
      .post("/api/rooms")
      .send({ name: "Anfiteatro Teste", building: "Prédio Teste", floor: "1º andar", capacity: 90, roomType: "AUDITORIUM" })
      .expect(201);
    expect(created.body.room.priceCategoryId).toBe(amphitheaters.id);

    const aluno = await loginAs(app, "aluno@usp.br");
    const { body } = await aluno.get(`/api/rooms/${created.body.room.id}`).expect(200);
    expect(body.room.price).toMatchObject({ categoryName: "Anfiteatros", unit: "HOUR", amountCents: 37500, tableName: "Portaria 2794/2026" });

    // Valor a definir: a categoria existe, o valor não.
    const sala = await sad
      .post("/api/rooms")
      .send({ name: "Sala Teste", building: "Prédio Teste", floor: "1º andar", capacity: 30, roomType: "CLASSROOM" })
      .expect(201);
    expect(sala.body.room.price).toMatchObject({ categoryName: "Salas de aula e salas de reunião", amountCents: null });

    // Sem categoria (a definir também): o preço vem nulo.
    const semPreco = await sad.patch(`/api/rooms/${sala.body.room.id}`).send({ priceCategoryId: null }).expect(200);
    expect(semPreco.body.room.price).toBeNull();
  });

  it("o SAD muda um valor e o Histórico guarda o antes e o depois; o NUCEV só consulta", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    await nucev.get("/api/prices").expect(200);
    await nucev.patch(`/api/prices/tables/${table2794.id}`).send({ minimumHours: 3 }).expect(403);

    const sad = await loginAs(app, "admin@fm.usp.br");
    await sad
      .patch(`/api/prices/tables/${table2794.id}`)
      .send({ entries: [{ categoryId: amphitheaters.id, amountCents: 39000 }], coffeeSurchargePercent: 25 })
      .expect(200);

    const [entry] = await prisma.auditLog.findMany({ where: { action: "price.table_update", entityId: table2794.id } });
    expect(entry!.changes).toEqual({
      coffeeSurchargePercent: { from: 20, to: 25 },
      Anfiteatros: { from: priceText(37500, "HOUR"), to: priceText(39000, "HOUR") },
    });
  });

  it("reajuste: tabela nova a partir de uma data, sem apagar a anterior", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const future = await sad
      .post("/api/prices/tables")
      .send({ copyFromId: table2794.id, name: "Reajuste 2027", validFrom: inDays(30) })
      .expect(201);
    expect(future.body.table.entries).toHaveLength(2);

    // Ainda vale a de 2026; a nova aparece na lista.
    const { body } = await sad.get("/api/prices").expect(200);
    expect(body.currentTableId).toBe(table2794.id);
    expect(body.tables.map((t: { name: string }) => t.name)).toEqual(["Reajuste 2027", "Portaria 2794/2026"]);

    // Mesma data de início: recusado.
    const dup = await sad.post("/api/prices/tables").send({ copyFromId: table2794.id, name: "Outra", validFrom: inDays(30) }).expect(409);
    expect(dup.body.error.code).toBe("PRICE_TABLE_DATE_TAKEN");

    // A que já vale não é apagada; a futura, sim.
    expect((await sad.delete(`/api/prices/tables/${table2794.id}`).expect(409)).body.error.code).toBe("PRICE_TABLE_IN_FORCE");
    await sad.delete(`/api/prices/tables/${future.body.table.id}`).expect(204);
  });
});
