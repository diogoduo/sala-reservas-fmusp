import type { ActivityType } from "@prisma/client";
import type { CreateReservationInput } from "../schemas/reservation";

// Opções fixas dos formulários por tipo de atividade. Os rótulos em português
// ficam no front (frontend/src/lib/activities.ts) — mantenha os códigos iguais nos dois.

/** Usado nos e-mails (Fase 7); o front tem a mesma lista para as telas. */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  UNDERGRADUATE: "Graduação",
  GRADUATE: "Pós-Graduação",
  CULTURE_EXTENSION: "Cultura e Extensão",
  PUBLIC_EXAM: "Concurso",
  DEFENSE: "Defesa/Dissertação",
  ADMINISTRATIVE: "Reunião / Administrativo",
};

export const UNDERGRADUATE_CLASS_TYPES = ["LECTURE", "PRACTICAL", "EXAM", "MAKEUP", "OTHER"] as const;

export const CULTURE_KINDS = [
  "STUDENT_ACTIVITY", // Atividade estudantil
  "CONGRESS", // Congresso
  "COURSE", // Cursos
  "SEMINAR", // Seminário / Palestra
  "CEREMONY", // Solenidade
  "LEAGUE", // Liga
  "MEDENSINA", // MedEnsina
  "STUDENT_EXTENSION", // Extensão estudantil da FMUSP
  "OTHER", // Outros (com descrição)
] as const;

export const DEFENSE_LEVELS = ["MASTERS", "PROFESSIONAL_MASTERS", "DOCTORATE"] as const;

/** Reuniões e atividades administrativas (Portaria 2793, Art. 7º, itens 3 e 7). */
export const ADMINISTRATIVE_KINDS = [
  "MEETING", // Reunião administrativa da FMUSP
  "DIRECTORATE", // Atividade promovida pela Diretoria
  "STAFF", // Representação dos Funcionários
] as const;

/**
 * Quem organiza a atividade de Cultura e Extensão (Portaria 2793, Art. 4º). As
 * externas à FMUSP dependem de autorização expressa da Divisão Acadêmica (§1º).
 */
export const ORGANIZER_ENTITIES = [
  // FMUSP
  "DEPARTMENT", // Departamento da FMUSP
  "DIRECTORATE", // Diretoria da FMUSP
  "ACADEMIC_DIVISION", // Divisão Acadêmica e seus Serviços
  "COMMISSION", // Comissão da FMUSP
  "STAFF", // Representação dos Funcionários
  // Entidades estudantis da FMUSP
  "CAOC", // Centro Acadêmico Oswaldo Cruz (e extensões aprovadas por ele)
  "AAAOC", // Associação Atlética Acadêmica Oswaldo Cruz
  "CA_XXI", // Centro Acadêmico XXI de Junho
  "DC", // Departamento Científico
  "MEDENSINA", // MedEnsina
  "MEDICINA_JR", // Medicina Jr.
  "EMA", // Extensão Médica Acadêmica
  "LEAGUE", // Liga acadêmica da FMUSP
  // Externas (Art. 4º §1º)
  "HC", // Sistema FMUSP/HC
  "USP_UNIT", // Outra Unidade da USP
  "USP_STUDENT_GROUP", // Agremiação estudantil de outra Unidade da USP
  "SES", // Secretaria de Estado da Saúde
  "ADOLFO_LUTZ", // Instituto Adolfo Lutz
  "PUBLIC", // Outra instituição pública
  "SOCIAL_ORG", // Organização social
  "PRIVATE", // Pessoa jurídica de direito privado
] as const;
export type OrganizerEntity = (typeof ORGANIZER_ENTITIES)[number];

export const STUDENT_ENTITIES: readonly OrganizerEntity[] = ["CAOC", "AAAOC", "CA_XXI", "DC", "MEDENSINA", "MEDICINA_JR", "EMA", "LEAGUE"];
export const EXTERNAL_ENTITIES: readonly OrganizerEntity[] = ["HC", "USP_UNIT", "USP_STUDENT_GROUP", "SES", "ADOLFO_LUTZ", "PUBLIC", "SOCIAL_ORG", "PRIVATE"];

/** Áreas de apoio da Portaria 2794, Art. 3º (cobradas à parte). */
export const SUPPORT_AREAS = ["ATRIUM", "TERRACE", "THEATER_FOYER", "TRANSITION_HALL", "PANTRY_5", "THEATER_PANTRY"] as const;

/** Situação do pedido de autorização prévia na CCEx (Portaria 2793, Art. 20). */
export const CCEX_STATUSES = ["AUTHORIZED", "REQUESTED"] as const;

const DEFENSE_LEVEL_LABELS: Record<(typeof DEFENSE_LEVELS)[number], string> = {
  MASTERS: "Mestrado",
  PROFESSIONAL_MASTERS: "Mestrado Profissional",
  DOCTORATE: "Doutorado",
};

/**
 * Cada formulário tem seu próprio campo de "quantas pessoas" (nº de alunos,
 * participantes, público previsto) e nem todos têm um título. Aqui eles viram
 * as colunas comuns `title` e `expected_attendees`, que a fila do Admin e a
 * checagem de capacidade (Fase 6) usam igual para todos os tipos.
 */
export function summarizeActivity(input: CreateReservationInput): { title: string; expectedAttendees: number } {
  const summary = (() => {
    switch (input.activityType) {
      case "UNDERGRADUATE":
      case "GRADUATE":
        return {
          title: `${input.details.disciplineCode} — ${input.details.disciplineName}`,
          expectedAttendees: input.details.studentCount,
        };
      case "CULTURE_EXTENSION":
        return { title: input.details.activityTitle, expectedAttendees: input.details.participantCount };
      case "PUBLIC_EXAM":
        // "Público previsto" já é o total de pessoas na sala (candidatos inclusos).
        return { title: input.details.examTitle, expectedAttendees: input.details.audience };
      case "DEFENSE":
        return {
          title: `Defesa de ${DEFENSE_LEVEL_LABELS[input.details.level]} — ${input.details.candidate}`,
          expectedAttendees: input.details.audience,
        };
      case "ADMINISTRATIVE":
        return { title: input.details.meetingTitle, expectedAttendees: input.details.participantCount };
    }
  })();
  return { ...summary, title: summary.title.slice(0, 200) };
}
