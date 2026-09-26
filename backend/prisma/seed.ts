/**
 * Dados iniciais para desenvolvimento. Idempotente (pode rodar várias vezes).
 * Salas e usuários abaixo são FICTÍCIOS — substitua pelo catálogo real na Fase 3.
 */
import { PrismaClient, RoomStatus, RoomType, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

// Catálogo de equipamentos, incluindo os do formulário antigo do Anfiteatro.
// `requestsQuantity`/`detailPrompt` fazem o formulário pedir quantidade ou um detalhe.
// "Nenhum" (do formulário antigo) não é um recurso: é só não marcar nada.
const RESOURCES: {
  name: string;
  description: string | null;
  requestsQuantity?: boolean;
  detailPrompt?: string;
  detailOptions?: string[];
}[] = [
  { name: "Datashow/Projetor", description: "Projetor multimídia" },
  { name: "Lousa Interativa", description: "Lousa digital interativa" },
  { name: "Ar-condicionado", description: null },
  { name: "Sistema de Som", description: "Caixas e mesa de som" },
  {
    name: "Equipamento de Videoconferência",
    description: "Câmera, microfone e codec",
    detailPrompt: "Ex.: IP, modelo do equipamento",
  },
  { name: "Microfones", description: "Microfones sem fio / de lapela" },
  { name: "Computador de Apoio", description: "Computador fixo na sala", requestsQuantity: true },
  { name: "Chromebook", description: "Chromebooks para uso dos participantes", requestsQuantity: true },
  { name: "Webconferência", description: "Transmissão ou reunião online", detailPrompt: "Ex.: Zoom, Teams, Google Meet" },
  {
    name: "Bloqueio de internet para prova",
    description: "Bloqueia a internet durante a avaliação, liberando só a plataforma da prova",
    detailPrompt: "Plataforma da prova",
    detailOptions: ["Canvas", "e-Disciplinas", "TestPortal"],
  },
  { name: "Equipamento pessoal", description: "O solicitante traz o próprio notebook/equipamento" },
  { name: "Outro equipamento", description: null, detailPrompt: "Qual?" },
];

const ROOMS: {
  name: string;
  building: string;
  floor: string;
  capacity: number;
  roomType: RoomType;
  resources: string[];
}[] = [
  {
    name: "Auditório 1",
    building: "Bloco A",
    floor: "Térreo",
    capacity: 200,
    roomType: RoomType.AUDITORIUM,
    resources: ["Datashow/Projetor", "Sistema de Som", "Microfones", "Ar-condicionado", "Equipamento de Videoconferência"],
  },
  {
    name: "Sala 101",
    building: "Bloco A",
    floor: "1º andar",
    capacity: 60,
    roomType: RoomType.CLASSROOM,
    resources: ["Datashow/Projetor", "Ar-condicionado", "Computador de Apoio"],
  },
  {
    name: "Laboratório de Informática",
    building: "Bloco B",
    floor: "2º andar",
    capacity: 30,
    roomType: RoomType.LABORATORY,
    resources: ["Datashow/Projetor", "Ar-condicionado", "Computador de Apoio"],
  },
  {
    name: "Sala de Reunião 1",
    building: "Bloco B",
    floor: "1º andar",
    capacity: 12,
    roomType: RoomType.MEETING_ROOM,
    resources: ["Lousa Interativa", "Equipamento de Videoconferência", "Ar-condicionado"],
  },
];

// Contas usadas pelo Mock USP (Fase 2): um e-mail de cada domínio autorizado.
const DEV_USERS = [
  { uspNumber: "1000001", name: "SAD — Serviço de Apoio Didático", email: "admin@fm.usp.br", role: UserRole.ADMIN },
  { uspNumber: "1000002", name: "Aluno Teste", email: "aluno@usp.br", role: UserRole.USER },
  { uspNumber: "1000003", name: "Docente Teste", email: "docente@fm.usp.br", role: UserRole.USER },
  { uspNumber: "1000004", name: "Funcionário HC Teste", email: "funcionario@hc.fm.usp.br", role: UserRole.USER },
];

async function main() {
  const resourceIds = new Map<string, string>();
  for (const resource of RESOURCES) {
    const data = {
      description: resource.description,
      requestsQuantity: resource.requestsQuantity ?? false,
      detailPrompt: resource.detailPrompt ?? null,
      detailOptions: resource.detailOptions ?? [],
    };
    const row = await prisma.resource.upsert({
      where: { name: resource.name },
      update: data,
      create: { name: resource.name, ...data },
    });
    resourceIds.set(resource.name, row.id);
  }

  for (const room of ROOMS) {
    const row = await prisma.room.upsert({
      where: { building_floor_name: { building: room.building, floor: room.floor, name: room.name } },
      update: { capacity: room.capacity, roomType: room.roomType },
      create: {
        name: room.name,
        building: room.building,
        floor: room.floor,
        capacity: room.capacity,
        roomType: room.roomType,
        status: RoomStatus.ACTIVE,
      },
    });

    for (const resourceName of room.resources) {
      const resourceId = resourceIds.get(resourceName);
      if (!resourceId) continue;
      await prisma.roomResource.upsert({
        where: { roomId_resourceId: { roomId: row.id, resourceId } },
        update: {},
        create: { roomId: row.id, resourceId, quantity: 1 },
      });
    }
  }

  if (process.env.NODE_ENV !== "production") {
    for (const user of DEV_USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: { name: user.name, role: user.role },
        create: user,
      });
    }
  }

  console.log("Seed concluído.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
