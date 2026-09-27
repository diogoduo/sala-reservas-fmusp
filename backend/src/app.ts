import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { attachUser, requireAuth } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { PHOTO_DIR } from "./photos/storage";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { reservationsRouter } from "./routes/reservations";
import { resourcesRouter } from "./routes/resources";
import { roomsRouter } from "./routes/rooms";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(attachUser);

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/rooms", roomsRouter);
  app.use("/api/resources", resourcesRouter);
  app.use("/api/reservations", reservationsRouter);
  app.use("/api/admin", adminRouter);
  // Fotos das salas: o nome muda a cada upload, então o navegador pode guardar para sempre.
  app.use("/api/fotos", requireAuth, express.static(PHOTO_DIR, { index: false, immutable: true, maxAge: "365d" }));
  // Próximas fases: /api/calendar (.ics)

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
