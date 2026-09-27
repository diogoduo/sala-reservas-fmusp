import { RoomStatus, RoomType } from "@prisma/client";
import { z } from "zod";

export const resourceAssignmentSchema = z.object({
  resourceId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  // Inventário (só o SAD vê): vazio vira null.
  model: z.string().trim().max(200).nullish().transform((v) => v || null),
  assetTags: z.string().trim().max(500).nullish().transform((v) => v || null),
});

export const createRoomSchema = z.object({
  name: z.string().min(1, "Informe o nome/número da sala.").max(120),
  building: z.string().min(1, "Informe o prédio/bloco.").max(120),
  floor: z.string().min(1, "Informe o andar/pavimento.").max(60),
  capacity: z.number().int().positive("A capacidade deve ser maior que zero."),
  roomType: z.nativeEnum(RoomType),
  status: z.nativeEnum(RoomStatus).default(RoomStatus.ACTIVE),
  extraSeats: z.number().int().min(0).nullish(),
  dimensions: z.string().trim().max(60).nullish().transform((v) => v || null),
  equipmentNotes: z.string().trim().max(2000).nullish().transform((v) => v || null),
  // ids de resources + quantidade; substitui totalmente o vínculo atual da sala
  resources: z.array(resourceAssignmentSchema).default([]),
});

// Todos os campos opcionais (PATCH); quando `resources` é enviado, o conjunto
// vinculado à sala é substituído por completo (não é um "adicionar a mais").
export const updateRoomSchema = createRoomSchema.partial();

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

export const photoCaptionSchema = z.object({
  caption: z.string().trim().max(120).nullish().transform((v) => v || null),
});

export const photoOrderSchema = z.object({
  ids: z.array(z.string().uuid()).max(100),
});
