import { Prisma, RoomStatus, RoomType } from "@prisma/client";
import express, { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { roomPhotosInclude } from "../photos/include";
import { renderPhotoVersions } from "../photos/storage";
import { CAPACITY_REQUIRED_MESSAGE, createRoomSchema, photoCaptionSchema, photoOrderSchema, updateRoomSchema } from "../schemas/room";

export const roomsRouter = Router();

const roomInclude = {
  resources: { include: { resource: true }, orderBy: { resource: { name: "asc" } } },
  photos: roomPhotosInclude,
} satisfies Prisma.RoomInclude;

type RoomWithResources = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;

/**
 * Modelo, patrimônio e "outros equipamentos" são inventário interno: só o SAD
 * (Admin) vê. Para o solicitante, a sala mostra só os tipos de recurso.
 */
function forViewer(room: RoomWithResources, role: string | undefined) {
  if (role === "ADMIN") return room;
  const { equipmentNotes: _notes, ...publicRoom } = room;
  return {
    ...publicRoom,
    resources: room.resources.map(({ model: _model, assetTags: _tags, ...link }) => link),
  };
}

const listQuerySchema = z.object({
  status: z.nativeEnum(RoomStatus).optional(),
  roomType: z.nativeEnum(RoomType).optional(),
  building: z.string().min(1).optional(),
  minCapacity: z.coerce.number().int().positive().optional(),
});

// Qualquer usuário autenticado pode listar/ver salas (necessário para a busca
// do solicitante na Fase 5); só o Admin cria/edita/exclui.
roomsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);

    const rooms = await prisma.room.findMany({
      where: {
        status: query.status,
        roomType: query.roomType,
        building: query.building ? { equals: query.building, mode: "insensitive" } : undefined,
        capacity: query.minCapacity ? { gte: query.minCapacity } : undefined,
      },
      include: roomInclude,
      orderBy: [{ building: "asc" }, { floor: "asc" }, { name: "asc" }],
    });

    res.json({ rooms: rooms.map((room) => forViewer(room, req.user?.role)) });
  }),
);

roomsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const room = await prisma.room.findUnique({ where: { id: req.params.id }, include: roomInclude });
    if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
    res.json({ room: forViewer(room, req.user?.role) });
  }),
);

const availabilityQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// Intervalos ocupados (reservas ativas + bloqueios) de uma sala num período —
// usado pelo calendário do solicitante (Fase 5) para colorir dias/horários indisponíveis.
// Não substitui a checagem de conflito feita em POST /api/reservations (que roda
// dentro de uma transação com lock); isto é só leitura para orientar a busca.
roomsRouter.get(
  "/:id/availability",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { from, to } = availabilityQuerySchema.parse(req.query);
    const rangeStart = from ?? new Date();
    const rangeEnd = to ?? new Date(rangeStart.getTime() + 1000 * 60 * 60 * 24 * 60); // 60 dias por padrão

    const room = await prisma.room.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");

    const [reservations, blocks] = await Promise.all([
      prisma.reservation.findMany({
        where: {
          roomId: req.params.id,
          status: { in: ["PENDING", "APPROVED"] },
          startTime: { lt: rangeEnd },
          endTime: { gt: rangeStart },
        },
        select: { startTime: true, endTime: true, status: true },
      }),
      prisma.roomBlock.findMany({
        where: { roomId: req.params.id, startTime: { lt: rangeEnd }, endTime: { gt: rangeStart } },
        select: { startTime: true, endTime: true, reason: true },
      }),
    ]);

    const busy = [
      ...reservations.map((r) => ({ start: r.startTime, end: r.endTime, type: "reservation" as const, status: r.status })),
      ...blocks.map((b) => ({ start: b.startTime, end: b.endTime, type: "block" as const, reason: b.reason })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());

    res.json({ busy });
  }),
);

roomsRouter.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createRoomSchema.parse(req.body);

    const room = await prisma.$transaction(async (tx) => {
      let created;
      try {
        created = await tx.room.create({
          data: {
            name: input.name,
            building: input.building,
            floor: input.floor,
            capacity: input.capacity,
            roomType: input.roomType,
            status: input.status,
            extraSeats: input.extraSeats,
            dimensions: input.dimensions,
            equipmentNotes: input.equipmentNotes,
            seatTypes: input.seatTypes,
            wideDoor: input.wideDoor,
            specialNeeds: input.specialNeeds,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "ROOM_ALREADY_EXISTS", "Já existe uma sala com esse nome neste prédio/andar.");
        }
        throw error;
      }

      if (input.resources.length > 0) {
        await tx.roomResource.createMany({
          data: input.resources.map((r) => ({ roomId: created.id, resourceId: r.resourceId, quantity: r.quantity, model: r.model, assetTags: r.assetTags })),
        });
      }

      return tx.room.findUniqueOrThrow({ where: { id: created.id }, include: roomInclude });
    });

    res.status(201).json({ room });
  }),
);

roomsRouter.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = updateRoomSchema.parse(req.body);
    const { resources, ...fields } = input;
    const roomId = req.params.id!;

    const exists = await prisma.room.findUnique({ where: { id: roomId }, select: { status: true, capacity: true } });
    if (!exists) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
    const finalStatus = fields.status ?? exists.status;
    const finalCapacity = fields.capacity !== undefined ? fields.capacity : exists.capacity;
    if (finalStatus === RoomStatus.ACTIVE && finalCapacity === null) {
      throw new AppError(400, "CAPACITY_REQUIRED", CAPACITY_REQUIRED_MESSAGE);
    }

    const room = await prisma.$transaction(async (tx) => {
      try {
        await tx.room.update({ where: { id: roomId }, data: fields });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "ROOM_ALREADY_EXISTS", "Já existe uma sala com esse nome neste prédio/andar.");
        }
        throw error;
      }

      // `resources` substitui o conjunto vinculado por completo, não faz merge.
      if (resources) {
        await tx.roomResource.deleteMany({ where: { roomId } });
        if (resources.length > 0) {
          await tx.roomResource.createMany({
            data: resources.map((r) => ({ roomId, resourceId: r.resourceId, quantity: r.quantity, model: r.model, assetTags: r.assetTags })),
          });
        }
      }

      return tx.room.findUniqueOrThrow({ where: { id: roomId }, include: roomInclude });
    });

    res.json({ room });
  }),
);

// ---------------------------------------------------------------------------
// Fotos (só Admin). As versões são servidas em /api/fotos/<id>-{thumb,large}.webp
// ---------------------------------------------------------------------------

async function findPhoto(roomId: string, photoId: string) {
  const photo = await prisma.roomPhoto.findFirst({ where: { id: photoId, roomId } });
  if (!photo) throw new AppError(404, "PHOTO_NOT_FOUND", "Foto não encontrada.");
  return photo;
}

// Corpo = o arquivo da imagem (Content-Type image/*), sem multipart. Legenda opcional em ?caption=.
roomsRouter.post(
  "/:id/photos",
  requireAdmin,
  express.raw({ type: "image/*", limit: "30mb" }),
  asyncHandler(async (req, res) => {
    const roomId = req.params.id!;
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(400, "INVALID_IMAGE", "Envie o arquivo da foto (JPG, PNG ou WebP).");
    }
    const { caption } = photoCaptionSchema.parse({ caption: req.query.caption });

    const versions = await renderPhotoVersions(req.body);
    const last = await prisma.roomPhoto.aggregate({ where: { roomId }, _max: { position: true } });
    const photo = await prisma.roomPhoto.create({
      data: { roomId, caption, ...versions, position: (last._max.position ?? -1) + 1 },
      select: roomPhotosInclude.select,
    });
    res.status(201).json({ photo });
  }),
);

roomsRouter.patch(
  "/:id/photos/:photoId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { caption } = photoCaptionSchema.parse(req.body);
    await findPhoto(req.params.id!, req.params.photoId!);
    const photo = await prisma.roomPhoto.update({
      where: { id: req.params.photoId },
      data: { caption },
      select: roomPhotosInclude.select,
    });
    res.json({ photo });
  }),
);

// Nova ordem da galeria: todos os ids da sala, a capa primeiro.
roomsRouter.put(
  "/:id/photos/order",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const roomId = req.params.id!;
    const { ids } = photoOrderSchema.parse(req.body);
    const current = await prisma.roomPhoto.findMany({ where: { roomId }, select: { id: true } });
    const sameSet = current.length === ids.length && current.every((p) => ids.includes(p.id));
    if (!sameSet) throw new AppError(400, "INVALID_PHOTO_ORDER", "A nova ordem precisa ter todas as fotos da sala, uma vez cada.");

    await prisma.$transaction(ids.map((id, position) => prisma.roomPhoto.update({ where: { id }, data: { position } })));
    const photos = await prisma.roomPhoto.findMany({ where: { roomId }, ...roomPhotosInclude });
    res.json({ photos });
  }),
);

roomsRouter.delete(
  "/:id/photos/:photoId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const photo = await findPhoto(req.params.id!, req.params.photoId!);
    await prisma.roomPhoto.delete({ where: { id: photo.id } });
    res.status(204).end();
  }),
);

// Exclusão definitiva. Sala com reservas/séries vinculadas não pode ser excluída
// (FK ON DELETE RESTRICT) — o Admin deve marcá-la como Inativa (PATCH status) em vez disso.
roomsRouter.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await prisma.room.delete({ where: { id: req.params.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
        if (error.code === "P2003") {
          throw new AppError(
            409,
            "ROOM_HAS_REFERENCES",
            "Esta sala tem reservas ou séries vinculadas e não pode ser excluída. Marque-a como Inativa em vez de excluir.",
          );
        }
      }
      throw error;
    }
    res.status(204).end();
  }),
);
