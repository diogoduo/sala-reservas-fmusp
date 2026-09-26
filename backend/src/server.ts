import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API no ar em http://localhost:${env.PORT} (${env.NODE_ENV}, auth=${env.AUTH_MODE})`);
});

function shutdown(signal: string) {
  console.log(`${signal} recebido, encerrando...`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
