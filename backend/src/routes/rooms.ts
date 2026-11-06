import { Prisma, RoomStatus, RoomType, type UserRole } from "@prisma/client";
import express, { Router } from "express";
import { z } from "zod";
import { diffFields, recordAudit, roomLabel } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { uuidParam } from "../lib/params";
import { prisma } from "../lib/prisma";
import { isStaff, requireAdmin, requireAuth } from "../middleware/auth";
import { roomPhotosInclude } from "../photos/include";
import { renderPhotoVersions } from "../photos/storage";
import { defaultPriceCategoryId, priceTableOn, roomPrice, type PriceTableWithEntries } from "../prices/catalog";
import { parseRequestedResources } from "../reservations/requested-resources";
import { CAPACITY_REQUIRED_MESSAGE, createRoomSchema, needsCapacity, photoCaptionSchema, photoOrderSchema, updateRoomSchema } from "../schemas/room";

export const roomsRouter = Router();
roomsRouter.param("id", uuidParam("ROOM_NOT_FOUND", "Sala não encontrada."));
roomsRouter.param("photoId", uuidParam("PHOTO_NOT_FOUND", "Foto não encontrada."));

const roomInclude = {
  resources: { include: { resource: true }, orderBy: { resource: { name: "asc" } } },
  photos: roomPhotosInclude,
  priceCategory: { select: { id: true, name: true, unit: true, didactic: true } },
} satisfies Prisma.RoomInclude;

type RoomWithResources = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;

/** O que o histórico compara numa sala, com o inventário em texto. */
function roomSnapshot(room: RoomWithResources) {
  return {
    name: room.name,
    building: room.building,
    floor: room.floor,
    capacity: room.capacity,
    roomType: room.roomType,
    status: room.status,
    extraSeats: room.extraSeats,
    dimensions: room.dimensions,
    equipmentNotes: room.equipmentNotes,
    seatTypes: room.seatTypes,
    wideDoor: room.wideDoor,
    specialNeeds: room.specialNeeds,
    coffeeAllowed: room.coffeeAllowed,
    coffeeCapacity: room.coffeeCapacity,
    recommendedAbove: room.recommendedAbove,
    requiresBoardApproval: room.requiresBoardApproval,
    usageRules: room.usageRules,
    priceCategory: room.priceCategory?.name ?? null,
    resources: room.resources
      .map((r) => `${r.resource.name} ×${r.quantity}${r.model ? ` (${r.model})` : ""}${r.assetTags ? ` [${r.assetTags}]` : ""}`)
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
  };
}

/**
 * Modelo, patrimônio e "outros equipamentos" são inventário interno: só a equipe
 * (SAD e NUCEV) vê. Para o solicitante, a sala mostra só os tipos de recurso. As
 * cadeiras extras (professor, rodinha…) também ficam de fora: não contam como
 * lugar e não pode haver cadeira sobressalente (Portaria 2793, Art. 5º §2º).
 */
function forViewer(room: RoomWithResources, role: UserRole | undefined, prices: PriceTableWithEntries | null) {
  // Valor de locação para eventos na tabela vigente (Portaria 2794): todos veem.
  const price = roomPrice(room, prices);
  if (isStaff(role)) return { ...room, price };
  const { equipmentNotes: _notes, extraSeats: _extra, ...publicRoom } = room;
  return {
    ...publicRoom,
    price,
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

    const prices = await priceTableOn(prisma);
    res.json({ rooms: rooms.map((room) => forViewer(room, req.user?.role, prices)) });
  }),
);

roomsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const room = await prisma.room.findUnique({ where: { id: req.params.id }, include: roomInclude });
    if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
    res.json({ room: forViewer(room, req.user?.role, await priceTableOn(prisma)) });
  }),
);

const availabilityQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// Intervalos ocupados (reservas ativas + bloqueios) de uma sala num período —
// usado pelo calendário da sala para colorir os dias e listar o que ocupa cada um.
// Todos veem o título e o tipo de atividade; o SAD vê a reserva inteira
// (solicitante, participantes, recursos, observações).
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
        include: { user: { select: { name: true, email: true } } },
        orderBy: { startTime: "asc" },
      }),
      prisma.roomBlock.findMany({
        where: { roomId: req.params.id, startTime: { lt: rangeEnd }, endTime: { gt: rangeStart } },
        select: { startTime: true, endTime: true, reason: true },
      }),
    ]);

    const isAdmin = isStaff(req.user?.role);
    const resourceIds = [...new Set(reservations.flatMap((r) => parseRequestedResources(r.requestedResources).map((x) => x.resourceId)))];
    const resourceNames = new Map(
      isAdmin && resourceIds.length > 0
        ? (await prisma.resource.findMany({ where: { id: { in: resourceIds } }, select: { id: true, name: true } })).map((r) => [r.id, r.name])
        : [],
    );

    const busy = [
      ...reservations.map((r) => ({
        start: r.startTime,
        end: r.endTime,
        type: "reservation" as const,
        status: r.status,
        id: r.id,
        title: r.title,
        activityType: r.activityType,
        setupMinutes: r.setupMinutes,
        ...(isAdmin && {
          protocol: r.protocol,
          requester: r.user,
          expectedAttendees: r.expectedAttendees,
          description: r.description,
          supportNotes: r.supportNotes,
          seriesId: r.seriesId,
          modified: r.modifiedByRequesterAt !== null && r.status === "PENDING",
          resources: parseRequestedResources(r.requestedResources).map(
            (x) => `${resourceNames.get(x.resourceId) ?? "recurso removido"}${x.quantity ? ` (${x.quantity})` : ""}${x.detail ? `: ${x.detail}` : ""}`,
          ),
        }),
      })),
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
    if (input.priceCategoryId) await assertPriceCategory(input.priceCategoryId);

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
            coffeeAllowed: input.coffeeAllowed,
            // Máximo do coffee só faz sentido onde o coffee é liberado.
            coffeeCapacity: input.coffeeAllowed ? input.coffeeCapacity : null,
            recommendedAbove: input.recommendedAbove,
            requiresBoardApproval: input.requiresBoardApproval,
            usageRules: input.usageRules,
            // Sem escolha, a categoria vem do tipo do espaço (Teatro, anfiteatro, sala…).
            priceCategoryId: input.priceCategoryId !== undefined ? input.priceCategoryId : await defaultPriceCategoryId(tx, input),
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

      const room = await tx.room.findUniqueOrThrow({ where: { id: created.id }, include: roomInclude });
      await recordAudit(tx, {
        actor: req.user!,
        action: "room.create",
        entityType: "room",
        entityId: room.id,
        label: roomLabel(room),
        details: roomSnapshot(room),
      });
      return room;
    });

    res.status(201).json({ room: forViewer(room, req.user?.role, await priceTableOn(prisma)) });
  }),
);

roomsRouter.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = updateRoomSchema.parse(req.body);
    const { resources, ...fields } = input;
    const roomId = req.params.id!;
    if (fields.priceCategoryId) await assertPriceCategory(fields.priceCategoryId);

    const exists = await prisma.room.findUnique({ where: { id: roomId }, select: { status: true, capacity: true, roomType: true, coffeeAllowed: true } });
    if (!exists) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
    const final = {
      status: fields.status ?? exists.status,
      roomType: fields.roomType ?? exists.roomType,
      capacity: fields.capacity !== undefined ? fields.capacity : exists.capacity,
    };
    if (needsCapacity(final)) {
      throw new AppError(400, "CAPACITY_REQUIRED", CAPACITY_REQUIRED_MESSAGE);
    }
    // Desligar o coffee apaga o máximo do coffee.
    if ((fields.coffeeAllowed ?? exists.coffeeAllowed) === false) fields.coffeeCapacity = null;

    const room = await prisma.$transaction(async (tx) => {
      const before = await tx.room.findUniqueOrThrow({ where: { id: roomId }, include: roomInclude });
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

      const after = await tx.room.findUniqueOrThrow({ where: { id: roomId }, include: roomInclude });
      const changes = diffFields(roomSnapshot(before), roomSnapshot(after));
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, { actor: req.user!, action: "room.update", entityType: "room", entityId: roomId, label: roomLabel(after), changes });
      }
      return after;
    });

    res.json({ room: forViewer(room, req.user?.role, await priceTableOn(prisma)) });
  }),
);

async function assertPriceCategory(id: string) {
  if (!(await prisma.priceCategory.findUnique({ where: { id }, select: { id: true } }))) {
    throw new AppError(400, "PRICE_CATEGORY_NOT_FOUND", "Categoria de preço não encontrada.");
  }
}

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
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, name: true, building: true, floor: true } });
    if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Sala não encontrada.");
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(400, "INVALID_IMAGE", "Envie o arquivo da foto (JPG, PNG ou WebP).");
    }
    const { caption } = photoCaptionSchema.parse({ caption: req.query.caption });

    const versions = await renderPhotoVersions(req.body);
    const photo = await prisma.$transaction(async (tx) => {
      const last = await tx.roomPhoto.aggregate({ where: { roomId }, _max: { position: true } });
      const created = await tx.roomPhoto.create({
        data: { roomId, caption, ...versions, position: (last._max.position ?? -1) + 1 },
        select: roomPhotosInclude.select,
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "room.photo_add",
        entityType: "room",
        entityId: roomId,
        label: roomLabel(room),
        details: { photoId: created.id, caption },
      });
      return created;
    });
    res.status(201).json({ photo });
  }),
);

roomsRouter.patch(
  "/:id/photos/:photoId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { caption } = photoCaptionSchema.parse(req.body);
    const before = await findPhoto(req.params.id!, req.params.photoId!);
    const photo = await prisma.$transaction(async (tx) => {
      const updated = await tx.roomPhoto.update({
        where: { id: before.id },
        data: { caption },
        select: { ...roomPhotosInclude.select, room: { select: { name: true, building: true, floor: true } } },
      });
      const { room, ...photo } = updated;
      if ((before.caption ?? null) !== (caption ?? null)) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "room.photo_caption",
          entityType: "room",
          entityId: before.roomId,
          label: roomLabel(room),
          changes: { caption: { from: before.caption, to: caption ?? null } },
          details: { photoId: before.id },
        });
      }
      return photo;
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

    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId }, select: { name: true, building: true, floor: true } });
    await prisma.$transaction(async (tx) => {
      for (const [position, id] of ids.entries()) await tx.roomPhoto.update({ where: { id }, data: { position } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "room.photo_order",
        entityType: "room",
        entityId: roomId,
        label: roomLabel(room),
        details: { coverPhotoId: ids[0] ?? null, count: ids.length },
      });
    });
    const photos = await prisma.roomPhoto.findMany({ where: { roomId }, ...roomPhotosInclude });
    res.json({ photos });
  }),
);

roomsRouter.delete(
  "/:id/photos/:photoId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const photo = await findPhoto(req.params.id!, req.params.photoId!);
    const room = await prisma.room.findUniqueOrThrow({ where: { id: photo.roomId }, select: { name: true, building: true, floor: true } });
    await prisma.$transaction(async (tx) => {
      await tx.roomPhoto.delete({ where: { id: photo.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "room.photo_delete",
        entityType: "room",
        entityId: photo.roomId,
        label: roomLabel(room),
        details: { photoId: photo.id, caption: photo.caption },
      });
    });
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
      await prisma.$transaction(async (tx) => {
        const room = await tx.room.delete({ where: { id: req.params.id } });
        await recordAudit(tx, {
          actor: req.user!,
          action: "room.delete",
          entityType: "room",
          entityId: room.id,
          label: roomLabel(room),
          details: { capacity: room.capacity, roomType: room.roomType, status: room.status },
        });
      });
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
