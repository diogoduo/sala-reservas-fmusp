import { Permission, Prisma, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { diffFields, recordAudit } from "../audit/log";
import { assertAllowedEmailDomain } from "../auth/domain";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { uuidParam } from "../lib/params";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";

// Fase 9 — Pessoas: o SAD vê quem tem cadastro, muda o papel (Solicitante, SAD,
// NUCEV) e concede as permissões de pedir Graduação, Pós-Graduação e Defesa.
// Também cadastra alguém antes do primeiro acesso: no primeiro login pela Senha
// Única, a pessoa é reconhecida pelo e-mail e já entra com o papel e as permissões.
export const usersRouter = Router();
// Trava rota a rota (não no roteador inteiro): /api/admin/users/:id/standing e
// /sanctions moram em routes/sanctions.ts e o NUCEV também consulta a situação.
usersRouter.param("id", uuidParam("USER_NOT_FOUND", "Pessoa não encontrada."));

const userSelect = { id: true, name: true, email: true, uspNumber: true, role: true, permissions: true, createdAt: true } as const;

const label = (u: { name: string; email: string }) => `${u.name} (${u.email})`;
/** Ordem fixa: o histórico não acusa mudança só porque a lista veio em outra ordem. */
const sortPermissions = (list: Permission[]) => [...new Set(list)].sort();

const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  role: z.nativeEnum(UserRole).optional(),
  permission: z.nativeEnum(Permission).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

usersRouter.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const users = await prisma.user.findMany({
      where: {
        role: query.role,
        permissions: query.permission ? { has: query.permission } : undefined,
        OR: query.q
          ? [
              { name: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q, mode: "insensitive" } },
              { uspNumber: { contains: query.q } },
            ]
          : undefined,
      },
      select: userSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = users.slice(0, query.limit);
    res.json({ users: page, nextCursor: users.length > query.limit ? page.at(-1)!.id : null });
  }),
);

const createUserSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(200),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  uspNumber: z
    .string()
    .trim()
    .regex(/^\d{3,12}$/, "O nº USP tem só números.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  role: z.nativeEnum(UserRole).default("USER"),
  permissions: z.array(z.nativeEnum(Permission)).max(20).default([]),
});

usersRouter.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    assertAllowedEmailDomain(input.email);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { ...input, uspNumber: input.uspNumber ?? null, permissions: sortPermissions(input.permissions) },
          select: userSelect,
        });
        await recordAudit(tx, {
          actor: req.user!,
          action: "user.create",
          entityType: "user",
          entityId: created.id,
          label: label(created),
          details: { role: created.role, permissions: created.permissions, uspNumber: created.uspNumber },
        });
        return created;
      });
      res.status(201).json({ user });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(409, "USER_EXISTS", "Já existe um cadastro com esse e-mail ou nº USP.");
      }
      throw error;
    }
  }),
);

const updateUserSchema = z
  .object({
    role: z.nativeEnum(UserRole).optional(),
    permissions: z.array(z.nativeEnum(Permission)).max(20).optional(),
  })
  .refine((v) => v.role !== undefined || v.permissions !== undefined, { message: "Nada para alterar." });

usersRouter.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);
    // Evita o SAD ficar sem acesso por engano: outra pessoa do SAD é quem tira o papel de alguém do SAD.
    if (req.params.id === req.user!.id && input.role && input.role !== "ADMIN") {
      throw new AppError(400, "SELF_DEMOTION", "Você não pode tirar o seu próprio acesso de SAD. Peça a outra pessoa do SAD.");
    }
    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: req.params.id }, select: userSelect });
      if (!before) throw new AppError(404, "USER_NOT_FOUND", "Pessoa não encontrada.");
      const after = await tx.user.update({
        where: { id: before.id },
        data: { role: input.role, permissions: input.permissions && sortPermissions(input.permissions) },
        select: userSelect,
      });
      const changes = diffFields(
        { role: before.role, permissions: sortPermissions(before.permissions) },
        { role: after.role, permissions: after.permissions },
      );
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, { actor: req.user!, action: "user.update", entityType: "user", entityId: after.id, label: label(after), changes });
      }
      return after;
    });
    res.json({ user });
  }),
);
