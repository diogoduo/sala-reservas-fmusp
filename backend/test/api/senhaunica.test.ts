import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Login pela Senha Única contra um servidor OAuth 1.0a FALSO, que confere as
// assinaturas por conta própria. Mostra que o fluxo segue o das bibliotecas
// uspdev, mas não substitui um teste com um consumidor real da USP.

const CONSUMER = { key: "chave-teste", secret: "segredo-teste" };

// Antes dos imports: src/config/env.ts lê o ambiente uma vez só.
vi.hoisted(() => {
  Object.assign(process.env, {
    AUTH_MODE: "senhaunica",
    SENHAUNICA_KEY: "chave-teste",
    SENHAUNICA_SECRET: "segredo-teste",
    SENHAUNICA_CALLBACK_ID: "cb-teste",
    // O endereço de verdade (porta livre) é trocado no beforeAll.
    SENHAUNICA_BASE_URL: "http://127.0.0.1:9/wsusuario/oauth",
  });
});

import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { prisma } from "../../src/lib/prisma";
import { createUser, resetDatabase } from "./helpers";

// ----------------------------------------------------------------------------
// Servidor falso
// ----------------------------------------------------------------------------

const enc = (value: string) => encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function parseOAuthHeader(header: string | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of (header ?? "").matchAll(/(\w+)="([^"]*)"/g)) params[match[1]!] = decodeURIComponent(match[2]!);
  return params;
}

/** Confere a assinatura HMAC-SHA1 (RFC 5849, 3.4) de uma requisição sem parâmetros no corpo nem na URL. */
function validSignature(method: string, url: string, oauth: Record<string, string>, tokenSecret: string): boolean {
  const { oauth_signature: signature, ...signed } = oauth;
  const normalized = Object.keys(signed)
    .sort()
    .map((key) => `${enc(key)}=${enc(signed[key]!)}`)
    .join("&");
  const base = `${method}&${enc(url)}&${enc(normalized)}`;
  return signature === createHmac("sha1", `${enc(CONSUMER.secret)}&${enc(tokenSecret)}`).update(base).digest("base64");
}

interface FakeSenhaUnica {
  baseUrl: string;
  server: Server;
  /** O que /usuariousp devolve no próximo login. */
  profile: Record<string, string>;
  /** Faz /usuariousp falhar com um corpo que tem dados pessoais. */
  failUserInfo: boolean;
  calls: string[];
  verifierFor: (requestToken: string) => string;
}

async function startFakeSenhaUnica(): Promise<FakeSenhaUnica> {
  const requestTokens = new Map<string, string>(); // token → segredo
  const accessTokens = new Map<string, string>();
  let counter = 0;

  const fake = { profile: {}, failUserInfo: false, calls: [] as string[] } as unknown as FakeSenhaUnica;
  fake.verifierFor = (token) => `verificador-${token}`;

  fake.server = createServer((req: IncomingMessage, res) => {
    const path = new URL(req.url!, "http://x").pathname.replace("/wsusuario/oauth", "");
    const url = `${fake.baseUrl}${path}`;
    const oauth = parseOAuthHeader(req.headers.authorization);
    fake.calls.push(`${req.method} ${path}`);
    const send = (status: number, body: string, type = "application/x-www-form-urlencoded") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    if (req.method !== "POST" || oauth.oauth_consumer_key !== CONSUMER.key) return send(400, "pedido inválido");

    if (path === "/request_token") {
      if (!oauth.oauth_callback || !validSignature("POST", url, oauth, "")) return send(401, "assinatura inválida");
      counter += 1;
      requestTokens.set(`rt-${counter}`, `rts-${counter}`);
      // Como na USP: sem oauth_callback_confirmed.
      return send(200, `oauth_token=rt-${counter}&oauth_token_secret=rts-${counter}`);
    }
    if (path === "/access_token") {
      const secret = requestTokens.get(oauth.oauth_token ?? "");
      if (!secret || !validSignature("POST", url, oauth, secret)) return send(401, "assinatura inválida");
      if (oauth.oauth_verifier !== fake.verifierFor(oauth.oauth_token!)) return send(401, "verificador inválido");
      requestTokens.delete(oauth.oauth_token!);
      accessTokens.set(`at-${counter}`, `ats-${counter}`);
      return send(200, `oauth_token=at-${counter}&oauth_token_secret=ats-${counter}`);
    }
    if (path === "/usuariousp") {
      const secret = accessTokens.get(oauth.oauth_token ?? "");
      if (!secret || !validSignature("POST", url, oauth, secret)) return send(401, "assinatura inválida");
      if (fake.failUserInfo) return send(500, "erro interno; usuário Fulana, CPF 123.456.789-00", "text/plain");
      return send(200, JSON.stringify(fake.profile), "application/json");
    }
    return send(404, "não encontrado");
  });

  await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  fake.baseUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/wsusuario/oauth`;
  return fake;
}

// ----------------------------------------------------------------------------

let fake: FakeSenhaUnica;
const app = createApp();

beforeAll(async () => {
  fake = await startFakeSenhaUnica();
  env.SENHAUNICA_BASE_URL = fake.baseUrl;
  await resetDatabase();
});

afterAll(async () => {
  fake.server.close();
  await prisma.$disconnect();
  // Os outros arquivos de teste usam o login de teste.
  process.env.AUTH_MODE = "mock";
  for (const key of ["SENHAUNICA_KEY", "SENHAUNICA_SECRET", "SENHAUNICA_CALLBACK_ID", "SENHAUNICA_BASE_URL"]) delete process.env[key];
});

async function loginViaSenhaUnica(profile: Record<string, string>) {
  fake.profile = profile;
  const agent = request.agent(app);
  const start = await agent.get("/api/auth/senhaunica/login").expect(302);
  const authorize = new URL(start.headers.location!);
  expect(`${authorize.origin}${authorize.pathname}`).toBe(`${fake.baseUrl}/authorize`);
  expect(authorize.searchParams.get("callback_id")).toBe("cb-teste");

  const token = authorize.searchParams.get("oauth_token")!;
  const callback = await agent.get("/api/auth/senhaunica/callback").query({ oauth_token: token, oauth_verifier: fake.verifierFor(token) });
  return { agent, callback };
}

const fulana = { loginUsuario: "1234567", nomeUsuario: "Fulana de Tal", emailPrincipalUsuario: "fulana@usp.br" };

describe("login pela Senha Única (servidor falso)", () => {
  it("primeiro acesso: cria o usuário; e-mail USP vazio cai para o e-mail principal", async () => {
    const { agent, callback } = await loginViaSenhaUnica({ ...fulana, emailUspUsuario: "" });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(env.FRONTEND_URL);

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user).toMatchObject({ name: "Fulana de Tal", email: "fulana@usp.br", role: "USER" });
    expect(await prisma.user.findUnique({ where: { uspNumber: "1234567" } })).toMatchObject({ email: "fulana@usp.br" });
    // Os dados do usuário vêm por POST /usuariousp, assinado para POST.
    expect(fake.calls).toEqual(["POST /request_token", "POST /access_token", "POST /usuariousp"]);
  });

  it("trocou de e-mail: continua o mesmo usuário, com o e-mail novo", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { uspNumber: "1234567" } });
    const { callback } = await loginViaSenhaUnica({ ...fulana, emailUspUsuario: "fulana.tal@usp.br" });
    expect(callback.status).toBe(302);
    const after = await prisma.user.findUniqueOrThrow({ where: { uspNumber: "1234567" } });
    expect(after.id).toBe(before.id);
    expect(after.email).toBe("fulana.tal@usp.br");
  });

  it("e-mail novo já é de outro cadastro: entra mesmo assim e mantém o anterior", async () => {
    const other = await createUser("ocupado@usp.br");
    const { callback } = await loginViaSenhaUnica({ ...fulana, emailUspUsuario: "ocupado@usp.br" });
    expect(callback.status).toBe(302);
    expect((await prisma.user.findUniqueOrThrow({ where: { uspNumber: "1234567" } })).email).toBe("fulana.tal@usp.br");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).uspNumber).toBeNull();
  });

  it("cadastro antigo sem nº USP: é encontrado pelo e-mail e ganha o nº USP", async () => {
    const old = await createUser("beltrano@fm.usp.br");
    const { callback } = await loginViaSenhaUnica({ loginUsuario: "7654321", nomeUsuario: "Beltrano", emailPrincipalUsuario: "beltrano@fm.usp.br" });
    expect(callback.status).toBe(302);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ uspNumber: "7654321", name: "Beltrano" });
  });

  it("domínio de e-mail fora da lista: 403", async () => {
    const { callback } = await loginViaSenhaUnica({ loginUsuario: "1111111", nomeUsuario: "Externo", emailPrincipalUsuario: "externo@gmail.com" });
    expect(callback.status).toBe(403);
    expect(callback.body.error.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
  });

  it("erro na USP: 502 genérico, sem o corpo da resposta da USP", async () => {
    fake.failUserInfo = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { callback } = await loginViaSenhaUnica(fulana);
      expect(callback.status).toBe(502);
      expect(callback.body.error.code).toBe("SENHAUNICA_UPSTREAM_ERROR");
      expect(JSON.stringify(callback.body)).not.toMatch(/CPF|Fulana/);
      // O detalhe fica só no log do servidor.
      expect(errors).toHaveBeenCalled();
    } finally {
      fake.failUserInfo = false;
      errors.mockRestore();
    }
  });
});
