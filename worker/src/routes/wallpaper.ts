import { Hono } from "hono";
import type { HonoEnv } from "../types";

export const wallpaperRoutes = new Hono<HonoEnv>();

/** Bing 每日壁纸元信息接口（zh-CN，当日 idx=0）。 */
const BING_API =
  "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN";

const DAY_SECONDS = 24 * 60 * 60;

/** 北京时间（Asia/Shanghai）当天日期 YYYY-MM-DD，用作按天缓存键。 */
function beijingDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 到下一个北京时间零点的秒数（Cache-Control：当天图缓存至次日）。 */
function secondsUntilNextBeijingMidnight(now: Date): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BEIJING_MIDNIGHT_UTC_MS = 16 * 60 * 60 * 1000; // 00:00 CST == 16:00 UTC
  const ms = now.getTime();
  let next = Math.floor(ms / DAY_MS) * DAY_MS + BEIJING_MIDNIGHT_UTC_MS;
  if (next <= ms) next += DAY_MS;
  return Math.max(1, Math.ceil((next - ms) / 1000));
}

/**
 * 按天缓存键。Cache API 只接受**绝对 URL** 作键：裸串（如 `bing-wallpaper:…`）
 * 在 workerd 会以 “Invalid URL. Cache API keys must be fully-qualified” 拒绝并 500，
 * 因此以当前请求的 origin 解析出同源绝对 URL。
 */
function cacheKey(reqUrl: string, date: string): string {
  return new URL(`/__cache/bing-wallpaper/${date}`, reqUrl).toString();
}

/**
 * 构造图片响应：只放行 content-type / cache-control，**不透传** Bing 上游的
 * content-length、x-msedge-ref、nel、report-to 等内部头。
 */
function buildImageResponse(
  body: ReadableStream<Uint8Array> | null,
  contentType: string,
  maxAge: number,
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

/**
 * 回源当日 Bing 壁纸：先取元信息，优先 UHD 变体，UHD 失败降回接口原图。
 * 任何一步失败返回 null（交由上层走昨日缓存 / 502 回落）。
 */
async function fetchBingWallpaper(): Promise<Response | null> {
  let meta: Response;
  try {
    meta = await fetch(BING_API);
  } catch {
    return null;
  }
  if (!meta.ok) return null;

  let data: { images?: { url?: string }[] };
  try {
    data = (await meta.json()) as { images?: { url?: string }[] };
  } catch {
    return null;
  }
  const urlPath = data.images?.[0]?.url;
  if (!urlPath) return null;

  const baseUrl = `https://www.bing.com${urlPath}`;
  // 分辨率段（如 _1920x1080.jpg）换为 _UHD.jpg；本就是 UHD 时不重复拉取。
  const uhdUrl = baseUrl.replace(/_\d+x\d+\.(jpg|jpeg|png)/i, "_UHD.$1");
  const candidates = uhdUrl === baseUrl ? [baseUrl] : [uhdUrl, baseUrl];

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      if ((res.headers.get("content-type") ?? "").startsWith("image/"))
        return res;
    } catch {
      // continue to next candidate
    }
  }
  return null;
}

// GET /api/wallpaper/today — 同源代理当日 Bing 壁纸（无鉴权，公共页未登录也要取图）。
wallpaperRoutes.get("/today", async (c) => {
  const now = new Date();
  const todayKey = cacheKey(c.req.url, beijingDate(now));
  const clientMaxAge = secondsUntilNextBeijingMidnight(now);

  // 缓存命中：缓存条目存 2 天（见下方），但发给浏览器的 TTL 始终是「到次日零点」。
  const cached = await caches.default.match(todayKey);
  if (cached) {
    return buildImageResponse(
      cached.body,
      cached.headers.get("content-type") ?? "image/jpeg",
      clientMaxAge,
    );
  }

  const image = await fetchBingWallpaper();
  if (image) {
    const contentType = image.headers.get("content-type") ?? "image/jpeg";
    // 缓存条目多存一天（覆盖次日「昨日回退」窗口），与发给客户端的 TTL 分开：
    // 客户端只缓存到次日零点，缓存条目保留到再下一个零点。
    const cacheMaxAge = clientMaxAge + DAY_SECONDS;

    if (!image.body) {
      return c.json({ error: "wallpaper unavailable" }, 502);
    }
    const [clientBody, cacheBody] = image.body.tee();
    const clientResponse = buildImageResponse(
      clientBody,
      contentType,
      clientMaxAge,
    );
    const cacheResponse = buildImageResponse(
      cacheBody,
      contentType,
      cacheMaxAge,
    );
    try {
      await caches.default.put(todayKey, cacheResponse);
    } catch {
      // 缓存是尽力而为：写失败不影响本次取图。
    }
    return clientResponse;
  }

  // 回源失败：宁用昨日缓存图，不用空白。
  const yesterday = new Date(now.getTime() - DAY_SECONDS * 1000);
  const previous = await caches.default.match(
    cacheKey(c.req.url, beijingDate(yesterday)),
  );
  if (previous) {
    return buildImageResponse(
      previous.body,
      previous.headers.get("content-type") ?? "image/jpeg",
      clientMaxAge,
    );
  }

  return c.json({ error: "wallpaper unavailable" }, 502);
});
