import type { UserRole } from "@prisma/client";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../lib/errors";
import { SESSION_COOKIE } from "../lib/cookies";
import { verifySessionToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

/**
 * Lê o cookie de sessão (se houver) e preenche `req.user`. Nunca bloqueia a requisição.
 *
 * O papel e as permissões vêm do banco a cada requisição, e não do cookie: quando
 * o SAD muda o papel de alguém ou retira uma permissão, vale na hora, sem esperar
 * a sessão expirar. Cadastro excluído = sem sessão.
 */
export const attachUser: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    next();
    return;
  }
  prisma.user
    .findUnique({ where: { id: payload.sub }, select: { id: true, email: true, name: true, role: true, permissions: true } })
    .then((user) => {
      if (user) req.user = user;
      next();
    })
    .catch(next);
};

/** SAD e NUCEV: a equipe, que vê as reservas de todos e o inventário das salas. */
export const isStaff = (role: UserRole | undefined) => role === "ADMIN" || role === "NUCEV";

const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "É necessário fazer login para acessar este recurso.");

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  next(req.user ? undefined : unauthenticated());
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthenticated());
  if (req.user.role !== "ADMIN") return next(new AppError(403, "FORBIDDEN", "Só o SAD pode fazer isso."));
  next();
}

export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthenticated());
  if (!isStaff(req.user.role)) return next(new AppError(403, "FORBIDDEN", "Só a equipe do SAD e do NUCEV pode acessar isto."));
  next();
}

/**
 * Áreas do SAD em que o NUCEV acompanha sem mexer: o SAD faz tudo; o NUCEV só
 * consulta (GET). Qualquer ação (POST, PUT, PATCH, DELETE) continua sendo do SAD.
 */
export function staffReadOnly(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthenticated());
  if (req.user.role === "ADMIN") return next();
  if (req.user.role === "NUCEV" && (req.method === "GET" || req.method === "HEAD")) return next();
  next(new AppError(403, "FORBIDDEN", req.user.role === "NUCEV" ? "Só o SAD pode fazer isso." : "Só a equipe do SAD e do NUCEV pode acessar isto."));
}
