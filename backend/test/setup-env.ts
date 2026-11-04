import { TEST_DATABASE_URL } from "./database-url";

// Roda antes de cada arquivo de teste, antes de src/config/env.ts ser carregado.
process.env.DATABASE_URL = TEST_DATABASE_URL;
