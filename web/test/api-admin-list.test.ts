import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * adminListAll 的真实链路（非 dev mock）：五个实体并行拉取，场景端点是后加能力。
 * 旧后端（未上 schema_v2 / 场景路由）对 /api/admin/scenes 返回 404 时只退化「场景维度」，
 * 其余错误（500 / 网络）照常抛出。
 */

async function loadApi() {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  return import("@/lib/api");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const settings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

const scene = {
  id: "scene_default",
  name: "通用",
  icon: null,
  sortOrder: 0,
  isDefault: true,
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
};

/** 按路径返回：场景端点用传入的 (status, body) 控制，其余正常返回 */
function stubAdminFetch(scenes: Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/admin/scenes") return scenes;
    if (url === "/api/admin/categories") return json({ categories: [] });
    if (url === "/api/admin/links") return json({ links: [] });
    if (url === "/api/admin/search-engines") return json({ searchEngines: [] });
    if (url === "/api/admin/settings") return json(settings);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("adminListAll：场景端点可用", () => {
  it("正常返回五片数据（含 scenes）", async () => {
    const fetchMock = stubAdminFetch(json({ scenes: [scene] }));
    const { adminListAll } = await loadApi();

    const data = await adminListAll();

    expect(data.scenes).toEqual([scene]);
    expect(data.settings).toEqual(settings);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("adminListAll：旧后端没有场景端点（404）", () => {
  it("只退化场景维度（scenes=[]），其余数据照常返回", async () => {
    stubAdminFetch(json({ error: "not found" }, 404));
    const { adminListAll } = await loadApi();

    const data = await adminListAll();

    expect(data.scenes).toEqual([]);
    expect(data.categories).toEqual([]);
    expect(data.links).toEqual([]);
    expect(data.searchEngines).toEqual([]);
    expect(data.settings).toEqual(settings);
  });
});

describe("adminListAll：场景端点真实故障", () => {
  it("500 照常抛出（不把真实故障伪装成「没有场景」）", async () => {
    stubAdminFetch(json({ error: "boom" }, 500));
    const { adminListAll, ApiError } = await loadApi();

    await expect(adminListAll()).rejects.toBeInstanceOf(ApiError);
  });
});
