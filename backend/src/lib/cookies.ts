import type { Request, Response } from "express";
import { env } from "../config/env";

export const SESSION_COOKIE = "session";
export const OAUTH_FLOW_COOKIE = "su_oauth_flow";

const baseOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions, maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseOptions);
}

export function setOAuthFlowCookie(res: Response, token: string): void {
  res.cookie(OAUTH_FLOW_COOKIE, token, { ...baseOptions, maxAge: 10 * 60 * 1000 });
}

export function readOAuthFlowCookie(req: Request): string | undefined {
  return req.cookies?.[OAUTH_FLOW_COOKIE];
}

export function clearOAuthFlowCookie(res: Response): void {
  res.clearCookie(OAUTH_FLOW_COOKIE, baseOptions);
}
