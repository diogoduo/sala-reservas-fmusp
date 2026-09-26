import type { ActivityType } from "./types";

// Cada tipo de atividade tem seu próprio formulário (ver ActivityFields.tsx).
// Os códigos abaixo são os mesmos de backend/src/reservations/activities.ts —
// mantenha os dois em sincronia.

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  UNDERGRADUATE: "Graduação",
  GRADUATE: "Pós-Graduação",
  CULTURE_EXTENSION: "Cultura e Extensão",
  PUBLIC_EXAM: "Concurso",
  DEFENSE: "Defesa/Dissertação",
};

export const ACTIVITY_TYPES = Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[];

export const UNDERGRADUATE_CLASS_TYPE_LABELS: Record<string, string> = {
  LECTURE: "Aula teórica",
  PRACTICAL: "Aula prática",
  EXAM: "Prova",
  MAKEUP: "Reposição de aula",
  OTHER: "Outro",
};

export const COURSE_YEARS = [1, 2, 3, 4, 5, 6];

export const CULTURE_KIND_LABELS: Record<string, string> = {
  STUDENT_ACTIVITY: "Atividade estudantil",
  CONGRESS: "Congresso",
  COURSE: "Cursos",
  SEMINAR: "Seminário / Palestra",
  CEREMONY: "Solenidade",
  LEAGUE: "Liga",
  MEDENSINA: "MedEnsina",
  STUDENT_EXTENSION: "Extensão estudantil da FMUSP",
  OTHER: "Outros",
};

export const DEFENSE_LEVEL_LABELS: Record<string, string> = {
  MASTERS: "Mestrado",
  PROFESSIONAL_MASTERS: "Mestrado Profissional",
  DOCTORATE: "Doutorado",
};

const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));

/**
 * Linhas "rótulo: valor" com os detalhes do formulário, para a fila do Admin.
 * Omite o que já aparece no título e no nº de participantes do card.
 */
export function activityDetailRows(type: ActivityType, d: Record<string, unknown>): { label: string; value: string }[] {
  switch (type) {
    case "UNDERGRADUATE":
      return [
        { label: "Tipo", value: UNDERGRADUATE_CLASS_TYPE_LABELS[str(d.classType)] ?? str(d.classType) },
        { label: "Ano", value: `${str(d.courseYear)}º ano` },
        { label: "Responsável pela disciplina", value: str(d.disciplineOwner) },
        { label: "Departamento", value: str(d.department) },
      ];
    case "GRADUATE":
      return [
        { label: "Responsável pela disciplina", value: str(d.disciplineOwner) },
        { label: "Departamento", value: str(d.department) },
      ];
    case "CULTURE_EXTENSION":
      return [
        {
          label: "Tipo de reserva",
          value: d.kind === "OTHER" ? `Outros: ${str(d.otherKind)}` : (CULTURE_KIND_LABELS[str(d.kind)] ?? str(d.kind)),
        },
        {
          label: "Taxa",
          value: d.free ? "Atividade gratuita" : Number(d.fee).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
        },
        { label: "Vinculada à CCEx", value: d.linkedToCcex ? "Sim" : "Não" },
        { label: "Responsável", value: str(d.responsible) },
        { label: "Departamento", value: str(d.department) },
      ];
    case "PUBLIC_EXAM":
      return [
        { label: "Nº de candidatos", value: str(d.candidateCount) },
        { label: "Candidatos", value: str(d.candidateNames) },
        { label: "Responsável", value: str(d.responsible) },
        { label: "Departamento", value: str(d.department) },
      ];
    case "DEFENSE":
      return [
        { label: "Trabalho", value: str(d.work) },
        { label: "Orientador", value: str(d.advisor) },
        { label: "Departamento", value: str(d.department) },
      ];
  }
}
