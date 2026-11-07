import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedDateKey, zonedDayRange } from "../lib/timezone";
import { requireAdmin, requireStaff } from "../middleware/auth";

// Fase 15 — painel de reservas para a TV em frente ao SAD. A TV abre um link
// secreto (sem login), que o SAD gera e pode trocar ou desativar; o painel
// mostra o dia: o que acontece agora, o que vem e quantas salas estão livres.
// Não mostra nome nem e-mail de ninguém: só atividade, horário, espaço e situação.

export const TV_TOKEN_KEY = "tv_panel_token";

export const tvSettingsRouter = Router();

const linkInfo = (row: { value: string; updatedAt: Date; updatedByName: string | null } | null) => ({
  token: row?.value ?? null,
  updatedAt: row?.updatedAt ?? null,
  updatedByName: row?.updatedByName ?? null,
});

tvSettingsRouter.get(
  "/",
  requireStaff,
  asyncHandler(async (_req, res) => {
    res.json(linkInfo(await prisma.appSetting.findUnique({ where: { key: TV_TOKEN_KEY } })));
  }),
);

/** Gera o link (ou troca: o anterior para de funcionar na hora). */
tvSettingsRouter.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const token = randomBytes(24).toString("base64url");
    const row = await prisma.$transaction(async (tx) => {
      const before = await tx.appSetting.findUnique({ where: { key: TV_TOKEN_KEY } });
      const saved = await tx.appSetting.upsert({
        where: { key: TV_TOKEN_KEY },
        update: { value: token, updatedByName: req.user!.name },
        create: { key: TV_TOKEN_KEY, value: token, updatedByName: req.user!.name },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "tv.link_create",
        entityType: "setting",
        entityId: TV_TOKEN_KEY,
        label: "Painel da TV",
        details: { replaced: Boolean(before) },
      });
      return saved;
    });
    res.json(linkInfo(row));
  }),
);

tvSettingsRouter.delete(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.appSetting.deleteMany({ where: { key: TV_TOKEN_KEY } });
      if (deleted.count > 0) {
        await recordAudit(tx, { actor: req.user!, action: "tv.link_disable", entityType: "setting", entityId: TV_TOKEN_KEY, label: "Painel da TV" });
      }
    });
    res.json(linkInfo(null));
  }),
);

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const tvRouter = Router();

type TvStatus = "CONFIRMED" | "PENDING" | "PRE_RESERVED";

interface TvItem {
  id: string;
  kind: "reservation" | "event";
  title: string;
  start: Date;
  end: Date;
  status: TvStatus;
  activityType: string | null;
  rooms: { name: string; building: string; floor: string }[];
}

tvRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const row = await prisma.appSetting.findUnique({ where: { key: TV_TOKEN_KEY } });
    if (!row || !sameToken(row.value, String(req.params.token))) {
      throw new AppError(404, "TV_LINK_INVALID", "Link do painel inválido ou desativado. Peça ao SAD um novo link.");
    }
    const now = new Date();
    const today = zonedDateKey(now);
    const { start, end } = zonedDayRange(today);

    const [reservations, rooms, busyNow] = await Promise.all([
      prisma.reservation.findMany({
        where: { startTime: { gte: start, lt: end }, status: { in: ["APPROVED", "PENDING"] } },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          status: true,
          activityType: true,
          room: { select: { name: true, building: true, floor: true } },
          event: { select: { id: true, title: true, status: true } },
        },
        orderBy: [{ startTime: "asc" }, { title: "asc" }],
      }),
      prisma.room.count({ where: { status: "ACTIVE", roomType: { not: "SUPPORT_AREA" } } }),
      // Salas ocupadas agora: reserva (aprovada ou pendente já com sala) ou bloqueio.
      Promise.all([
        prisma.reservation.findMany({
          where: { status: { in: ["APPROVED", "PENDING"] }, roomId: { not: null }, startTime: { lte: now }, endTime: { gt: now }, room: { status: "ACTIVE", roomType: { not: "SUPPORT_AREA" } } },
          select: { roomId: true },
          distinct: ["roomId"],
        }),
        prisma.roomBlock.findMany({
          where: { startTime: { lte: now }, endTime: { gt: now }, room: { status: "ACTIVE", roomType: { not: "SUPPORT_AREA" } } },
          select: { roomId: true },
          distinct: ["roomId"],
        }),
      ]).then(([a, b]) => new Set([...a, ...b].map((r) => r.roomId)).size),
    ]);

    // As salas de um evento viram um item só (o evento), com todas as salas do dia.
    const items: TvItem[] = [];
    const byEvent = new Map<string, TvItem>();
    for (const r of reservations) {
      const room = r.room ? [r.room] : [];
      if (r.event) {
        const item = byEvent.get(r.event.id);
        if (item) {
          if (r.startTime < item.start) item.start = r.startTime;
          if (r.endTime > item.end) item.end = r.endTime;
          for (const x of room) if (!item.rooms.some((y) => y.name === x.name)) item.rooms.push(x);
          continue;
        }
        const created: TvItem = {
          id: r.event.id,
          kind: "event",
          title: r.event.title,
          start: r.startTime,
          end: r.endTime,
          status: r.event.status === "CONFIRMED" ? "CONFIRMED" : "PRE_RESERVED",
          activityType: "CULTURE_EXTENSION",
          rooms: [...room],
        };
        byEvent.set(r.event.id, created);
        items.push(created);
        continue;
      }
      items.push({
        id: r.id,
        kind: "reservation",
        title: r.title,
        start: r.startTime,
        end: r.endTime,
        status: r.status === "APPROVED" ? "CONFIRMED" : "PENDING",
        activityType: r.activityType,
        rooms: room,
      });
    }
    items.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));

    res.set("Cache-Control", "no-store");
    res.json({ now, date: today, items, rooms: { total: rooms, busyNow, freeNow: Math.max(0, rooms - busyNow) } });
  }),
);
