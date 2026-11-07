import type { ActivityType, Permission, PrismaClient } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth, requireStaff } from "../middleware/auth";

// Fase 19 — disciplinas e os docentes de cada uma (documento SAD/NUCEV, 2.3:
// "docentes@fm: disciplinas vinculadas ao respectivo docente"). O SAD cola a
// planilha (código; disciplina; e-mail do docente; departamento; G ou P); ligar
// uma disciplina libera ao docente a permissão de Graduação (ou de Pós). Quem
// tem disciplinas ligadas pede só para elas; quem não tem (a secretaria, por
// exemplo) continua pedindo para qualquer disciplina, como antes.
export const disciplinesRouter = Router();

const LEVEL_PERMISSION: Record<"UNDERGRADUATE" | "GRADUATE", Permission> = { UNDERGRADUATE: "REQUEST_UNDERGRADUATE", GRADUATE: "REQUEST_GRADUATE" };

/** As disciplinas do docente (de um nível). */
export function disciplinesOf(db: PrismaClient, userId: string, level?: ActivityType) {
  return db.discipline.findMany({ where: { teachers: { some: { userId } }, ...(level ? { level } : {}) }, orderBy: { code: "asc" } });
}

/**
 * Regra do pedido: o docente com disciplinas ligadas (daquele nível) só pede
 * para elas. A equipe (SAD/NUCEV) não passa por aqui.
 */
export async function assertDisciplineAllowed(user: { id: string; role: string }, input: { activityType: ActivityType; details?: unknown }) {
  if (user.role !== "USER" || (input.activityType !== "UNDERGRADUATE" && input.activityType !== "GRADUATE")) return;
  const mine = await disciplinesOf(prisma, user.id, input.activityType);
  if (mine.length === 0) return;
  const code = String((input.details as { disciplineCode?: string } | undefined)?.disciplineCode ?? "").toUpperCase();
  if (!mine.some((d) => d.code === code)) {
    throw new AppError(403, "DISCIPLINE_NOT_LINKED", `A disciplina ${code} não está ligada a você. As suas: ${mine.map((d) => d.code).join(", ")}. Se precisar de outra, fale com o SAD.`);
  }
}

disciplinesRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ disciplines: await disciplinesOf(prisma, req.user!.id) });
  }),
);

/**
 * O formulário de reserva busca pelo código para preencher o resto: o nome, o
 * departamento e os docentes (só o nome, sem e-mail). null = fora do cadastro.
 */
disciplinesRouter.get(
  "/lookup/:code",
  requireAuth,
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? "").toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z]{3}\d{4}$/.test(code)) throw new AppError(400, "VALIDATION_ERROR", "Código inválido: 3 letras e 4 números, ex.: MCM0101.");
    const d = await prisma.discipline.findUnique({
      where: { code },
      include: { teachers: { include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
    });
    res.json({ discipline: d ? { code: d.code, name: d.name, department: d.department, level: d.level, teachers: d.teachers.map((t) => t.user.name) } : null });
  }),
);

disciplinesRouter.get(
  "/",
  requireStaff,
  asyncHandler(async (_req, res) => {
    const disciplines = await prisma.discipline.findMany({
      include: { teachers: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } } },
      orderBy: { code: "asc" },
    });
    res.json({ disciplines });
  }),
);

/** Planilha colada: uma disciplina por linha (código; disciplina; e-mail do docente; departamento; G ou P). */
disciplinesRouter.post(
  "/import",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { text } = z.object({ text: z.string().max(400_000) }).parse(req.body);
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.split(/\t|;/).map((c) => c.trim()))
      .filter((c) => (c[0]?.length ?? 0) > 0);
    if (rows.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Cole ao menos uma linha.");

    const invalid: string[] = [];
    const parsed = rows.flatMap(([code, name, email, department, level]) => {
      const c = (code ?? "").toUpperCase().replace(/\s/g, "");
      if (!/^[A-Z]{3}\d{4}$/.test(c) || !name) {
        invalid.push(code ?? "");
        return [];
      }
      return [{ code: c, name, email: email?.toLowerCase() || null, department: department || null, level: /^p/i.test(level ?? "") ? ("GRADUATE" as const) : ("UNDERGRADUATE" as const) }];
    });

    const result = await prisma.$transaction(async (tx) => {
      const emails = [...new Set(parsed.flatMap((p) => (p.email ? [p.email] : [])))];
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true, permissions: true } });
      const byEmail = new Map(users.map((u) => [u.email, u]));
      let created = 0;
      let linked = 0;
      const missing = new Set<string>();
      for (const row of parsed) {
        const existing = await tx.discipline.findUnique({ where: { code: row.code } });
        const discipline = existing
          ? await tx.discipline.update({ where: { id: existing.id }, data: { name: row.name, department: row.department ?? existing.department, level: row.level } })
          : await tx.discipline.create({ data: { code: row.code, name: row.name, department: row.department, level: row.level } });
        if (!existing) created++;
        if (!row.email) continue;
        const user = byEmail.get(row.email);
        if (!user) {
          missing.add(row.email);
          continue;
        }
        const link = await tx.disciplineTeacher.upsert({
          where: { disciplineId_userId: { disciplineId: discipline.id, userId: user.id } },
          update: {},
          create: { disciplineId: discipline.id, userId: user.id },
        });
        if (link) linked++;
        // Ligar a disciplina libera a permissão do nível.
        const permission = LEVEL_PERMISSION[row.level];
        if (!user.permissions.includes(permission)) {
          user.permissions = [...user.permissions, permission];
          await tx.user.update({ where: { id: user.id }, data: { permissions: user.permissions } });
        }
      }
      await recordAudit(tx, {
        actor: req.user!,
        action: "discipline.import",
        entityType: "user",
        entityId: "disciplinas",
        label: "Disciplinas e docentes",
        details: { lines: rows.length, created, linked, missing: [...missing], invalid },
      });
      return { lines: rows.length, created, updated: parsed.length - created, linked, missing: [...missing], invalid };
    });
    res.status(201).json(result);
  }),
);

disciplinesRouter.delete(
  "/:id/teachers/:userId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const link = await prisma.disciplineTeacher.findUnique({
      where: { disciplineId_userId: { disciplineId: req.params.id!, userId: req.params.userId! } },
      include: { discipline: true, user: { select: { name: true } } },
    });
    if (!link) throw new AppError(404, "NOT_FOUND", "Ligação não encontrada.");
    await prisma.$transaction(async (tx) => {
      await tx.disciplineTeacher.delete({ where: { disciplineId_userId: { disciplineId: link.disciplineId, userId: link.userId } } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "discipline.unlink",
        entityType: "user",
        entityId: link.userId,
        label: link.user.name,
        details: { discipline: `${link.discipline.code} — ${link.discipline.name}` },
      });
    });
    res.json({ ok: true });
  }),
);

disciplinesRouter.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const found = await prisma.discipline.findUnique({ where: { id: req.params.id } });
    if (!found) throw new AppError(404, "NOT_FOUND", "Disciplina não encontrada.");
    await prisma.$transaction(async (tx) => {
      await tx.discipline.delete({ where: { id: found.id } });
      await recordAudit(tx, { actor: req.user!, action: "discipline.delete", entityType: "user", entityId: "disciplinas", label: `${found.code} — ${found.name}` });
    });
    res.json({ ok: true });
  }),
);
