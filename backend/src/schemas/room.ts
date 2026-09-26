import { RoomStatus, RoomType } from "@prisma/client";
import { z } from "zod";

export const resourceAssignmentSchema = z.object({
  resourceId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
});

export const createRoomSchema = z.object({
  name: z.string().min(1, "Informe o nome/número da sala.").max(120),
  building: z.string().min(1, "Informe o prédio/bloco.").max(120),
  floor: z.string().min(1, "Informe o andar/pavimento.").max(60),
  capacity: z.number().int().positive("A capacidade deve ser maior que zero."),
  roomType: z.nativeEnum(RoomType),
  status: z.nativeEnum(RoomStatus).default(RoomStatus.ACTIVE),
  // ids de resources + quantidade; substitui totalmente o vínculo atual da sala
  resources: z.array(resourceAssignmentSchema).default([]),
});

// Todos os campos opcionais (PATCH); quando `resources` é enviado, o conjunto
// vinculado à sala é substituído por completo (não é um "adicionar a mais").
export const updateRoomSchema = createRoomSchema.partial();

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
