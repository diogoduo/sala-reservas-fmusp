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
