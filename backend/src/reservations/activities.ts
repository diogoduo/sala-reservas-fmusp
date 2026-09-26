import type { CreateReservationInput } from "../schemas/reservation";

// Opções fixas dos formulários por tipo de atividade. Os rótulos em português
// ficam no front (frontend/src/lib/activities.ts) — mantenha os códigos iguais nos dois.

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
    }
  })();
  return { ...summary, title: summary.title.slice(0, 200) };
}
