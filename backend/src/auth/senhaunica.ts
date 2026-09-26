import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { buildAuthorizationHeader, parseFormEncoded, type OAuth1Credentials } from "./oauth1";

/**
 * Adaptador da Senha Única USP (fluxo OAuth 1.0a "three-legged"), no mesmo
 * protocolo usado pelas bibliotecas oficiais da comunidade (uspdev/senhaunica,
 * uspdev/senhaunica-shield, uspdev/senhaunica-socialite).
 *
 * ⚠️ ATENÇÃO — ANTES DE USAR EM AMBIENTE REAL:
 * Os três primeiros endpoints (request_token / authorize / access_token) seguem
 * o padrão OAuth 1.0a e a URL base documentada publicamente
 * (SENHAUNICA_BASE_URL). Já o endpoint de DADOS DO USUÁRIO autenticado
 * (`fetchUserInfo` abaixo) não pôde ser confirmado com uma fonte oficial no
 * momento em que este código foi escrito — as bibliotecas PHP resolvem essa
 * chamada internamente e a documentação pública não detalha o path exato.
 * `SENHAUNICA_USER_INFO_PATH` está isolado em uma env var justamente para que
 * você ajuste esse único ponto (com o suporte da STI/USP ou testando com um
 * consumidor real) sem tocar no resto do fluxo.
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

async function postForm(url: string, authorizationHeader: string): Promise<Record<string, string>> {
  const response = await fetch(url, { method: "POST", headers: { Authorization: authorizationHeader } });
  const body = await response.text();

  if (!response.ok) {
    throw new AppError(502, "SENHAUNICA_UPSTREAM_ERROR", "Não foi possível contatar a Senha Única USP.", {
      status: response.status,
      body,
    });
  }

  return parseFormEncoded(body);
}

/** Etapa 1+2: obtém o request token e monta a URL de autorização para redirecionar o usuário. */
export async function startSenhaUnicaLogin(callbackUrl: string): Promise<RequestTokenResult> {
  const consumer = getConsumer();
  const requestTokenUrl = `${env.SENHAUNICA_BASE_URL}/request_token`;

  const header = buildAuthorizationHeader("POST", requestTokenUrl, consumer, undefined, {
    oauth_callback: callbackUrl,
  });
  const data = await postForm(requestTokenUrl, header);

  if (data.oauth_callback_confirmed !== "true" || !data.oauth_token || !data.oauth_token_secret) {
    throw new AppError(502, "SENHAUNICA_UPSTREAM_ERROR", "Resposta inesperada da Senha Única USP ao iniciar o login.");
  }

  const requestToken: OAuth1Credentials = { key: data.oauth_token, secret: data.oauth_token_secret };
  const authorizeUrl = `${env.SENHAUNICA_BASE_URL}/authorize?oauth_token=${encodeURIComponent(requestToken.key)}`;

  return { requestToken, authorizeUrl };
}

/** Etapa 3+4: troca o verifier pelo access token definitivo. */
async function exchangeAccessToken(
  requestToken: OAuth1Credentials,
  oauthVerifier: string,
): Promise<OAuth1Credentials> {
  const consumer = getConsumer();
  const accessTokenUrl = `${env.SENHAUNICA_BASE_URL}/access_token`;

  const header = buildAuthorizationHeader("POST", accessTokenUrl, consumer, requestToken, {
    oauth_verifier: oauthVerifier,
  });
  const data = await postForm(accessTokenUrl, header);

  if (!data.oauth_token || !data.oauth_token_secret) {
    throw new AppError(502, "SENHAUNICA_UPSTREAM_ERROR", "Não foi possível obter o access token da Senha Única USP.");
  }

  return { key: data.oauth_token, secret: data.oauth_token_secret };
}

/**
 * Etapa 5: busca os dados do usuário autenticado com o access token.
 * Veja o aviso no topo do arquivo sobre `SENHAUNICA_USER_INFO_PATH`.
 */
async function fetchUserInfo(accessToken: OAuth1Credentials): Promise<SenhaUnicaUserInfo> {
  const consumer = getConsumer();
  const userInfoUrl = `${env.SENHAUNICA_BASE_URL}${env.SENHAUNICA_USER_INFO_PATH}`;

  const header = buildAuthorizationHeader("GET", userInfoUrl, consumer, accessToken);
  const response = await fetch(userInfoUrl, { headers: { Authorization: header, Accept: "application/json" } });
  const rawBody = await response.text();

  if (!response.ok) {
    throw new AppError(502, "SENHAUNICA_UPSTREAM_ERROR", "Não foi possível obter os dados do usuário na Senha Única USP.", {
      status: response.status,
      body: rawBody,
    });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new AppError(502, "SENHAUNICA_UPSTREAM_ERROR", "Resposta inesperada da Senha Única USP (esperado JSON).", {
      body: rawBody,
    });
  }

  // Nomes de campo conforme a resposta documentada pelas bibliotecas da comunidade
  // (loginUsuario, nomeUsuario, emailPrincipalUsuario / emailUspUsuario).
  const uspNumber = String(data.loginUsuario ?? "");
  const name = String(data.nomeUsuario ?? "");
  const email = String(data.emailUspUsuario ?? data.emailPrincipalUsuario ?? "").toLowerCase();

  if (!uspNumber || !name || !email) {
    throw new AppError(502, "SENHAUNICA_UPSTREAM_ERROR", "Dados de usuário incompletos retornados pela Senha Única USP.", {
      body: rawBody,
    });
  }

  return { uspNumber, name, email };
}

/** Fluxo completo do callback: troca o verifier e devolve os dados normalizados do usuário. */
export async function completeSenhaUnicaLogin(
  requestToken: OAuth1Credentials,
  oauthVerifier: string,
): Promise<SenhaUnicaUserInfo> {
  const accessToken = await exchangeAccessToken(requestToken, oauthVerifier);
  return fetchUserInfo(accessToken);
}
