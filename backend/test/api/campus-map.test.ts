import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { createRoom, createUser, loginAs, resetDatabase } from "./helpers";

const app = createApp();
let roomId: string;

beforeAll(async () => {
  await resetDatabase();
  await prisma.mapFloorPlan.deleteMany();
  await prisma.mapBuilding.deleteMany();
  await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("aluno@usp.br");
  roomId = (await createRoom("Sala de Aula 1107", 40)).id;
  const building = await prisma.mapBuilding.create({
    data: { name: "Prédio Teste", floors: { "1º andar": [{ x: 0, y: 0, w: 100, h: 20, label: "ala horizontal" }] }, landmarks: [{ floor: "*", kind: "STAIRS", label: "Escada 1", x: 50, y: 10 }] },
  });
  await prisma.mapFloorPlan.create({ data: { buildingId: building.id, floor: "1º andar", image: Buffer.from("RIFF0000WEBP"), mimeType: "image/webp", bounds: { x: 0, y: 0, w: 100, h: 20 } } });
});

afterAll(() => prisma.$disconnect());

describe("Mapa 3D da faculdade", () => {
  it("todos veem os prédios, as plantas e a posição das salas", async () => {
    const aluno = await loginAs(app, "aluno@usp.br");
    const { body } = await aluno.get("/api/campus-map").expect(200);
    expect(body.buildings[0]).toMatchObject({ name: "Prédio Teste", landmarks: [{ kind: "STAIRS" }] });
    expect(body.buildings[0].plans).toEqual([expect.objectContaining({ floor: "1º andar", bounds: { x: 0, y: 0, w: 100, h: 20 } })]);
    expect(body.rooms.find((r: { id: string }) => r.id === roomId)).toMatchObject({ mapX: null, mapY: null });
    const image = await aluno.get(`/api/campus-map/plans/${body.buildings[0].plans[0].id}`).expect(200);
    expect(image.headers["content-type"]).toBe("image/webp");
  });

  it("só o SAD posiciona a sala; fica no Histórico", async () => {
    await (await loginAs(app, "aluno@usp.br")).patch(`/api/campus-map/rooms/${roomId}`).send({ mapX: 10, mapY: 5 }).expect(403);
    const sad = await loginAs(app, "admin@fm.usp.br");
    const { body } = await sad.patch(`/api/campus-map/rooms/${roomId}`).send({ mapX: 10.123, mapY: 5 }).expect(200);
    expect(body.room).toMatchObject({ mapX: 10.12, mapY: 5 });
    await sad.patch(`/api/campus-map/rooms/${roomId}`).send({ mapX: null, mapY: null }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: "map.room_position", entityId: roomId } })).toBe(2);
  });
});
