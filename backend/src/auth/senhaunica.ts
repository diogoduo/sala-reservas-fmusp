import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { buildAuthorizationHeader, parseFormEncoded, type OAuth1Credentials } from "./oauth1";

/**
 * Adaptador da Senha Única USP (fluxo OAuth 1.0a "three-legged"), no mesmo
 * protocolo das bibliotecas da comunidade (uspdev/senhaunica e
 * uspdev/senhaunica-socialite), conferido no código delas:
 *
 *  1. POST {base}/request_token — request token (as bibliotecas não exigem
 *     `oauth_callback_confirmed` na resposta; só o token e o segredo);
 *  2. redireciona para {base}/authorize?oauth_token=…&callback_id=… — o
 *     callback_id é o cadastrado para o consumidor no admin da USP
 *     (SENHAUNICA_CALLBACK_ID);
 *  3. POST {base}/access_token com o oauth_verifier;
 *  4. POST {base}/usuariousp, assinado com o access token (a assinatura OAuth
 *     é feita para POST), que devolve o JSON com loginUsuario, nomeUsuario,
 *     emailPrincipalUsuario, emailUspUsuario…
 *
 * ⚠️ Ainda sem teste com um consumidor real da USP: só vale como validado
 * depois de um login de verdade com SENHAUNICA_KEY/SECRET/CALLBACK_ID.
 *
 * Erros da USP não vão para o navegador: o corpo da resposta (que pode ter
 * dados pessoais) fica só no log do servidor.
 */

interface RequestTokenResult {
  requestToken: OAuth1Credentials;
  authorizeUrl: string;
}

interface SenhaUnicaUserInfo {
  uspNumber: string;
  name: string;
  email: string;
}

function getConsumer(): OAuth1Credentials {
  return { key: env.SENHAUNICA_KEY ?? "", secret: env.SENHAUNICA_SECRET ?? "" };
}

/** Registra o problema no servidor (sem o corpo inteiro) e devolve um erro genérico ao cliente. */
function upstreamError(message: string, context: { step: string; status?: number; body?: string }): AppError {
  console.error(`[senhaunica] ${context.step}: ${message}`, {
    status: context.status,
    // Pode conter dados pessoais: só o começo, e só no log.
    body: context.body?.slice(0, 300),
  });
  return new AppError(502, "SENHAUNICA_UPSTREAM_ERROR", message);
}

async function postSigned(url: string, authorizationHeader: string, step: string, accept?: string): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: authorizationHeader, ...(accept ? { Accept: accept } : {}) },
  });
  const body = await response.text();
  if (!response.ok) {
    throw upstreamError("Não foi possível contatar a Senha Única USP.", { step, status: response.status, body });
  }
  return body;
}

/** Etapa 1+2: obtém o request token e monta a URL de autorização para redirecionar o usuário. */
export async function startSenhaUnicaLogin(callbackUrl: string): Promise<RequestTokenResult> {
  const consumer = getConsumer();
  const requestTokenUrl = `${env.SENHAUNICA_BASE_URL}/request_token`;

  const header = buildAuthorizationHeader("POST", requestTokenUrl, consumer, undefined, {
    oauth_callback: callbackUrl,
  });
  const data = parseFormEncoded(await postSigned(requestTokenUrl, header, "request_token"));

  if (!data.oauth_token || !data.oauth_token_secret) {
    throw upstreamError("Resposta inesperada da Senha Única USP ao iniciar o login.", { step: "request_token" });
  }

  const requestToken: OAuth1Credentials = { key: data.oauth_token, secret: data.oauth_token_secret };
  const query = new URLSearchParams({ oauth_token: requestToken.key, callback_id: env.SENHAUNICA_CALLBACK_ID ?? "" });
  const authorizeUrl = `${env.SENHAUNICA_BASE_URL}/authorize?${query.toString()}`;

  return { requestToken, authorizeUrl };
}

/** Etapa 3: troca o verifier pelo access token definitivo. */
async function exchangeAccessToken(requestToken: OAuth1Credentials, oauthVerifier: string): Promise<OAuth1Credentials> {
  const consumer = getConsumer();
  const accessTokenUrl = `${env.SENHAUNICA_BASE_URL}/access_token`;

  const header = buildAuthorizationHeader("POST", accessTokenUrl, consumer, requestToken, {
    oauth_verifier: oauthVerifier,
  });
  const data = parseFormEncoded(await postSigned(accessTokenUrl, header, "access_token"));

  if (!data.oauth_token || !data.oauth_token_secret) {
    throw upstreamError("Não foi possível obter o access token da Senha Única USP.", { step: "access_token" });
  }

  return { key: data.oauth_token, secret: data.oauth_token_secret };
}

/** Etapa 4: dados do usuário autenticado — POST {base}/usuariousp, assinado com o access token. */
async function fetchUserInfo(accessToken: OAuth1Credentials): Promise<SenhaUnicaUserInfo> {
  const consumer = getConsumer();
  const userInfoUrl = `${env.SENHAUNICA_BASE_URL}${env.SENHAUNICA_USER_INFO_PATH}`;

  const header = buildAuthorizationHeader("POST", userInfoUrl, consumer, accessToken);
  const rawBody = await postSigned(userInfoUrl, header, "usuariousp", "application/json");

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw upstreamError("Resposta inesperada da Senha Única USP (esperado JSON).", { step: "usuariousp", body: rawBody });
  }

  const uspNumber = String(data.loginUsuario ?? "").trim();
  const name = String(data.nomeUsuario ?? "").trim();
  // `||` e não `??`: e-mail USP vazio ("") também cai para o e-mail principal.
  const email = String(data.emailUspUsuario || data.emailPrincipalUsuario || "")
    .trim()
    .toLowerCase();

  if (!uspNumber || !name || !email) {
    throw upstreamError("Dados de usuário incompletos retornados pela Senha Única USP.", {
      step: "usuariousp",
      body: `campos presentes: ${Object.keys(data).join(", ")}`,
    });
  }

  return { uspNumber, name, email };
}

/** Fluxo completo do callback: troca o verifier e devolve os dados normalizados do usuário. */
export async function completeSenhaUnicaLogin(requestToken: OAuth1Credentials, oauthVerifier: string): Promise<SenhaUnicaUserInfo> {
  const accessToken = await exchangeAccessToken(requestToken, oauthVerifier);
  return fetchUserInfo(accessToken);
}
