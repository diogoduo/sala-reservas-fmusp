import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { estimateQuote, estimateSchema } from "../quotes/estimate";

// Fase 10 — estimativa de orçamento (Portaria 2794). Só leitura: calcula e
// devolve, sem gravar. Qualquer pessoa logada usa (o formulário de evento mostra
// o valor estimado a quem pede).
export const quotesRouter = Router();

quotesRouter.post(
  "/estimate",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await estimateQuote(prisma, estimateSchema.parse(req.body)));
  }),
);
