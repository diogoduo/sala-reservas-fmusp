import { z } from "zod";
import { CULTURE_KINDS, ORGANIZER_ENTITIES } from "../reservations/activities";

// Fase 11 — formulário "Solicitar evento": dados do evento, dias (com montagem e
// desmontagem), espaços por categoria ou por nome (em todos ou em alguns dias),
// coffee break e infraestrutura.

/** Unidades com desconto institucional (Portaria 2794, Art. 4º III): FMUSP, HC, USP, SES e Adolfo Lutz. */
export const INSTITUTIONAL_ENTITIES: readonly string[] = [
  "DEPARTMENT",
  "DIRECTORATE",
  "ACADEMIC_DIVISION",
  "COMMISSION",
  "STAFF",
  "HC",
  "USP_UNIT",
  "SES",
  "ADOLFO_LUTZ",
];

/** Entidades da própria FMUSP: o evento sem inscrição e sem patrocínio pode ser isento (Art. 4º I). */
export const FMUSP_ENTITIES: readonly string[] = ["DEPARTMENT", "DIRECTORATE", "ACADEMIC_DIVISION", "COMMISSION", "STAFF"];

const text = (message: string, max = 300) => z.string({ required_error: message }).trim().min(1, message).max(max);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido.");
const minutes = z.coerce
  .number()
  .int()
  .min(0)
  .max(240, "No máximo 4 horas.")
  .refine((m) => m % 15 === 0, "Em múltiplos de 15 minutos.")
  .default(0);

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const eventDaySchema = z
  .object({ date: dateKey, start: time, end: time, setupMinutes: minutes, teardownMinutes: minutes })
  .superRefine((d, ctx) => {
    if (d.end <= d.start) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "O término precisa ser depois do início." });
    // A montagem e a desmontagem ficam no mesmo dia.
    if (toMinutes(d.start) - d.setupMinutes < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["setupMinutes"], message: "A montagem passa da meia-noite." });
    if (toMinutes(d.end) + d.teardownMinutes > 24 * 60 - 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["teardownMinutes"], message: "A desmontagem passa da meia-noite." });
    }
  });

export type EventDayInput = z.infer<typeof eventDaySchema>;

/** Horário de uso dos espaços no dia: da montagem ao fim da desmontagem. */
export const usageWindow = (d: EventDayInput) => ({
  date: d.date,
  start: fromMinutes(toMinutes(d.start) - d.setupMinutes),
  end: fromMinutes(toMinutes(d.end) + d.teardownMinutes),
});

export const eventSpaceSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    count: z.coerce.number().int().min(1).max(200).default(1),
    minCapacity: z.coerce.number().int().positive().max(20_000).optional(),
    purpose: z.string().trim().max(120).optional(),
    coffeeInRoom: z.boolean().default(false),
    /** Dias de uso; vazio = todos os dias do evento. */
    dates: z.array(dateKey).max(60).default([]),
  })
  .refine((s) => Boolean(s.categoryId) !== Boolean(s.roomId), { message: "Escolha uma categoria ou um espaço." });

export type EventSpaceInput = z.infer<typeof eventSpaceSchema>;

export const createEventSchema = z
  .object({
    title: text("Informe o nome do evento.", 200),
    kind: z.enum(CULTURE_KINDS, { errorMap: () => ({ message: "Selecione o tipo de evento." }) }),
    description: text("Descreva o objetivo e a programação.", 4000),
    targetAudience: text("Informe o público-alvo."),
    expectedAttendees: z.coerce.number().int().positive("Informe o público previsto.").max(20_000),
    entity: z.enum(ORGANIZER_ENTITIES, { errorMap: () => ({ message: "Selecione a entidade organizadora." }) }),
    hasRegistrationFee: z.boolean(),
    sponsored: z.boolean(),
    responsible: text("Informe o responsável."),
    responsibleContact: text("Informe um contato do responsável (e-mail ou telefone)."),
    department: text("Informe o departamento, setor ou entidade."),
    coffeeBreak: z.boolean().default(false),
    coffeeAttendees: z.coerce.number().int().positive().max(20_000).optional(),
    infrastructure: z.string().trim().max(2000).optional(),
    notes: z.string().trim().max(2000).optional(),
    termsAccepted: z.literal(true, { errorMap: () => ({ message: "É necessário aceitar o Regulamento de Uso dos Espaços da FMUSP." }) }),
    days: z.array(eventDaySchema).min(1, "Informe ao menos um dia.").max(30, "No máximo 30 dias."),
    spaces: z.array(eventSpaceSchema).min(1, "Escolha ao menos um espaço.").max(50),
  })
  .superRefine((e, ctx) => {
    const dates = e.days.map((d) => d.date);
    if (new Set(dates).size !== dates.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: "Há dias repetidos." });
    e.spaces.forEach((s, i) => {
      if (s.dates.some((d) => !dates.includes(d))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["spaces", i, "dates"], message: "Escolha dias que fazem parte do evento." });
      }
    });
    if (e.coffeeBreak && !e.coffeeAttendees) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coffeeAttendees"], message: "Informe quantas pessoas no coffee break." });
    }
  });

export type CreateEventInput = z.infer<typeof createEventSchema>;
