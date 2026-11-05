import { describe, expect, it } from "vitest";
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
    },
    {
      slug: "plex",
      name: "Plex",
      aliases: ["plex media server"],
      source: "dashboard",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/plex.svg",
    },
    {
      slug: "github",
      name: "GitHub",
      aliases: [],
      source: "simple",
      url: "https://cdn.simpleicons.org/github",
    },
    {
      slug: "github",
      name: "GitHub",
      aliases: [],
      source: "dashboard",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/github.svg",
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

  it("空查询与中文标题返回空", () => {
    expect(searchIcons(index, "")).toEqual([]);
    expect(searchIcons(index, "哔哩哔哩")).toEqual([]);
  });
});
