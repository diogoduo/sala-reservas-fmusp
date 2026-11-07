// Fase 17 — o retrato de um dia para o plantão e a passagem de plantão.
import type { EventStatus } from "./events";

export interface DayEvent {
  id: string;
  protocol: string;
  title: string;
  status: EventStatus;
  closedAt: string | null;
  assigneeName: string | null;
  expectedAttendees: number;
  start: string | null;
  end: string | null;
  rooms: string[];
  buffet: boolean;
  parking: boolean;
  vehicles: number;
  openTasks: number;
}

export interface DayReservation {
  id: string;
  protocol: string;
  title: string;
  startTime: string;
  endTime: string;
  status: "PENDING" | "APPROVED";
  room: { name: string } | null;
  user: { name: string };
}

export interface DayTask {
  id: string;
  title: string;
  status: "OPEN" | "DONE";
  priority: boolean;
  assigneeName: string | null;
  doneByName: string | null;
  doneAt: string | null;
  dueDate: string | null;
  event: { protocol: string; title: string } | null;
}

export interface DayOverview {
  date: string;
  events: DayEvent[];
  reservations: { confirmed: DayReservation[]; awaiting: DayReservation[] };
  tasks: { due: DayTask[]; doneToday: DayTask[]; priority: DayTask[]; overdue: number; open: number };
  people: { name: string; tasks: number; events: string[] }[];
}

export type HandoverSituation = "ON_TRACK" | "ATTENTION" | "PROBLEM";

export const SITUATION_LABELS: Record<HandoverSituation, string> = { ON_TRACK: "Em dia", ATTENTION: "Precisa de atenção", PROBLEM: "Com problema" };
export const SITUATION_TONES: Record<HandoverSituation, "success" | "warning" | "danger"> = { ON_TRACK: "success", ATTENTION: "warning", PROBLEM: "danger" };

export interface HandoverEventRow {
  id: string;
  eventId: string | null;
  eventLabel: string;
  situation: HandoverSituation;
  done: string | null;
  doneBy: string | null;
  pending: string | null;
  nextResponsibleName: string | null;
  notes: string | null;
}

export interface Handover {
  id: string;
  date: string;
  shiftLabel: string | null;
  summary: string | null;
  pending: string | null;
  priorities: string | null;
  nextResponsibleId: string | null;
  nextResponsibleName: string | null;
  notes: string | null;
  snapshot: DayOverview;
  createdById: string | null;
  createdByName: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  events: HandoverEventRow[];
}
