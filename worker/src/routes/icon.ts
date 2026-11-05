import { Hono } from "hono";
import type { Context } from "hono";
import { getTablePrefix, type HonoEnv } from "../types";
import { getSessionUserId } from "../middleware/auth";
import {
  getIcon,
  loadIconRegistry,
  parseIconTarget,
  type CachedIcon,
} from "../services/favicon";

/**
 * `GET /api/icon?url=…` —— worker 端图标解析器的唯一边界（契约见
 * docs/api-contract.md §GET /api/icon）。回图按字节返回，前端不与第三方站
 * 直连；抓不到就是 404，由前端回退首字圆。
 */
export const iconRoutes = new Hono<HonoEnv>();

const ICON_CACHE_CONTROL = "public, max-age=86400";
const MISS_CACHE_CONTROL = "public, max-age=3600";

/**
 * 私有 host 的图标只给带会话的人：同一个 URL 匿名是 404、登录是 200，响应必须
 * `Vary: Cookie`，否则共享 CDN/代理可能把带会话拿到的结果回给匿名访客。
 */
const VARY = "Cookie";

/**
 * 第三方 SVG 可能带 `<script>` / 事件属性。前端用 `<img>` 加载时不会执行，但
 * 直接导航到本端点就会在本站 origin 下当文档跑 —— 沙箱化并禁掉一切外部资源。
 */
const ICON_CSP = "default-src 'none'; sandbox";

function iconNotFound(c: Context<HonoEnv>): Response {
  c.header("cache-control", MISS_CACHE_CONTROL);
  c.header("vary", VARY);
  return c.json({ error: "icon not found" }, 404);
}

/** 后台刷新：有 ExecutionContext 就托管，没有（单测）就让它在 isolate 里跑完。 */
function schedule(c: Context<HonoEnv>, task: Promise<unknown>): void {
  const settled = task.catch(() => undefined);
  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    // 没有 ExecutionContext 的环境（app.request）无需额外处理。
  }
}

function iconResponse(icon: CachedIcon): Response {
  return new Response(icon.bytes, {
    status: 200,
    headers: {
      "content-type": icon.mime ?? "application/octet-stream",
      "cache-control": ICON_CACHE_CONTROL,
      // 第三方图片一律当不可信内容：禁止浏览器重新嗅探类型。
      "x-content-type-options": "nosniff",
      "content-security-policy": ICON_CSP,
      vary: VARY,
    },
  });
}

iconRoutes.get("/", async (c) => {
  const requested = parseIconTarget(c.req.query("url") ?? "");
  if (!requested) {
    c.header("cache-control", "no-store");
    return c.json({ error: "url must be an absolute http(s) URL" }, 400);
  }

  const prefix = getTablePrefix(c.env);
  // 私有链接的 host 需要有效会话；会话查询失败按匿名处理，端点不因未初始化
  // 的库变成 500。
  const userId = await getSessionUserId(c).catch(() => null);
  const registry = await loadIconRegistry(c.env, prefix, {
    includePrivate: Boolean(userId),
  });

  // 出网目标取自注册表里的 origin，而不是请求参数里的 path/query。
  const entry = registry.get(requested.host);
  if (!entry) return iconNotFound(c);

  const icon = await getIcon(
    c.env,
    { host: requested.host, origin: entry.origin },
    (task) => schedule(c, task),
  );
  if (icon.status !== "ok" || !icon.bytes) return iconNotFound(c);

  return iconResponse(icon);
});
