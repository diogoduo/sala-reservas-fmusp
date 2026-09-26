import { env } from "../config/env";
import { AppError } from "../lib/errors";
import type { UserRole } from "@prisma/client";

/**
 * Valida que o e-mail pertence a um dos domínios autorizados
 * (ALLOWED_EMAIL_DOMAINS). Lança AppError 403 caso contrário — é a MESMA regra
 * que o CHECK "users_email_domain_check" aplica no banco; aqui só damos uma
 * mensagem amigável antes de chegar lá.
 */
export function assertAllowedEmailDomain(email: string): void {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1];
  const allowed = domain && env.ALLOWED_EMAIL_DOMAINS.some((d) => domain === d);

  if (!allowed) {
    throw new AppError(
      403,
      "EMAIL_DOMAIN_NOT_ALLOWED",
      `Apenas e-mails dos domínios ${env.ALLOWED_EMAIL_DOMAINS.join(", ")} podem acessar o sistema.`,
    );
  }
}

/** ADMIN se o e-mail estiver em ADMIN_EMAILS; caso contrário USER. Usado só no 1º login. */
export function resolveInitialRole(email: string): UserRole {
  return env.ADMIN_EMAILS.includes(email.trim().toLowerCase()) ? "ADMIN" : "USER";
}
