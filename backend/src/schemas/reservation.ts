import { ActivityType } from "@prisma/client";
import { z } from "zod";
import {
  ADMINISTRATIVE_KINDS,
  CCEX_STATUSES,
  CULTURE_KINDS,
  DEFENSE_LEVELS,
  ORGANIZER_ENTITIES,
  STUDENT_ENTITIES,
  SUPPORT_AREAS,
  UNDERGRADUATE_CLASS_TYPES,
} from "../reservations/activities";
import { MAX_SETUP_MINUTES } from "../reservations/rules";
import { reviewScopeSchema } from "./review";

const recurrenceSchema = z.object({
  // Regra RFC 5545 sem "DTSTART:" (ex.: "FREQ=WEEKLY;BYDAY=MO,WE"). Validada de
  // fato em src/reservations/recurrence.ts (a lib rrule recusa o que for inválido).
  rrule: z.string().min(1, "Informe a regra de recorrência."),
  until: z.coerce.date(),
});

// A mensagem vale também para o campo ausente (senão o zod responde "Required").
const requiredText = (message: string, max = 200) =>
  z.string({ required_error: message, invalid_type_error: message }).trim().min(1, message).max(max);
// Os números chegam como texto dos inputs do formulário; "" vira 0 e cai no positive().
const positiveInt = (message: string) => z.coerce.number({ invalid_type_error: message }).int(message).positive(message);
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

// Cultura e Extensão = atividades fora do currículo, dos programas e da pesquisa
// (Portaria 2793, Cap. XI). O pedido traz o mínimo do Art. 20 §1º (objeto,
// programação, público-alvo, responsáveis…), a entidade (Art. 4º) e a situação
// na CCEx. Patrocínio, custeio e áreas de apoio servem à taxa (Portaria 2794),
// que ainda não está no formulário: ficam opcionais.
const cultureExtensionDetails = z
  .object({
    kind: selectOne(CULTURE_KINDS, "Selecione o tipo de reserva."),
    otherKind: z.string().trim().max(120).optional(),
    activityTitle: requiredText("Informe o título da atividade."),
    participantCount: positiveInt("Informe o número de participantes."),
    targetAudience: requiredText("Informe o público-alvo."),
    program: requiredText("Informe a programação completa.", 4000),
    entity: selectOne(ORGANIZER_ENTITIES, "Selecione a entidade organizadora."),
    free: z.boolean(),
    fee: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().positive("O valor da taxa deve ser maior que zero.").optional(),
    ),
    // Inscrição cobrada só para custear o evento (entidades estudantis podem pedir isenção).
    costOnly: z.preprocess((value) => (value === "" ? undefined : value), z.boolean().optional()),
    sponsored: z.boolean().optional(),
    ccexStatus: selectOne(CCEX_STATUSES, "Informe a situação do pedido na CCEx."),
    ccexProcess: z.string().trim().max(120).optional(),
    // Chega como "ATRIUM,TERRACE" dos checkboxes do formulário.
    supportAreas: z.preprocess(
      (value) => (typeof value === "string" ? value.split(",").filter(Boolean) : value),
      z.array(z.enum(SUPPORT_AREAS)).default([]),
    ),
    responsible: requiredText("Informe o responsável."),
    responsibleContact: requiredText("Informe um contato do responsável (e-mail ou telefone)."),
    department: requiredText("Informe o departamento, setor ou entidade."),
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
  .transform((d) => ({
    ...d,
    otherKind: d.kind === "OTHER" ? d.otherKind : undefined,
    fee: d.free ? undefined : d.fee,
    costOnly: !d.free && STUDENT_ENTITIES.includes(d.entity) ? d.costOnly : undefined,
    ccexProcess: d.ccexProcess || undefined,
  }));

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

const administrativeDetails = z.object({
  kind: selectOne(ADMINISTRATIVE_KINDS, "Selecione o tipo."),
  meetingTitle: requiredText("Informe o assunto."),
  participantCount: positiveInt("Informe o número de participantes."),
  responsible: requiredText("Informe o responsável."),
  department: requiredText("Informe o setor ou departamento."),
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
  /** Início e término da ATIVIDADE; a reserva começa `setupMinutes` antes (montagem). */
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  // Portaria 2793, Art. 19: a montagem é reservada no sistema e faz parte do uso.
  setupMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_SETUP_MINUTES, "A montagem pode ser de no máximo 4 horas.")
    .refine((m) => m % 15 === 0, "A montagem deve ser em múltiplos de 15 minutos.")
    .default(0),
  // Portaria 2794, Art. 5º: coffee break só em algumas salas. O formulário ainda
  // não pergunta (fica para depois, com as taxas).
  coffeeBreak: z.boolean().default(false),
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
    baseSchema.extend({ activityType: z.literal(ActivityType.ADMINISTRATIVE), details: administrativeDetails }),
  ],
  { errorMap: () => ({ message: "Selecione o tipo de atividade." }) },
);

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

// Portaria 2793, Art. 23: o compromisso fica no formulário de requisição.
const noAlcoholCommitment = z.literal(true, {
  errorMap: () => ({
    message: "É necessário assumir o compromisso de que não haverá comércio nem consumo de bebidas alcoólicas (Portaria 2793, Art. 23).",
  }),
});

/** Pedido do solicitante. */
export const requesterCreateSchema = z.intersection(createReservationSchema, z.object({ noAlcoholCommitment }));

// Mesmo escopo da revisão do Admin: "single" = só esta data; "series" = todas
// as próximas datas ainda ativas da mesma série.
export const cancelReservationSchema = z.object({ scope: reviewScopeSchema });

// Alteração pelo solicitante: os mesmos campos (e validações por tipo) da
// criação, mais o escopo. A recorrência não muda por aqui — `recurrence`, se
// vier, é ignorado.
export const updateReservationSchema = z.intersection(createReservationSchema, z.object({ scope: reviewScopeSchema, noAlcoholCommitment }));

/**
 * Conferência do SAD ao confirmar uma atividade de Cultura e Extensão (Portaria
 * 2793, Art. 20 §3º e Art. 14 §3º / Art. 21 §2º). Fica registrada na reserva; o
 * que não foi conferido aparece como aviso — o SAD pode confirmar mesmo assim.
 */
export const approvalChecklistSchema = z.object({
  ccexAuthorized: z.boolean().default(false),
  academicDivisionApproved: z.boolean().default(false),
  feeSettled: z.boolean().default(false),
  directorateHomologated: z.boolean().default(false),
});

// Reserva feita pelo próprio SAD: os mesmos campos (e a recorrência) da
// solicitação, mais a sala — já nasce aprovada. O SAD pode passar por cima das
// portarias (horário, capacidade, compromisso, conferência): a tela avisa.
export const adminCreateReservationSchema = z.intersection(
  createReservationSchema,
  z.object({
    roomId: z.string().uuid(),
    noAlcoholCommitment: z.boolean().default(false),
    // Numa série, os feriados ficam de fora, a menos que o SAD peça para manter (Art. 6º).
    keepHolidays: z.boolean().default(false),
    approvalChecklist: approvalChecklistSchema.optional(),
  }),
);

// Alteração pelo SAD: os mesmos campos, mais a sala (troca a sala de uma reserva
// aprovada; null/ausente = mantém a atual).
export const adminUpdateReservationSchema = z.intersection(
  createReservationSchema,
  z.object({ scope: reviewScopeSchema, roomId: z.string().uuid().nullish() }),
);
