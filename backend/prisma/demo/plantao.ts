import type { Prisma, PrismaClient } from "@prisma/client";
import { dayOverview } from "../../src/routes/plantao";

// Fase 17 — o plantão da base de demonstração: o checklist do dia da equipe
// (a Vanessa cria e atualiza; a Maria acompanha e conclui). Tarefas fictícias.

export interface DemoPlantaoHelpers {
  vanessa: { id: string; name: string };
  maria: { id: string; name: string };
  sad: { id: string; name: string };
  /** "AAAA-MM-DD" daqui a `offset` dias (no fuso da faculdade). */
  dayKey: (offset: number) => string;
}

export async function seedDemoPlantao(prisma: PrismaClient, h: DemoPlantaoHelpers): Promise<number> {
  const date = (offset: number) => new Date(`${h.dayKey(offset)}T00:00:00Z`);
  const by = { createdById: h.vanessa.id, createdByName: h.vanessa.name };
  const tasks = [
    { title: "Conferir as chaves do Teatro e do Foyer", assigneeId: h.maria.id, assigneeName: h.maria.name, dueDate: date(0), priority: true, ...by },
    { title: "Ligar para o buffet e confirmar o cardápio", assigneeId: h.vanessa.id, assigneeName: h.vanessa.name, dueDate: date(0), ...by },
    { title: "Repor as pilhas dos microfones sem fio", assigneeId: h.maria.id, assigneeName: h.maria.name, dueDate: date(-1), ...by },
    { title: "Enviar a lista de veículos para a portaria", assigneeId: h.maria.id, assigneeName: h.maria.name, dueDate: date(1), priority: true, ...by },
    { title: "Revisar a sinalização dos átrios", details: "Placas de \"Evento em andamento\" e setas para o Foyer.", ...by },
    {
      title: "Separar os crachás da equipe",
      assigneeId: h.maria.id,
      assigneeName: h.maria.name,
      dueDate: date(0),
      status: "DONE" as const,
      doneAt: new Date(),
      doneByName: h.maria.name,
      ...by,
    },
  ];
  await prisma.operationalTask.createMany({ data: tasks });

  // Uma passagem de plantão de hoje (manhã → tarde), da Vanessa para a Maria, ainda não recebida.
  const today = h.dayKey(0);
  await prisma.shiftHandover.create({
    data: {
      date: date(0),
      shiftLabel: "Manhã → Tarde",
      summary: "Manhã tranquila: crachás separados, buffet da Cerimônia em negociação.",
      pending: ["- Repor as pilhas dos microfones sem fio (atrasada)", "- Ligar para o buffet e confirmar o cardápio"].join("\n"),
      priorities: "- Conferir as chaves do Teatro e do Foyer",
      nextResponsibleId: h.maria.id,
      nextResponsibleName: h.maria.name,
      notes: "A portaria pediu a lista de veículos até amanhã.",
      snapshot: (await dayOverview(today)) as unknown as Prisma.InputJsonValue,
      createdById: h.vanessa.id,
      createdByName: h.vanessa.name,
    },
  });
  return tasks.length;
}

/** Fase 18 — os pranchões da base: 40 no depósito, 10 emprestados para o evento confirmado e uma devolução no histórico. */
export async function seedDemoMaterials(prisma: PrismaClient, h: DemoPlantaoHelpers, eventId: string | null): Promise<void> {
  const home = "Depósito do SAD (subsolo)";
  const item = await prisma.materialItem.create({ data: { name: "Pranchão", total: 40, homeLocation: home } });
  const days = (offset: number) => new Date(Date.now() + offset * 86_400_000);
  await prisma.materialMovement.create({ data: { itemId: item.id, kind: "ADJUST", quantity: 40, toLocation: home, at: days(-10), notes: "Cadastro do material", recordedByName: h.sad.name } });
  // Já devolvido: 8 pranchões numa feira da semana passada.
  const past = await prisma.materialLoan.create({
    data: { itemId: item.id, quantity: 8, returnedQuantity: 8, location: "Átrio do relógio de ponto", purpose: "Mesas da feira", takenBy: "Seu João (manutenção)", takenAt: days(-6), returnedBy: "Seu João (manutenção)", returnedAt: days(-5), recordedByName: h.maria.name },
  });
  await prisma.materialMovement.createMany({
    data: [
      { itemId: item.id, loanId: past.id, kind: "CHECKOUT", quantity: 8, fromLocation: home, toLocation: "Átrio do relógio de ponto", person: "Seu João (manutenção)", at: days(-6), recordedByName: h.maria.name },
      { itemId: item.id, loanId: past.id, kind: "RETURN", quantity: 8, fromLocation: "Átrio do relógio de ponto", toLocation: home, person: "Seu João (manutenção)", at: days(-5), recordedByName: h.maria.name },
    ],
  });
  // Em uso: 10 no Foyer, para o coquetel da Cerimônia do Jaleco.
  const loan = await prisma.materialLoan.create({
    data: { itemId: item.id, quantity: 10, location: "Foyer do Teatro", eventId, purpose: "Mesas do coquetel", takenBy: "Seu João (manutenção)", takenAt: days(-1), expectedReturnAt: new Date(`${h.dayKey(14)}T00:00:00Z`), recordedByName: h.vanessa.name },
  });
  await prisma.materialMovement.create({
    data: { itemId: item.id, loanId: loan.id, kind: "CHECKOUT", quantity: 10, fromLocation: home, toLocation: "Foyer do Teatro", person: "Seu João (manutenção)", at: days(-1), notes: "Mesas do coquetel", recordedByName: h.vanessa.name },
  });
}
