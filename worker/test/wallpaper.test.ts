import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { wallpaperRoutes } from "../src/routes/wallpaper";

const BING_API =
  "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN";
const IMAGE_PATH =
  "/th?id=OHR.Test_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp";
const UHD_URL = `https://www.bing.com/th?id=OHR.Test_UHD.jpg&rf=LaDigue_1920x1080.jpg&pid=hp`;
const ORIG_URL = `https://www.bing.com${IMAGE_PATH}`;

/** 极简 Cache 替身：只实现端点用到的 match / put。 */
class MemoryCache {
  map = new Map<string, Response>();
  async match(key: string): Promise<Response | undefined> {
    return this.map.get(key);
  }
  async put(key: string, res: Response): Promise<void> {
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function imageResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "image/jpeg" },
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

  const todayKey = () => `bing-wallpaper:${beijingDate(new Date())}`;
  const yesterdayKey = () =>
    `bing-wallpaper:${beijingDate(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    )}`;

  beforeEach(() => {
    cache = new MemoryCache();
    vi.stubGlobal("caches", { default: cache });
    app = makeApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("当天缓存命中：不再回源，直接返回缓存响应", async () => {
    cache.map.set(todayKey(), imageResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
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
  });

  it("全链路失败（无缓存、回源失败）：返回 502 JSON", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/wallpaper/today");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "wallpaper unavailable" });
  });
});
