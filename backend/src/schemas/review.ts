import { z } from "zod";

// "single": só a ocorrência indicada na URL.
// "series": todas as ocorrências da mesma série que ainda estão pendentes e não
// começaram (equivale a "single" quando a reserva não é recorrente).
export const reviewScopeSchema = z.enum(["single", "series"]).default("single");

export const approveReservationSchema = z.object({
  roomId: z.string().uuid(),
  scope: reviewScopeSchema,
  // Aprova só as datas livres na sala escolhida; as que colidem continuam
  // pendentes, para o Admin alocar em outra sala.
  skipConflicting: z.boolean().default(false),
  // Cultura e Extensão: a conferência do Art. 20 §3º (validada na rota, só para esse tipo).
  approvalChecklist: z.unknown().optional(),
});

export const rejectReservationSchema = z.object({
  reason: z.string().trim().min(1, "Informe a justificativa da rejeição.").max(2000),
  scope: reviewScopeSchema,
});

export type ReviewScope = z.infer<typeof reviewScopeSchema>;

// O SAD cancela qualquer reserva ativa, sempre com o motivo (vai no e-mail ao solicitante).
export const adminCancelReservationSchema = z.object({
  reason: z.string().trim().min(1, "Informe o motivo do cancelamento.").max(2000),
  scope: reviewScopeSchema,
});

// Sanções (Portaria 2793, Art. 9º §2º, Art. 11, Art. 17 e Art. 22): advertência,
// multa ou suspensão de novas reservas (com data de fim ou até a regularização).
export const sanctionSchema = z
  .object({
    type: z.enum(["WARNING", "FINE", "SUSPENSION"], { errorMap: () => ({ message: "Escolha o tipo de sanção." }) }),
    reason: z.string().trim().min(1, "Informe o motivo.").max(2000),
    // Só na suspensão. Ausente = até a regularização (ex.: inadimplência, Art. 17).
    until: z.coerce.date().optional(),
    // Art. 17: inadimplência cancela as reservas vigentes.
    cancelFutureReservations: z.boolean().default(false),
  })
  .superRefine((s, ctx) => {
    if (s.type !== "SUSPENSION" && (s.until || s.cancelFutureReservations)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["type"], message: "Data de fim e cancelamento de reservas só valem para a suspensão." });
    }
  });
