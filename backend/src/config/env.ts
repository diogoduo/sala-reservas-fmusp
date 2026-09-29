import "dotenv/config";
import { z } from "zod";

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );

const bool = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

// Variável definida mas vazia (comum em painéis de hospedagem) conta como ausente.
const optionalText = (inner: z.ZodString) => z.preprocess((value) => (value === "" ? undefined : value), inner.optional());

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3333),
    APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
    // No Render, o endereço público do serviço vem em RENDER_EXTERNAL_URL.
    FRONTEND_URL: z.preprocess((value) => value || process.env.RENDER_EXTERNAL_URL, z.string().url()),

    DATABASE_URL: z.string().min(1),

    SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa ter pelo menos 32 caracteres"),
    SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
    COOKIE_SECURE: bool("false"),

    AUTH_MODE: z.enum(["mock", "senhaunica", "oidc"]).default("mock"),
    // Demonstração online: libera o login de teste (mock) em produção, desde
    // que o site esteja protegido por ACCESS_CODE.
    DEMO_MODE: bool("false"),
    // Código pedido antes de qualquer tela; sem ele a API não responde. Vazio = sem código.
    ACCESS_CODE: optionalText(z.string().min(6, "ACCESS_CODE precisa ter pelo menos 6 caracteres")),
    // Pasta do front-end compilado (vite build), servida pelo próprio back-end em produção.
    FRONTEND_DIST: optionalText(z.string()),
    ALLOWED_EMAIL_DOMAINS: csv("usp.br,fm.usp.br,hc.fm.usp.br"),
    ADMIN_EMAILS: csv(""),

    SENHAUNICA_KEY: z.string().optional(),
    SENHAUNICA_SECRET: z.string().optional(),
    SENHAUNICA_CALLBACK_ID: z.string().optional(),
    SENHAUNICA_BASE_URL: z.string().url().default("https://uspdigital.usp.br/wsusuario/oauth"),
    // Ver aviso em src/auth/senhaunica.ts: path não confirmado com fonte oficial, ajuste se necessário.
    SENHAUNICA_USER_INFO_PATH: z.string().default("/dadosusuario"),

    OIDC_ISSUER: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_CLIENT_SECRET: z.string().optional(),
    OIDC_REDIRECT_URI: z.string().optional(),

    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: bool("false"),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().min(1).default("Reserva de Salas FMUSP <no-reply@fm.usp.br>"),
    // false = não envia e-mails (só registra no log). Útil numa demonstração sem SMTP.
    MAIL_ENABLED: bool("true"),
    // Com a chave da API do Brevo (plano grátis), envia por HTTPS em vez de SMTP
    // (hospedagens grátis costumam bloquear SMTP). O remetente de MAIL_FROM
    // precisa estar verificado no Brevo.
    BREVO_API_KEY: optionalText(z.string()),
    // Demonstração: todo e-mail vai para este endereço (o assunto diz para quem
    // iria), menos os de MAIL_REDIRECT_EXCEPT. Evita escrever para as contas de teste.
    MAIL_REDIRECT_TO: optionalText(z.string().email()),
    MAIL_REDIRECT_EXCEPT: csv(""),
    TI_EMAIL_ADDRESS: z.string().email().default("ti@fm.usp.br"),
  })
  .superRefine((cfg, ctx) => {
    const requireKeys = (keys: (keyof typeof cfg)[], reason: string) => {
      for (const key of keys) {
        if (!cfg[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${String(key)} é obrigatório ${reason}` });
        }
      }
    };

    if (cfg.AUTH_MODE === "senhaunica") {
      requireKeys(["SENHAUNICA_KEY", "SENHAUNICA_SECRET", "SENHAUNICA_CALLBACK_ID"], "com AUTH_MODE=senhaunica");
    }
    if (cfg.AUTH_MODE === "oidc") {
      requireKeys(["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI"], "com AUTH_MODE=oidc");
    }
    if (cfg.NODE_ENV === "production") {
      if (cfg.AUTH_MODE === "mock" && !(cfg.DEMO_MODE && cfg.ACCESS_CODE)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH_MODE"],
          message: "AUTH_MODE=mock é proibido em produção (exceto em demonstração: DEMO_MODE=true com ACCESS_CODE)",
        });
      }
      if (!cfg.COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["COOKIE_SECURE"],
          message: "COOKIE_SECURE deve ser true em produção",
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
