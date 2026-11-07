// Fase 17 — checklist do dia (tarefas da equipe do SAD e do NUCEV).

export interface TaskItem {
  id: string;
  eventId: string | null;
  event: { id: string; protocol: string; title: string } | null;
  title: string;
  details: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: boolean;
  status: "OPEN" | "DONE";
  doneAt: string | null;
  doneByName: string | null;
  createdByName: string;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistData {
  date: string;
  tasks: TaskItem[];
  team: { id: string; name: string; role: string }[];
  events: { id: string; protocol: string; title: string }[];
}

export const shortDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
