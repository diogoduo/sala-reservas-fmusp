import { RoomStatus, RoomType, SeatType } from "@prisma/client";
import { z } from "zod";

export const resourceAssignmentSchema = z.object({
  resourceId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  // Inventário (só o SAD vê): vazio vira null.
  model: z.string().trim().max(200).nullish().transform((v) => v || null),
  assetTags: z.string().trim().max(500).nullish().transform((v) => v || null),
});

const roomFields = z.object({
  name: z.string().min(1, "Informe o nome/número da sala.").max(120),
  building: z.string().min(1, "Informe o prédio/bloco.").max(120),
  floor: z.string().min(1, "Informe o andar/pavimento.").max(60),
  // null = "a definir", só para sala que não está Ativa (ex.: em reforma).
  capacity: z.number().int().positive("A capacidade deve ser maior que zero.").nullable(),
  roomType: z.nativeEnum(RoomType),
  status: z.nativeEnum(RoomStatus).default(RoomStatus.ACTIVE),
  extraSeats: z.number().int().min(0).nullish(),
  dimensions: z.string().trim().max(60).nullish().transform((v) => v || null),
  equipmentNotes: z.string().trim().max(2000).nullish().transform((v) => v || null),
  seatTypes: z
    .array(z.nativeEnum(SeatType))
    .max(10)
    .default([])
    .transform((types) => [...new Set(types)]),
  wideDoor: z.boolean().default(false),
  specialNeeds: z.boolean().default(false),
  // Fase 9, bloco 3: o que o módulo de Eventos precisa saber do espaço.
  coffeeAllowed: z.boolean().default(false),
  // Vazio = a capacidade do espaço.
  coffeeCapacity: z.number().int().positive("O máximo de pessoas no coffee deve ser maior que zero.").nullish().transform((v) => v ?? null),
  // "Indicado para eventos acima de N pessoas": orientação, não capacidade máxima.
  recommendedAbove: z.number().int().positive("A indicação de público deve ser maior que zero.").nullish().transform((v) => v ?? null),
  requiresBoardApproval: z.boolean().default(false),
  usageRules: z.string().trim().max(2000).nullish().transform((v) => v || null),
  // ids de resources + quantidade; substitui totalmente o vínculo atual da sala
  resources: z.array(resourceAssignmentSchema).max(100).default([]),
});

export const CAPACITY_REQUIRED_MESSAGE = "Informe a capacidade para deixar a sala Ativa.";

/**
 * Sala Ativa precisa de capacidade; área de apoio não (o átrio não tem um
 * limite cadastrado). Vale também para o PATCH, com o estado final da sala.
 */
export function needsCapacity(room: { status: RoomStatus; roomType: RoomType; capacity: number | null }): boolean {
  return room.status === RoomStatus.ACTIVE && room.roomType !== RoomType.SUPPORT_AREA && room.capacity === null;
}

export const createRoomSchema = roomFields.superRefine((room, ctx) => {
  if (needsCapacity(room)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capacity"], message: CAPACITY_REQUIRED_MESSAGE });
  }
});

// Todos os campos opcionais (PATCH); quando `resources` é enviado, o conjunto
// vinculado à sala é substituído por completo (não é um "adicionar a mais").
// As regras "Ativa precisa de capacidade" e "coffee só com coffee liberado" são
// conferidas na rota, com o estado final da sala.
export const updateRoomSchema = roomFields.partial();

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

export const photoCaptionSchema = z.object({
  caption: z.string().trim().max(120).nullish().transform((v) => v || null),
});

export const photoOrderSchema = z.object({
  ids: z.array(z.string().uuid()).max(100),
});
