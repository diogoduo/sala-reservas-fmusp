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
