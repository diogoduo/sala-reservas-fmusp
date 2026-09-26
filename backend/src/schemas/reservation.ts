import { ActivityType } from "@prisma/client";
import { z } from "zod";
import { CULTURE_KINDS, DEFENSE_LEVELS, UNDERGRADUATE_CLASS_TYPES } from "../reservations/activities";

const recurrenceSchema = z.object({
  // Regra RFC 5545 sem "DTSTART:" (ex.: "FREQ=WEEKLY;BYDAY=MO,WE"). Validada de
  // fato em src/reservations/recurrence.ts (a lib rrule recusa o que for inválido).
  rrule: z.string().min(1, "Informe a regra de recorrência."),
  until: z.coerce.date(),
});

const requiredText = (message: string, max = 200) => z.string().trim().min(1, message).max(max);
// Os números chegam como texto dos inputs do formulário; "" vira 0 e cai no positive().
const positiveInt = (message: string) => z.coerce.number().int(message).positive(message);
const selectOne = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.enum(values, { errorMap: () => ({ message }) });

// ⚠️ Provisório até existir a tabela de disciplinas no banco: por enquanto só
// confere o formato do código USP (3 letras + 4 números, ex.: MCM0101).
const disciplineCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}\d{4}$/, "Código de disciplina inválido: use 3 letras e 4 números (ex.: MCM0101).");

// ----------------------------------------------------------------------------
// Campos específicos de cada formulário (vão para reservations.activity_details)
// ----------------------------------------------------------------------------

const disciplineFields = {
  disciplineCode,
  disciplineName: requiredText("Informe o nome da disciplina."),
  studentCount: positiveInt("Informe o número de alunos."),
  disciplineOwner: requiredText("Informe o responsável pela disciplina."),
  department: requiredText("Informe o departamento."),
};

const undergraduateDetails = z.object({
  ...disciplineFields,
  classType: selectOne(UNDERGRADUATE_CLASS_TYPES, "Selecione o tipo."),
  courseYear: z.coerce.number().int().min(1, "Selecione o ano.").max(6, "Selecione o ano."),
});

const graduateDetails = z.object(disciplineFields);

const cultureExtensionDetails = z
  .object({
    kind: selectOne(CULTURE_KINDS, "Selecione o tipo de reserva."),
    otherKind: z.string().trim().max(120).optional(),
    activityTitle: requiredText("Informe o título da atividade."),
    participantCount: positiveInt("Informe o número de participantes."),
    free: z.boolean(),
    fee: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().positive("O valor da taxa deve ser maior que zero.").optional(),
    ),
    linkedToCcex: z.boolean(),
    responsible: requiredText("Informe o responsável."),
    department: requiredText("Informe o departamento."),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "OTHER" && !d.otherKind) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otherKind"], message: "Descreva o tipo de reserva (Outros)." });
    }
    if (!d.free && d.fee === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fee"], message: "Informe o valor da taxa ou marque Atividade Gratuita." });
    }
  })
  // Não guarda o que não se aplica: descrição de "Outros" só com Outros, taxa só se não for gratuita.
  .transform((d) => ({ ...d, otherKind: d.kind === "OTHER" ? d.otherKind : undefined, fee: d.free ? undefined : d.fee }));

const publicExamDetails = z.object({
  examTitle: requiredText("Informe o título do concurso."),
  audience: positiveInt("Informe o público previsto."),
  candidateCount: positiveInt("Informe o número de candidatos."),
  responsible: requiredText("Informe o responsável pelo concurso."),
  department: requiredText("Informe o departamento."),
  candidateNames: requiredText("Informe os nomes dos candidatos.", 4000),
});

const defenseDetails = z.object({
  work: requiredText("Informe o título do trabalho.", 300),
  candidate: requiredText("Informe o candidato."),
  advisor: requiredText("Informe o orientador."),
  department: requiredText("Informe o departamento."),
  level: selectOne(DEFENSE_LEVELS, "Selecione o nível."),
  audience: positiveInt("Informe o público previsto."),
});

// ----------------------------------------------------------------------------
// Solicitação completa: parte comum a todos os tipos + detalhes do tipo escolhido
// ----------------------------------------------------------------------------

const baseSchema = z.object({
  // Sem seleção de sala pelo solicitante: ele descreve a necessidade (nº de
  // participantes, recursos, finalidade) e o Admin aloca a sala mais adequada
  // ao aprovar (Fase 6). `reservations.room_id` fica null até lá.
  description: requiredText("Descreva a atividade.", 2000),
  // Quantidade e detalhe só ficam guardados nos recursos que pedem isso
  // (ver normalizeRequestedResources).
  requestedResources: z
    .array(
      z.object({
        resourceId: z.string().uuid(),
        quantity: z.number().int().positive("A quantidade de um recurso deve ser maior que zero.").optional(),
        detail: z.string().trim().max(200).optional(),
      }),
    )
    .default([]),
  supportNotes: z.string().max(2000).optional(),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "É necessário aceitar o Regulamento de Uso dos Espaços da FMUSP." }),
  }),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  recurrence: recurrenceSchema.optional(),
});

export const createReservationSchema = z.discriminatedUnion(
  "activityType",
  [
    baseSchema.extend({ activityType: z.literal(ActivityType.UNDERGRADUATE), details: undergraduateDetails }),
    baseSchema.extend({ activityType: z.literal(ActivityType.GRADUATE), details: graduateDetails }),
    baseSchema.extend({ activityType: z.literal(ActivityType.CULTURE_EXTENSION), details: cultureExtensionDetails }),
    baseSchema.extend({ activityType: z.literal(ActivityType.PUBLIC_EXAM), details: publicExamDetails }),
    baseSchema.extend({ activityType: z.literal(ActivityType.DEFENSE), details: defenseDetails }),
  ],
  { errorMap: () => ({ message: "Selecione o tipo de atividade." }) },
);

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
