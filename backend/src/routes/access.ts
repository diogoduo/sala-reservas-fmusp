import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

/**
 * Código de acesso da demonstração online (ACCESS_CODE). Com ele definido, a
 * API só responde para quem já digitou o código: nem a lista de salas nem as
 * fotos saem sem isso. O front-end (HTML/JS) continua público, porque não tem
 * dado nenhum.
 *
 * O cookie guarda um HMAC do código, nunca o código: trocar ACCESS_CODE
 * invalida todos os acessos antigos.
 */
const ACCESS_COOKIE = "acesso";
const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const accessToken = (code: string) => createHmac("sha256", env.SESSION_SECRET).update(`acesso:${code}`).digest("hex");

function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasAccess(req: Request) {
  if (!env.ACCESS_CODE) return true;
  const cookie = req.cookies?.[ACCESS_COOKIE];
  return typeof cookie === "string" && sameText(cookie, accessToken(env.ACCESS_CODE));
}

// Rotas que respondem sem o código: o status do servidor e a própria entrada do código.
const OPEN_PATHS = ["/health", "/access"];

/** Montado em /api, antes de todas as rotas. */
export function requireAccessCode(req: Request, _res: Response, next: NextFunction): void {
  if (OPEN_PATHS.some((path) => req.path === path || req.path.startsWith(`${path}/`)) || hasAccess(req)) {
    next();
    return;
  }
  next(new AppError(401, "ACCESS_CODE_REQUIRED", "Digite o código de acesso para entrar."));
}

// Limite simples contra tentativa e erro: 10 tentativas erradas por IP a cada 15 minutos.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

export const accessRouter = Router();

accessRouter.get("/", (req, res) => {
  res.json({ required: Boolean(env.ACCESS_CODE), granted: hasAccess(req), demo: env.DEMO_MODE });
});

accessRouter.post("/", (req, res) => {
  if (!env.ACCESS_CODE) {
    res.status(204).end();
    return;
  }
  const ip = req.ip ?? "desconhecido";
  const now = Date.now();
  const record = failures.get(ip);
  if (record && record.resetAt > now && record.count >= MAX_ATTEMPTS) {
    throw new AppError(429, "TOO_MANY_ATTEMPTS", "Muitas tentativas. Espere alguns minutos e tente de novo.");
  }

  const { code } = z.object({ code: z.string().trim().max(200) }).parse(req.body);
  if (!sameText(accessToken(code), accessToken(env.ACCESS_CODE))) {
    const current = record && record.resetAt > now ? record : { count: 0, resetAt: now + WINDOW_MS };
    failures.set(ip, { ...current, count: current.count + 1 });
    throw new AppError(401, "INVALID_ACCESS_CODE", "Código de acesso incorreto.");
  }

  failures.delete(ip);
  res.cookie(ACCESS_COOKIE, accessToken(env.ACCESS_CODE), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TTL_MS,
  });
  res.status(204).end();
});
