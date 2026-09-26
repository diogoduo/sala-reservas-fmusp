import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { UserRole } from "@prisma/client";

export interface SessionPayload {
  typ: "session";
  sub: string; // user id
  email: string;
  name: string;
  role: UserRole;
}

export interface OAuthFlowPayload {
  typ: "oauth1_flow";
  tokenKey: string;
  tokenSecret: string;
}

export function signSessionToken(user: { id: string; email: string; name: string; role: UserRole }): string {
  const payload: SessionPayload = { typ: "session", sub: user.id, email: user.email, name: user.name, role: user.role };
  return jwt.sign(payload, env.SESSION_SECRET, { expiresIn: `${env.SESSION_TTL_HOURS}h` });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, env.SESSION_SECRET) as SessionPayload;
    return payload.typ === "session" ? payload : null;
  } catch {
    return null;
  }
}

/** Token de curta duração para guardar o request token do fluxo OAuth 1.0a entre o /login e o /callback. */
export function signOAuthFlowToken(tokenKey: string, tokenSecret: string): string {
  const payload: OAuthFlowPayload = { typ: "oauth1_flow", tokenKey, tokenSecret };
  return jwt.sign(payload, env.SESSION_SECRET, { expiresIn: "10m" });
}

export function verifyOAuthFlowToken(token: string): OAuthFlowPayload | null {
  try {
    const payload = jwt.verify(token, env.SESSION_SECRET) as OAuthFlowPayload;
    return payload.typ === "oauth1_flow" ? payload : null;
  } catch {
    return null;
  }
}
