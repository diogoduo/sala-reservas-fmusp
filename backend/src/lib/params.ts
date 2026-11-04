import type { RequestParamHandler } from "express";
import { AppError } from "./errors";

/** Formato de UUID (qualquer versão), como os ids gerados pelo banco. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Para `router.param(nome, uuidParam(...))`: um id que nem é UUID responde o
 * mesmo 404 de "não encontrado" da rota, sem chegar ao Prisma (que recusaria o
 * valor com um erro de banco, virando 500). Vale para todas as rotas do router
 * que usam aquele parâmetro.
 */
export function uuidParam(code: string, message: string): RequestParamHandler {
  return (_req, _res, next, value) => {
    next(UUID_PATTERN.test(String(value)) ? undefined : new AppError(404, code, message));
  };
}
