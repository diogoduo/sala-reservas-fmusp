import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../lib/errors";
import { SESSION_COOKIE } from "../lib/cookies";
import { verifySessionToken } from "../lib/jwt";

/** Lê o cookie de sessão (se houver) e preenche `req.user`. Nunca bloqueia a requisição. */
export const attachUser: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const payload = verifySessionToken(token);
    if (payload) {
      req.user = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
};

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, "UNAUTHENTICATED", "É necessário fazer login para acessar este recurso."));
    return;
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, "UNAUTHENTICATED", "É necessário fazer login para acessar este recurso."));
    return;
  }
  if (req.user.role !== "ADMIN") {
    next(new AppError(403, "FORBIDDEN", "Apenas administradores podem acessar este recurso."));
    return;
  }
  next();
}
