import { regularScheduleIssue } from "./reservationValidation";
import type { AdminReservation, ApprovalChecklist } from "./types";

// O SAD pode passar por cima das Portarias FMUSP nº 2793 e 2794, mas a tela
// mostra qual regra está sendo violada. As regras em si ficam no back-end
// (src/reservations/rules.ts), que as aplica ao solicitante.

export interface PortariaWarning {
  /** "Portaria 2793, Art. 6º" */
  rule: string;
  message: string;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Art. 6º: domingo, feriado/ponto facultativo ou fora das 07h–22h. */
export function scheduleWarning(start: Date | null, end: Date | null): PortariaWarning | null {
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const issue = regularScheduleIssue(start, end);
  return issue
    ? {
        rule: "Portaria 2793, Art. 6º",
        message: `${capitalize(issue)}. Fora dos dias úteis e sábados das 07h às 22h, só com autorização prévia da Divisão Acadêmica e custeio da equipe de apoio.`,
      }
    : null;
}

/** Art. 5º §2º: o público precisa caber nas cadeiras da sala. */
export function capacityWarning(attendees: number, room: { name: string; capacity: number | null } | null | undefined): PortariaWarning | null {
  if (!room || room.capacity === null || !attendees || attendees <= room.capacity) return null;
  return {
    rule: "Portaria 2793, Art. 5º §2º",
    message: `${room.name} comporta ${room.capacity} pessoas e foram informadas ${attendees}: não é permitido colocar cadeiras sobressalentes.`,
  };
}

/** Art. 20 §3º, Art. 14 §3º e Art. 21 §2º: o que não foi conferido antes de confirmar um evento. */
export function checklistWarnings(checklist: Partial<ApprovalChecklist> | null): PortariaWarning[] {
  const warnings: PortariaWarning[] = [];
  if (!checklist?.ccexAuthorized) {
    warnings.push({ rule: "Portaria 2793, Art. 20 §3º, a", message: "Evento confirmado sem a autorização da CCEx conferida." });
  }
  if (!checklist?.academicDivisionApproved) {
    warnings.push({ rule: "Portaria 2793, Art. 20 §3º, c", message: "Evento confirmado sem a aprovação da Divisão Acadêmica." });
  }
  if (!checklist?.feeSettled) {
    warnings.push({
      rule: "Portaria 2793, Art. 14 §3º e Art. 21 §2º",
      message: "Evento confirmado sem conferir o comprovante de pagamento da taxa (ou a isenção).",
    });
  }
  return warnings;
}

export const RELOCATION_WARNING: PortariaWarning = {
  rule: "Portaria 2793, Art. 12",
  message: "Realocar uma reserva aprovada para outra sala depende de autorização da Divisão Acadêmica e da Diretoria.",
};

export const NO_ALCOHOL_WARNING: PortariaWarning = {
  rule: "Portaria 2793, Art. 23",
  message: "Reserva sem o compromisso de que não haverá comércio nem consumo de bebidas alcoólicas.",
};

export const HOLIDAYS_WARNING: PortariaWarning = {
  rule: "Portaria 2793, Art. 6º",
  message: "A série inclui feriados ou pontos facultativos, que exigem autorização prévia da Divisão Acadêmica.",
};

/** O que uma reserva aprovada tem fora das portarias (para os painéis do SAD). */
export function reservationWarnings(r: AdminReservation): PortariaWarning[] {
  if (r.status !== "APPROVED") return [];
  const warnings: PortariaWarning[] = [];
  if (r.outsideRegularHours) {
    warnings.push(
      scheduleWarning(new Date(r.startTime), new Date(r.endTime)) ?? {
        rule: "Portaria 2793, Art. 6º",
        message: "Horário extraordinário (domingo, feriado ou fora das 07h–22h).",
      },
    );
  }
  const capacity = capacityWarning(r.expectedAttendees, r.room);
  if (capacity) warnings.push(capacity);
  if (r.activityType === "CULTURE_EXTENSION") warnings.push(...checklistWarnings(r.approvalChecklist));
  return warnings;
}
