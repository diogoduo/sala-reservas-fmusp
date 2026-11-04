import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "../database-url";

/**
 * Prepara o banco dos testes de rota: cria o banco, se faltar, e aplica as
 * migrations. Por segurança, só aceita um banco local cujo nome termine em
 * "_test": os testes apagam todas as tabelas.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const database = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(database) || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`TEST_DATABASE_URL precisa ser um banco local terminado em "_test" (recebido: ${url.hostname}/${database}).`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const [found] = await admin.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${database}`;
    if (!found) await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.$disconnect();
  }

  // Roda na pasta backend/ (onde fica o vitest.config.ts), como `npm test`.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
