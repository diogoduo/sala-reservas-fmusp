import { z } from "zod";

export const createResourceSchema = z.object({
  name: z.string().min(1, "Informe o nome do recurso.").max(120),
  description: z.string().max(500).optional(),
  // O formulário de solicitação pede a quantidade (ex.: Computador, Chromebook).
  requestsQuantity: z.boolean().default(false),
  // false = só inventário das salas (nobreak, splitter…), fora do formulário de reserva.
  requestable: z.boolean().default(true),
  // Texto de exemplo do campo de detalhe (ex.: "Ex.: Zoom, Teams"); null/"" = não pede detalhe.
  detailPrompt: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  // Opções fixas do detalhe (vira um select); vazio = detalhe livre ou nenhum.
  detailOptions: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

export const updateResourceSchema = createResourceSchema.partial();

export type CreateResourceInput = z.infer<typeof createResourceSchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
