import { defineConfig } from "vitest/config";

// Dois grupos: "unit" (regras puras, sem banco) e "api" (rotas de verdade, com
// um PostgreSQL só dos testes). `npx vitest --project unit` roda sem banco.
export default defineConfig({
  test: {
    // Os testes de rota dividem o mesmo banco: um arquivo por vez.
    fileParallelism: false,
    hookTimeout: 30_000,
    // DATABASE_URL vem de test/setup-env.ts (o banco dos testes).
    setupFiles: ["test/setup-env.ts"],
    testTimeout: 30_000,
    // Ambiente fixo. DOTENV_CONFIG_PATH aponta para um arquivo que não existe,
    // para não carregar o .env do desenvolvimento (que pode ter SMTP ou Brevo de verdade).
    env: {
      DOTENV_CONFIG_PATH: "test/.env-inexistente",
      // Como no Render: o fuso do servidor não pode mudar o resultado.
      TZ: "UTC",
      NODE_ENV: "test",
      FRONTEND_URL: "http://localhost:5173",
      SESSION_SECRET: "segredo-usado-so-nos-testes-automatizados",
      AUTH_MODE: "mock",
      APP_TIMEZONE: "America/Sao_Paulo",
      ALLOWED_EMAIL_DOMAINS: "usp.br,fm.usp.br,hc.fm.usp.br",
      ADMIN_EMAILS: "",
      ACCESS_CODE: "",
      DEMO_MODE: "false",
      MAIL_ENABLED: "false",
      BREVO_API_KEY: "",
      MAIL_REDIRECT_TO: "",
    },
    projects: [
      { extends: true, test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: { name: "api", include: ["test/api/**/*.test.ts"], globalSetup: ["test/api/global-setup.ts"] },
      },
    ],
  },
});
