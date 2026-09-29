import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { attachUser } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { accessRouter, requireAccessCode } from "./routes/access";
import { adminRouter } from "./routes/admin";
import { adminActionsRouter } from "./routes/admin-actions";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { notebooksRouter } from "./routes/notebooks";
import { photosRouter } from "./routes/photos";
import { regulationRouter } from "./routes/regulation";
import { reservationsRouter } from "./routes/reservations";
import { resourcesRouter } from "./routes/resources";
import { roomsRouter } from "./routes/rooms";

/**
 * Front-end compilado (npm run build em frontend/). Em produção o próprio
 * back-end serve o site: mesma origem, então o cookie de sessão funciona sem
 * configurar CORS. Em dev quem serve é o Vite (5173).
 */
function frontendDist(): string | null {
  const dir = env.FRONTEND_DIST ? path.resolve(env.FRONTEND_DIST) : path.resolve(__dirname, "..", "..", "frontend", "dist");
  const enabled = env.NODE_ENV === "production" || Boolean(env.FRONTEND_DIST);
  return enabled && existsSync(path.join(dir, "index.html")) ? dir : null;
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(attachUser);

  // Com ACCESS_CODE definido, toda a API (menos /health e /access) exige o código.
  app.use("/api", requireAccessCode);
  app.use("/api/access", accessRouter);
  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/rooms", roomsRouter);
  app.use("/api/resources", resourcesRouter);
  app.use("/api/reservations", reservationsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/admin", adminActionsRouter);
  app.use("/api/notebooks", notebooksRouter);
  app.use("/api/fotos", photosRouter);
  app.use("/api/regulamento", regulationRouter);
  // Próximas fases: /api/calendar (.ics)

  const dist = frontendDist();
  if (dist) {
    // Arquivos de /assets têm hash no nome: podem ficar em cache para sempre.
    app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "365d", fallthrough: false }));
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    // Rotas do React (/minhas-reservas, /admin/salas…): qualquer GET fora de /api devolve o index.html.
    app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
