import { Router } from "express";
import { prisma } from "../lib/prisma";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "up", time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "degraded", database: "down", time: new Date().toISOString() });
  }
});
