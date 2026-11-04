// Banco só dos testes de rota (as tabelas são apagadas a cada arquivo). No CI
// vem do serviço postgres do workflow; local, do `docker compose up -d db`
// (mesmo servidor do desenvolvimento, outro banco).
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://reservas:reservas@localhost:5432/reservas_test";
