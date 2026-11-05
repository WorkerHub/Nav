import { describe, expect, it, vi } from "vitest";
import { searchIcons, slugify, type IconIndexEntry } from "@/lib/icon-search";

describe("slugify", () => {
  it("小写 + 非字母数字转连字符 + 去首尾连字符", () => {
    expect(slugify("Jellyfin")).toBe("jellyfin");
    expect(slugify("Actual Budget")).toBe("actual-budget");
    expect(slugify("  Plex  ")).toBe("plex");
    expect(slugify(".ENV")).toBe("env");
    expect(slugify("哔哩哔哩")).toBe("");
  });
});

describe("searchIcons", () => {
  const index: IconIndexEntry[] = [
    {
      slug: "jellyfin",
      name: "Jellyfin",
      aliases: [],
      source: "dashboard",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg",
      format: "svg",
    },
    {
      slug: "plex",
      name: "Plex",
      aliases: ["plex media server"],
      source: "dashboard",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/plex.svg",
      format: "svg",
    },
    {
      slug: "github",
      name: "GitHub",
      aliases: [],
      source: "simple",
      url: "https://cdn.simpleicons.org/github",
      format: "svg",
    },
    {
      slug: "github",
      name: "GitHub",
      aliases: [],
      source: "dashboard",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/github.svg",
      format: "svg",
    },
    {
      slug: "note",
      name: "Note",
      aliases: [],
      source: "simple",
      url: "https://cdn.simpleicons.org/note",
      format: "svg",
    },
    {
      slug: "notebook",
      name: "Notebook",
      aliases: [],
      source: "dashboard",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/notebook.svg",
      format: "svg",
    },
  ];

  it("按 slug 命中", () => {
    const r = searchIcons(index, "jellyfin");
    expect(r.map((x) => x.slug)).toContain("jellyfin");
  });

  it("按 alias 命中（服务全名 → 短 slug）", () => {
    const r = searchIcons(index, "plex media");
    expect(r[0]?.slug).toBe("plex");
  });

  it("同 slug 跨源时按 source 优先级排序（dashboard > selfhst > simple）", () => {
    const r = searchIcons(index, "github");
    expect(r[0]?.source).toBe("dashboard");
    expect(r.some((x) => x.source === "simple")).toBe(true);
  });

  it("先按匹配分再按 source：精确命中的 simple 排在仅前缀命中的 dashboard 之前", () => {
    const r = searchIcons(index, "note");
    expect(r[0]?.slug).toBe("note");
    expect(r[0]?.source).toBe("simple");
  });

  it("空查询与中文标题返回空", () => {
    expect(searchIcons(index, "")).toEqual([]);
    expect(searchIcons(index, "哔哩哔哩")).toEqual([]);
  });
});

describe("loadIconIndex", () => {
  it("加载失败不缓存，下次调用重试", async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    const { loadIconIndex } = await import("@/lib/icon-search");

    await expect(loadIconIndex()).rejects.toThrow("icon index 500");
    await expect(loadIconIndex()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
