import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { assertAllowedEmailDomain, resolveInitialRole } from "../auth/domain";
import { completeSenhaUnicaLogin, startSenhaUnicaLogin } from "../auth/senhaunica";
import {
  clearOAuthFlowCookie,
  clearSessionCookie,
  readOAuthFlowCookie,
  setOAuthFlowCookie,
  setSessionCookie,
} from "../lib/cookies";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { signOAuthFlowToken, signSessionToken, verifyOAuthFlowToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

// ----------------------------------------------------------------------------
// Comuns a qualquer modo de autenticação
// ----------------------------------------------------------------------------

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/config", (_req, res) => {
  // O front usa isto para saber qual tela de login mostrar.
  res.json({ mode: env.AUTH_MODE, demo: env.DEMO_MODE });
});

/** Cria (no primeiro acesso) ou atualiza o usuário e abre a sessão. Usado pelos três modos. */
async function loginOrCreateUser(input: { uspNumber: string; name: string; email: string }) {
  const email = input.email.trim().toLowerCase();
  assertAllowedEmailDomain(email);

  const user = await prisma.user.upsert({
    where: { email },
    update: { name: input.name, uspNumber: input.uspNumber },
    create: { email, name: input.name, uspNumber: input.uspNumber, role: resolveInitialRole(email) },
  });

  return user;
}

// ----------------------------------------------------------------------------
// Modo "mock" — fora de produção, ou na demonstração online (DEMO_MODE com
// ACCESS_CODE; regra em config/env.ts)
// ----------------------------------------------------------------------------

const mockOnly = (_req: unknown, res: import("express").Response, next: import("express").NextFunction) => {
  if (env.AUTH_MODE !== "mock") {
    next(new AppError(404, "NOT_FOUND", "Rota não encontrada."));
    return;
  }
  next();
};

// Lista de contas de teste para a tela "Dev Mode": qualquer usuário já cadastrado
// no banco (o seed cria uma de cada domínio autorizado) pode ser escolhido sem senha.
authRouter.get(
  "/mock/users",
  mockOnly,
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { email: "asc" },
    });
    res.json({ users });
  }),
);

const mockLoginSchema = z.object({ email: z.string().email() });

// Permite também digitar um e-mail novo (de domínio autorizado) para simular um
// usuário USP que ainda não existe no banco — útil para testar o fluxo de 1º acesso.
authRouter.post(
  "/mock/login",
  mockOnly,
  asyncHandler(async (req, res) => {
    const { email } = mockLoginSchema.parse(req.body);
    const normalized = email.trim().toLowerCase();
    assertAllowedEmailDomain(normalized);

    const existing = await prisma.user.findUnique({ where: { email: normalized } });
    const user =
      existing ??
      (await loginOrCreateUser({
        uspNumber: `mock-${Date.now()}`,
        name: normalized.split("@")[0] ?? normalized,
        email: normalized,
      }));

    setSessionCookie(res, signSessionToken(user));
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }),
);

// ----------------------------------------------------------------------------
// Modo "senhaunica" — OAuth 1.0a (ver avisos em src/auth/senhaunica.ts)
// ----------------------------------------------------------------------------

const senhaUnicaOnly = (_req: unknown, res: import("express").Response, next: import("express").NextFunction) => {
  if (env.AUTH_MODE !== "senhaunica") {
    next(new AppError(404, "NOT_FOUND", "Rota não encontrada."));
    return;
  }
  next();
};

authRouter.get(
  "/senhaunica/login",
  senhaUnicaOnly,
  asyncHandler(async (req, res) => {
    const callbackUrl = `${req.protocol}://${req.get("host")}/api/auth/senhaunica/callback`;
    const { requestToken, authorizeUrl } = await startSenhaUnicaLogin(callbackUrl);

    setOAuthFlowCookie(res, signOAuthFlowToken(requestToken.key, requestToken.secret));
    res.redirect(authorizeUrl);
  }),
);

const callbackQuerySchema = z.object({ oauth_token: z.string(), oauth_verifier: z.string() });

authRouter.get(
  "/senhaunica/callback",
  senhaUnicaOnly,
  asyncHandler(async (req, res) => {
    const { oauth_token: oauthToken, oauth_verifier: oauthVerifier } = callbackQuerySchema.parse(req.query);

    const flowToken = readOAuthFlowCookie(req);
    const flow = flowToken ? verifyOAuthFlowToken(flowToken) : null;
    clearOAuthFlowCookie(res);

    if (!flow || flow.tokenKey !== oauthToken) {
      throw new AppError(400, "OAUTH_FLOW_EXPIRED", "Sessão de login expirada. Tente novamente.");
    }

    const info = await completeSenhaUnicaLogin({ key: flow.tokenKey, secret: flow.tokenSecret }, oauthVerifier);
    const user = await loginOrCreateUser(info);

    setSessionCookie(res, signSessionToken(user));
    res.redirect(env.FRONTEND_URL);
  }),
);

// ----------------------------------------------------------------------------
// Modo "oidc" — reservado para uma futura fase; não implementado ainda.
// ----------------------------------------------------------------------------

authRouter.get("/oidc/login", (req, res, next) => {
  if (env.AUTH_MODE !== "oidc") {
    next(new AppError(404, "NOT_FOUND", "Rota não encontrada."));
    return;
  }
  next(new AppError(501, "NOT_IMPLEMENTED", "Login via OIDC ainda não foi implementado."));
});
