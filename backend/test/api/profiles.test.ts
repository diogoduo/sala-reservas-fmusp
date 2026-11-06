import type { Room, User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { zonedDateKey } from "../../src/lib/timezone";
import { upcoming } from "../dates";
import {
  createPendingReservation,
  createRoom,
  createUser,
  loginAs,
  meetingRequest,
  publicExamRequest,
  resetDatabase,
  undergraduateRequest,
} from "./helpers";

const app = createApp();
let room: Room;
let aluno: User;
let admin: User;
let pendingId: string;

beforeAll(async () => {
  await resetDatabase();
  aluno = await createUser("aluno@usp.br");
  admin = await createUser("admin@fm.usp.br", "ADMIN");
  await createUser("juliana@fm.usp.br", "USER", ["REQUEST_UNDERGRADUATE", "REQUEST_GRADUATE"]);
  await createUser("sueli@fm.usp.br", "USER", ["REQUEST_DEFENSE", "REQUEST_GRADUATE"]);
  await createUser("vanessa@fm.usp.br", "NUCEV");
  await createUser("outra@fm.usp.br");
  room = await createRoom("Sala 101");
  const start = upcoming(4, 10, "09:00");
  pendingId = (await createPendingReservation(aluno.id, start, new Date(start.getTime() + 3_600_000))).id;
});

afterAll(() => prisma.$disconnect());

const aula = (title: string) => {
  const start = upcoming(2, 10, "08:00");
  return undergraduateRequest(title, start, new Date(start.getTime() + 2 * 3_600_000));
};

describe("Graduação, Pós e Defesa são exclusivos de quem tem permissão", () => {
  it("sem permissão: 403; com permissão: o pedido entra", async () => {
    const semPermissao = await loginAs(app, "aluno@usp.br");
    const res = await semPermissao.post("/api/reservations").send(aula("Anatomia")).expect(403);
    expect(res.body.error.code).toBe("ACTIVITY_NOT_ALLOWED");
    expect(res.body.error.message).toContain("Graduação");

    const juliana = await loginAs(app, "juliana@fm.usp.br");
    await juliana.post("/api/reservations").send(aula("Anatomia")).expect(201);
  });

  it("Cultura e Extensão e Concurso vêm no padrão, e o SAD pode tirar; Reunião é de todos", async () => {
    const start = upcoming(3, 10, "14:00");
    const end = new Date(start.getTime() + 2 * 3_600_000);
    // Quem entra pela primeira vez já pede Concurso.
    const novo = await loginAs(app, "novo@fm.usp.br");
    expect((await novo.get("/api/auth/me").expect(200)).body.user.permissions).toEqual(["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"]);
    await novo.post("/api/reservations").send(publicExamRequest("Concurso de docente", start, end)).expect(201);

    // Sueli só tem Defesa e Pós: Concurso é recusado, Reunião entra.
    const sueli = await loginAs(app, "sueli@fm.usp.br");
    const res = await sueli.post("/api/reservations").send(publicExamRequest("Concurso", start, end)).expect(403);
    expect(res.body.error.message).toContain("Concurso");
    await sueli.post("/api/reservations").send(meetingRequest("Reunião da CPG", start, end)).expect(201);
  });

  it("a permissão dada pelo SAD vale na hora, sem novo login, e fica no histórico", async () => {
    const agent = await loginAs(app, "aluno@usp.br");
    await agent.post("/api/reservations").send(aula("Fisiologia")).expect(403);

    const sad = await loginAs(app, "admin@fm.usp.br");
    const granted = ["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM", "REQUEST_UNDERGRADUATE"];
    const res = await sad.patch(`/api/admin/users/${aluno.id}`).send({ permissions: ["REQUEST_UNDERGRADUATE", "REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"] }).expect(200);
    expect(res.body.user.permissions).toEqual(granted);
    await agent.post("/api/reservations").send(aula("Fisiologia")).expect(201);

    const [entry] = await prisma.auditLog.findMany({ where: { action: "user.update", entityId: aluno.id } });
    expect(entry).toMatchObject({ actorId: admin.id });
    expect(entry!.changes).toEqual({ permissions: { from: ["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"], to: granted } });

    // Tirar a permissão também vale na hora.
    await sad.patch(`/api/admin/users/${aluno.id}`).send({ permissions: ["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"] }).expect(200);
    await agent.post("/api/reservations").send(aula("Bioquímica")).expect(403);
  });
});

describe("NUCEV acompanha tudo, mas quem age é o SAD", () => {
  it("consulta a fila, a agenda, o histórico e a situação do solicitante", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    await nucev.get("/api/admin/reservations").expect(200);
    await nucev.get(`/api/admin/agenda?date=${zonedDateKey(new Date())}`).expect(200);
    await nucev.get("/api/audit").expect(200);
    await nucev.get(`/api/admin/users/${aluno.id}/standing`).expect(200);
    // Vê o inventário da sala, como o SAD (o solicitante não vê).
    const asStaff = await nucev.get(`/api/rooms/${room.id}`).expect(200);
    expect(asStaff.body.room).toHaveProperty("extraSeats");
    const asRequester = await (await loginAs(app, "outra@fm.usp.br")).get(`/api/rooms/${room.id}`).expect(200);
    expect(asRequester.body.room).not.toHaveProperty("extraSeats");
  });

  it("não aprova, não reserva, não aplica sanção e não mexe em pessoas, salas ou notebooks", async () => {
    const nucev = await loginAs(app, "vanessa@fm.usp.br");
    const approve = await nucev.post(`/api/admin/reservations/${pendingId}/approve`).send({ roomId: room.id }).expect(403);
    expect(approve.body.error.message).toBe("Só o SAD pode fazer isso.");
    await nucev.post("/api/admin/reservations").send({}).expect(403);
    await nucev.post(`/api/admin/users/${aluno.id}/sanctions`).send({ type: "WARNING", reason: "x" }).expect(403);
    await nucev.get("/api/admin/users").expect(403);
    await nucev.patch(`/api/admin/users/${aluno.id}`).send({ role: "ADMIN" }).expect(403);
    await nucev.patch(`/api/rooms/${room.id}`).send({ capacity: 10 }).expect(403);
    await nucev.get("/api/notebooks").expect(403);
  });
});

describe("Pessoas (SAD)", () => {
  it("muda o papel de alguém, que vale na hora; não tira o próprio acesso de SAD", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const self = await sad.patch(`/api/admin/users/${admin.id}`).send({ role: "USER" }).expect(400);
    expect(self.body.error.code).toBe("SELF_DEMOTION");

    const outra = await prisma.user.findUniqueOrThrow({ where: { email: "outra@fm.usp.br" } });
    const agent = await loginAs(app, "outra@fm.usp.br");
    await agent.get("/api/admin/reservations").expect(403);
    await sad.patch(`/api/admin/users/${outra.id}`).send({ role: "NUCEV" }).expect(200);
    await agent.get("/api/admin/reservations").expect(200);
  });

  it("cadastra uma pessoa antes do primeiro acesso, e ela já entra com o papel", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const body = { name: "Maria NUCEV", email: "Maria.Nova@fm.usp.br", role: "NUCEV" };
    const created = await sad.post("/api/admin/users").send(body).expect(201);
    expect(created.body.user).toMatchObject({
      email: "maria.nova@fm.usp.br",
      role: "NUCEV",
      permissions: ["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"],
    });
    expect((await sad.post("/api/admin/users").send(body).expect(409)).body.error.code).toBe("USER_EXISTS");
    const foreign = await sad.post("/api/admin/users").send({ ...body, email: "maria@gmail.com" }).expect(403);
    expect(foreign.body.error.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");

    const maria = await loginAs(app, "maria.nova@fm.usp.br");
    const me = await maria.get("/api/auth/me").expect(200);
    expect(me.body.user).toMatchObject({ role: "NUCEV", permissions: ["REQUEST_CULTURE_EXTENSION", "REQUEST_PUBLIC_EXAM"] });
  });

  it("lista com busca e filtro por permissão", async () => {
    const sad = await loginAs(app, "admin@fm.usp.br");
    const res = await sad.get("/api/admin/users?permission=REQUEST_GRADUATE").expect(200);
    expect(res.body.users.map((u: { email: string }) => u.email)).toEqual(["juliana@fm.usp.br", "sueli@fm.usp.br"]);
    const search = await sad.get("/api/admin/users?q=vanessa").expect(200);
    expect(search.body.users).toHaveLength(1);
  });
});
