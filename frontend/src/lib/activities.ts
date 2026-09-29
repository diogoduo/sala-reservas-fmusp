import { SUPPORT_AREAS } from "./fees";
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
  ADMINISTRATIVE: "Reunião / Administrativo",
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

/** Reuniões e atividades administrativas (Portaria 2793, Art. 7º, itens 3 e 7). */
export const ADMINISTRATIVE_KIND_LABELS: Record<string, string> = {
  MEETING: "Reunião administrativa",
  DIRECTORATE: "Atividade da Diretoria",
  STAFF: "Representação dos Funcionários",
};

/** Quem organiza a atividade de Cultura e Extensão (Portaria 2793, Art. 4º). */
export const ORGANIZER_ENTITY_GROUPS: { label: string; options: [string, string][] }[] = [
  {
    label: "FMUSP",
    options: [
      ["DEPARTMENT", "Departamento da FMUSP"],
      ["DIRECTORATE", "Diretoria da FMUSP"],
      ["ACADEMIC_DIVISION", "Divisão Acadêmica e seus Serviços"],
      ["COMMISSION", "Comissão da FMUSP"],
      ["STAFF", "Representação dos Funcionários"],
    ],
  },
  {
    label: "Entidades estudantis da FMUSP",
    options: [
      ["CAOC", "Centro Acadêmico Oswaldo Cruz (CAOC) e extensões aprovadas"],
      ["AAAOC", "Associação Atlética Acadêmica Oswaldo Cruz (AAAOC)"],
      ["CA_XXI", "Centro Acadêmico XXI de Junho (CA XXI)"],
      ["DC", "Departamento Científico (DC)"],
      ["MEDENSINA", "MedEnsina"],
      ["MEDICINA_JR", "Medicina Jr."],
      ["EMA", "Extensão Médica Acadêmica (EMA)"],
      ["LEAGUE", "Liga acadêmica da FMUSP"],
    ],
  },
  {
    label: "Externas à FMUSP (autorização da Divisão Acadêmica)",
    options: [
      ["HC", "Sistema FMUSP/HC (HC e institutos)"],
      ["USP_UNIT", "Outra Unidade da USP"],
      ["USP_STUDENT_GROUP", "Agremiação estudantil de outra Unidade da USP"],
      ["SES", "Secretaria de Estado da Saúde (SES)"],
      ["ADOLFO_LUTZ", "Instituto Adolfo Lutz"],
      ["PUBLIC", "Outra instituição pública"],
      ["SOCIAL_ORG", "Organização social"],
      ["PRIVATE", "Pessoa jurídica de direito privado"],
    ],
  },
];

export const ORGANIZER_ENTITY_LABELS: Record<string, string> = Object.fromEntries(ORGANIZER_ENTITY_GROUPS.flatMap((g) => g.options));

export const FMUSP_ENTITIES = ["DEPARTMENT", "DIRECTORATE", "ACADEMIC_DIVISION", "COMMISSION", "STAFF"];
export const STUDENT_ENTITIES = ["CAOC", "AAAOC", "CA_XXI", "DC", "MEDENSINA", "MEDICINA_JR", "EMA", "LEAGUE"];
export const EXTERNAL_ENTITIES = ["HC", "USP_UNIT", "USP_STUDENT_GROUP", "SES", "ADOLFO_LUTZ", "PUBLIC", "SOCIAL_ORG", "PRIVATE"];

/** Situação do pedido de autorização prévia na CCEx (Portaria 2793, Art. 20). */
export const CCEX_STATUS_LABELS: Record<string, string> = {
  AUTHORIZED: "Já autorizada pela CCEx",
  REQUESTED: "Pedido enviado à CCEx, aguardando",
};

// ----------------------------------------------------------------------------
// Prioridades de uso (Portaria 2793, Art. 7º) — orientam o SAD quando dois
// pedidos disputam a mesma sala e horário.
// ----------------------------------------------------------------------------

export const PRIORITY_LABELS: Record<number, string> = {
  1: "Aulas e provas da graduação",
  2: "Aulas da pós-graduação",
  3: "Atividades da Diretoria e concursos docentes",
  4: "Defesas de dissertação e tese",
  5: "Cursos dos Departamentos aprovados na CCEx",
  6: "Atividades estudantis (CAOC, CA XXI, DC, MedEnsina, Medicina Jr., EMA e agremiações)",
  7: "Reuniões administrativas e Representação dos Funcionários",
  8: "Outras atividades autorizadas pela Diretoria",
};

const STUDENT_KINDS = ["STUDENT_ACTIVITY", "LEAGUE", "MEDENSINA", "STUDENT_EXTENSION"];

export function priorityOf(type: ActivityType | null, d: Record<string, unknown> | null): number {
  const details = d ?? {};
  switch (type) {
    case "UNDERGRADUATE":
      return 1;
    case "GRADUATE":
      return 2;
    case "PUBLIC_EXAM":
      return 3;
    case "DEFENSE":
      return 4;
    case "ADMINISTRATIVE":
      return details.kind === "DIRECTORATE" ? 3 : 7;
    case "CULTURE_EXTENSION": {
      const entity = String(details.entity ?? "");
      if (entity === "DIRECTORATE") return 3;
      if (details.kind === "COURSE" && entity === "DEPARTMENT") return 5;
      if (STUDENT_ENTITIES.includes(entity) || (!entity && STUDENT_KINDS.includes(String(details.kind)))) return 6;
      if (entity === "STAFF") return 7;
      return 8;
    }
    default:
      return 8;
  }
}

const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));
const brl = (value: unknown) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
    case "CULTURE_EXTENSION": {
      const areas = Array.isArray(d.supportAreas) ? (d.supportAreas as string[]) : [];
      const rows: { label: string; value: string }[] = [
        {
          label: "Tipo de reserva",
          value: d.kind === "OTHER" ? `Outros: ${str(d.otherKind)}` : (CULTURE_KIND_LABELS[str(d.kind)] ?? str(d.kind)),
        },
      ];
      if (d.entity) rows.push({ label: "Entidade organizadora", value: ORGANIZER_ENTITY_LABELS[str(d.entity)] ?? str(d.entity) });
      if (d.targetAudience) rows.push({ label: "Público-alvo", value: str(d.targetAudience) });
      if (d.program) rows.push({ label: "Programação", value: str(d.program) });
      rows.push({ label: "Inscrição", value: d.free ? "Gratuita (sem inscrição paga)" : brl(d.fee) });
      if (d.costOnly !== undefined) rows.push({ label: "Inscrição só para custeio", value: d.costOnly ? "Sim" : "Não" });
      if (d.sponsored !== undefined) rows.push({ label: "Patrocínio", value: d.sponsored ? "Sim" : "Não" });
      if (d.ccexStatus) {
        rows.push({ label: "CCEx", value: `${CCEX_STATUS_LABELS[str(d.ccexStatus)] ?? str(d.ccexStatus)}${d.ccexProcess ? ` · nº ${str(d.ccexProcess)}` : ""}` });
      } else if (d.linkedToCcex !== undefined) {
        // Pedidos feitos antes das portarias de 2026.
        rows.push({ label: "Vinculada à CCEx", value: d.linkedToCcex ? "Sim" : "Não" });
      }
      if (areas.length > 0) {
        rows.push({ label: "Áreas de apoio", value: areas.map((code) => SUPPORT_AREAS.find((a) => a.code === code)?.label ?? code).join("; ") });
      }
      rows.push({ label: "Responsável", value: str(d.responsible) });
      if (d.responsibleContact) rows.push({ label: "Contato", value: str(d.responsibleContact) });
      rows.push({ label: "Departamento/entidade", value: str(d.department) });
      return rows;
    }
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
    case "ADMINISTRATIVE":
      return [
        { label: "Tipo", value: ADMINISTRATIVE_KIND_LABELS[str(d.kind)] ?? str(d.kind) },
        { label: "Responsável", value: str(d.responsible) },
        { label: "Setor", value: str(d.department) },
      ];
  }
}
