import type { Permission, UserRole } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { prisma } from "../../src/lib/prisma";

/** Apaga todas as tabelas (menos o histórico de migrations). */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export function createUser(email: string, role: UserRole = "USER", permissions: Permission[] = []) {
  return prisma.user.create({ data: { email, name: email.split("@")[0]!, role, permissions } });
}

export function createRoom(name: string, capacity = 40) {
  return prisma.room.create({ data: { name, building: "Prédio Teste", floor: "Térreo", capacity, roomType: "CLASSROOM" } });
}

/** Sessão de um usuário já cadastrado, pelo login de teste (AUTH_MODE=mock). */
export async function loginAs(app: Express, email: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/mock/login").send({ email }).expect(200);
  return agent;
}

/** Corpo mínimo de um pedido de aula de graduação. */
export function undergraduateRequest(title: string, startTime: Date, endTime: Date, extra: Record<string, unknown> = {}) {
  return {
    activityType: "UNDERGRADUATE",
    description: `[teste] ${title}`,
    termsAccepted: true,
    noAlcoholCommitment: true,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    details: {
      classType: "LECTURE",
      courseYear: 1,
      disciplineCode: "MCM0101",
      disciplineName: title,
      studentCount: 20,
      disciplineOwner: "Prof. Teste",
      department: "Departamento Teste",
    },
    ...extra,
  };
}

let protocolCounter = 0;

/** Pedido pendente gravado direto no banco (sem passar pelas regras do solicitante). */
export function createPendingReservation(userId: string, startTime: Date, endTime: Date, seriesId?: string) {
  protocolCounter += 1;
  return prisma.reservation.create({
    data: {
      protocol: `${String(protocolCounter).padStart(6, "0")}/2099`,
      userId,
      seriesId,
      title: "Pedido de teste",
      description: "[teste]",
      activityType: "ADMINISTRATIVE",
      expectedAttendees: 10,
      termsAccepted: true,
      startTime,
      endTime,
    },
  });
}
