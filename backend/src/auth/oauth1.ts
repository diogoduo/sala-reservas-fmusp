import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Assinatura OAuth 1.0a (RFC 5849), método HMAC-SHA1 — é o que a Senha Única
 * USP exige (mesmo protocolo usado pelas bibliotecas uspdev/senhaunica-*).
 * Implementado sem dependência externa: apenas Node `crypto`.
 */

export interface OAuth1Credentials {
  key: string;
  secret: string;
}

// RFC 3986 (encodeURIComponent não escapa !*'())
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildBaseString(method: string, url: string, params: Record<string, string>): string {
  const normalizedParams = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key]!)}`)
    .join("&");

  return [method.toUpperCase(), percentEncode(url), percentEncode(normalizedParams)].join("&");
}

function sign(baseString: string, consumerSecret: string, tokenSecret: string): string {
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

/**
 * Gera o cabeçalho `Authorization: OAuth ...` para uma requisição.
 * `token` é o request token (etapa 2) ou o access token (etapa 4); omita na etapa 1.
 */
export function buildAuthorizationHeader(
  method: string,
  url: string,
  consumer: OAuth1Credentials,
  token?: OAuth1Credentials,
  extraParams: Record<string, string> = {},
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumer.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...extraParams,
  };
  if (token) oauthParams.oauth_token = token.key;

  const baseString = buildBaseString(method, url, { ...oauthParams });
  const signature = sign(baseString, consumer.secret, token?.secret ?? "");

  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  const header = Object.keys(headerParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(headerParams[key]!)}"`)
    .join(", ");

  return `OAuth ${header}`;
}

/** Parseia um corpo `a=1&b=2` (formato de resposta do request_token/access_token). */
export function parseFormEncoded(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of body.trim().split("&")) {
    if (!pair) continue;
    const [key, value] = pair.split("=");
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
  }
  return result;
}

/** Hash estável usado para nomear o cookie temporário do fluxo (não é criptográfico). */
export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
