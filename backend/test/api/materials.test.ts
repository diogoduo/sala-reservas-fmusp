import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();

beforeAll(async () => {
  await resetDatabase();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("maria@fm.usp.br", "NUCEV");
  await createUser("aluno@usp.br");
});

afterAll(() => prisma.$disconnect());

describe("Controle de pranchões (Fase 18)", () => {
  let itemId: string;
  let loanId: string;

  it("cadastra o estoque; quem não é da equipe não vê", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const { body } = await sad.post("/api/materials/items").send({ name: "Pranchão", total: 40, homeLocation: "Depósito do SAD" }).expect(201);
    itemId = body.item.id;
    await sad.post("/api/materials/items").send({ name: "Pranchão", total: 5, homeLocation: "Outro" }).expect(409);
    await (await loginAs(app, "aluno@usp.br")).get("/api/materials").expect(403);
  });

  it("retirada: em uso e disponível; não deixa passar do que há (nem em retiradas ao mesmo tempo)", async () => {
    const maria = await loginAs(app, "maria@fm.usp.br");
    const { body } = await maria.post(`/api/materials/items/${itemId}/checkout`).send({ quantity: 25, location: "Foyer do Teatro", takenBy: "Seu João (manutenção)" }).expect(201);
    loanId = body.loan.id;
    // Duas retiradas de 10 ao mesmo tempo, com 15 disponíveis: só uma passa.
    const results = await Promise.all([
      maria.post(`/api/materials/items/${itemId}/checkout`).send({ quantity: 10, location: "Átrio", takenBy: "Ana" }),
      maria.post(`/api/materials/items/${itemId}/checkout`).send({ quantity: 10, location: "Átrio", takenBy: "Bia" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const { body: state } = await maria.get("/api/materials").expect(200);
    expect(state.items[0]).toMatchObject({ total: 40, inUse: 35, available: 5 });
    await maria.post(`/api/materials/items/${itemId}/checkout`).send({ quantity: 1, location: "Xis", takenBy: "Caio", reservationProtocol: "999999/2099" }).expect(400);
  });

  it("movimentação, devolução em partes e o histórico", async () => {
    const maria = await loginAs(app, "maria@fm.usp.br");
    await maria.post(`/api/materials/loans/${loanId}/move`).send({ toLocation: "Teatro (palco)", movedBy: "Seu João" }).expect(200);
    const part = await maria.post(`/api/materials/loans/${loanId}/return`).send({ quantity: 20, returnedBy: "Seu João" }).expect(200);
    expect(part.body.loan).toMatchObject({ returnedQuantity: 20, returnedAt: null, location: "Teatro (palco)" });
    await maria.post(`/api/materials/loans/${loanId}/return`).send({ quantity: 10, returnedBy: "Seu João" }).expect(400);
    const all = await maria.post(`/api/materials/loans/${loanId}/return`).send({ returnedBy: "Dona Ana" }).expect(200);
    expect(all.body.loan).toMatchObject({ returnedQuantity: 25, returnedBy: "Dona Ana" });
    expect(all.body.loan.returnedAt).not.toBeNull();
    await maria.post(`/api/materials/loans/${loanId}/return`).send({ returnedBy: "Xavier" }).expect(409);
    const { body } = await maria.get("/api/materials").expect(200);
    expect(body.items[0]).toMatchObject({ inUse: 10, available: 30 });
    expect(body.movements.map((m: { kind: string }) => m.kind)).toEqual(expect.arrayContaining(["ADJUST", "CHECKOUT", "MOVE", "RETURN"]));
  });

  it("ajuste do estoque: não fica abaixo do que está em uso", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    await sad.patch(`/api/materials/items/${itemId}`).send({ total: 5 }).expect(409);
    await sad.patch(`/api/materials/items/${itemId}`).send({ total: 38, reason: "Dois quebrados" }).expect(200);
    const adjust = await prisma.materialMovement.findFirst({ where: { itemId, kind: "ADJUST", quantity: -2 } });
    expect(adjust).toMatchObject({ notes: "Dois quebrados" });
    expect(await prisma.auditLog.count({ where: { entityType: "material" } })).toBeGreaterThanOrEqual(6);
  });
});
