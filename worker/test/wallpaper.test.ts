import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { wallpaperRoutes } from "../src/routes/wallpaper";

const BING_API =
  "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN";
const IMAGE_PATH =
  "/th?id=OHR.Test_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp";
const UHD_URL = `https://www.bing.com/th?id=OHR.Test_UHD.jpg&rf=LaDigue_1920x1080.jpg&pid=hp`;
const ORIG_URL = `https://www.bing.com${IMAGE_PATH}`;
/** `app.request("/api/wallpaper/today")` 下 Hono 的 c.req.url origin。 */
const ORIGIN = "http://localhost";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Cache API 替身：与 workerd 一致，**拒绝非 fully-qualified URL 的键**。
 * 裸串（如 `bing-wallpaper:…`）在 workerd 里会抛 “Invalid URL”，这里同步抛，
 * 避免测试替身再次掩盖 P0。
 */
function assertAbsoluteUrl(key: string): void {
  const url = new URL(key); // 相对路径/裸串在这里就会抛
  if (!url.host) {
    throw new TypeError(
      "Invalid URL. Cache API keys must be fully-qualified, valid URLs.",
    );
  }
}

class MemoryCache {
  map = new Map<string, Response>();
  async match(key: string): Promise<Response | undefined> {
    assertAbsoluteUrl(key);
    return this.map.get(key);
  }
  async put(key: string, res: Response): Promise<void> {
    assertAbsoluteUrl(key);
    this.map.set(key, res);
  }
}

function beijingDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function maxAgeOf(res: Response): number {
  const m = res.headers.get("cache-control")?.match(/max-age=(\d+)/);
  return m ? Number(m[1]) : Number.NaN;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

/** 带 Bing 上游内部头的图片响应，用于验证响应头不透传。 */
function imageResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": "3",
      "x-msedge-ref": "Ref A: deadbeef",
      nel: '{"report_to":"network-errors"}',
      "report-to": '{"group":"network-errors"}',
    },
  });
}

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/wallpaper", wallpaperRoutes);
  return app;
}

describe("GET /api/wallpaper/today", () => {
  let cache: MemoryCache;
  let app: Hono;

  // 缓存键与端点一致：同源绝对 URL（workerd 只接受 fully-qualified URL）。
  const todayKey = () =>
    `${ORIGIN}/__cache/bing-wallpaper/${beijingDate(new Date())}`;
  const yesterdayKey = () =>
    `${ORIGIN}/__cache/bing-wallpaper/${beijingDate(
      new Date(Date.now() - DAY_SECONDS * 1000),
    )}`;

  beforeEach(() => {
    cache = new MemoryCache();
    vi.stubGlobal("caches", { default: cache });
    app = makeApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("当天缓存命中：不再回源，直接返回缓存响应（客户端 TTL 重写为到次日零点）", async () => {
    cache.map.set(todayKey(), imageResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    // 命中缓存也不能把「缓存条目 TTL（2 天）」透给浏览器。
    expect(maxAgeOf(res)).toBeLessThanOrEqual(DAY_SECONDS);
  });

  it("当天首次请求回源并写入缓存，第二次请求命中缓存不回源", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: IMAGE_PATH }] }))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const first = await app.request("/api/wallpaper/today");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(first.headers.get("cache-control")).toMatch(/^public, max-age=\d+$/);
    expect(fetchMock).toHaveBeenCalledWith(BING_API);
    expect(fetchMock).toHaveBeenCalledWith(UHD_URL);
    expect(cache.map.has(todayKey())).toBe(true);

    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await app.request("/api/wallpaper/today");
    expect(second.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("缓存条目 TTL 与客户端 TTL 分层：缓存存到次日之后，客户端只到次日零点", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: IMAGE_PATH }] }))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");
    const cached = cache.map.get(todayKey());
    expect(cached).toBeDefined();

    const clientMaxAge = maxAgeOf(res);
    const cacheMaxAge = maxAgeOf(cached as Response);
    // 客户端 ≤ 到次日零点（≤ 24h）；缓存条目至少多一天，才能撑到次日「昨日回退」。
    expect(clientMaxAge).toBeLessThanOrEqual(DAY_SECONDS);
    expect(cacheMaxAge).toBeGreaterThanOrEqual(clientMaxAge + DAY_SECONDS);
  });

  it("不透传 Bing 上游响应头：只保留 content-type / cache-control", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: IMAGE_PATH }] }))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/^public, max-age=\d+$/);
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("x-msedge-ref")).toBeNull();
    expect(res.headers.get("nel")).toBeNull();
    expect(res.headers.get("report-to")).toBeNull();
  });

  it("UHD 回源失败时降回接口原图", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: IMAGE_PATH }] }))
      .mockResolvedValueOnce(new Response("", { status: 500 })) // UHD 失败
      .mockResolvedValueOnce(imageResponse()); // 原图成功
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(UHD_URL);
    expect(fetchMock).toHaveBeenCalledWith(ORIG_URL);
  });

  it("回源失败且存在昨日缓存：返回昨日缓存图", async () => {
    cache.map.set(yesterdayKey(), imageResponse());
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    // 昨日图同样只给到次日零点的客户端 TTL。
    expect(maxAgeOf(res)).toBeLessThanOrEqual(DAY_SECONDS);
  });

  it("缓存条目已过 TTL（match 返回 miss）且回源失败：返回 502 而非抛异常", async () => {
    // 模拟条目按 max-age 被驱逐：先写入再删除，等价于 match miss。
    cache.map.set(todayKey(), imageResponse());
    cache.map.delete(todayKey());
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "wallpaper unavailable" });
  });

  it("全链路失败（无缓存、回源失败）：返回 502 JSON", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "wallpaper unavailable" });
  });
});
