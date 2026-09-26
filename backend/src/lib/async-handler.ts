import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 não encaminha rejeições de handlers `async` para o `next(err)`
 * automaticamente (isso só passou a acontecer no Express 5). Sem este wrapper,
 * qualquer erro assíncrono não tratado (ex.: banco fora do ar) derruba o
 * processo Node inteiro em vez de virar uma resposta 500 tratada pelo
 * errorHandler. Envolva TODA rota/middleware `async` com esta função.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
