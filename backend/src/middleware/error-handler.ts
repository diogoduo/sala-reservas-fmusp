import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } });
};

// Formato único de erro: { error: { code, message, details? } }
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: err.flatten() },
    });
    return;
  }

  // Corpo maior que o limite do parser (ex.: foto acima de 30 MB).
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Arquivo grande demais." } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." } });
};
