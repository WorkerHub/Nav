import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { getTablePrefix, type HonoEnv } from "../types";
import { verifyJWT } from "../core/auth";
import { findSession, findUserById } from "../db/queries/users";
import { nowIso } from "../db/sql";

export const SESSION_COOKIE = "nav_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export function sessionMaxAge(): number {
  return SESSION_TTL_SECONDS;
}

/** 401 JSON helper shared by the private API surface. */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * 会话探测：有效会话返回 user id，否则 null（不抛、不写响应）。`authMiddleware`
 * 与需要「有会话则放宽」的端点（`GET /api/icon` 的私有 host）共用这一条判断。
 */
export async function getSessionUserId(
  c: Context<HonoEnv>,
): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const payload = await verifyJWT(token, c.env.SESSION_SECRET);
  if (!payload) return null;

  const prefix = getTablePrefix(c.env);
  const session = await findSession(c.env.DB, prefix, payload.sid);
  if (!session || session.expires_at < nowIso()) return null;
  if (session.user_id !== payload.sub) return null;

  const user = await findUserById(c.env.DB, prefix, session.user_id);
  if (!user?.is_active) return null;

  return user.id;
}

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  const userId = await getSessionUserId(c);
  if (!userId) return unauthorized();

  c.set("userId", userId);
  await next();
}
