#!/usr/bin/env node
/**
 * 构建期图标索引生成：从三源（Dashboard Icons / selfh.st / Simple Icons）拉取
 * 索引，压成精简条目 { slug, name, aliases[], source, url } 写入
 * web/public/icon-index.json，作为静态资产随站点发布（前端本地搜索）。
 *
 * 任一一源拉取/解析失败：不覆盖已提交的旧索引、打印告警、以退出码 0 结束，
 * 让构建继续用上一次成功生成的索引（web/public/icon-index.json 已提交进仓库）。
 * 三源全成功才整体覆盖。
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(here, "../web/public/icon-index.json");

const FETCH_TIMEOUT_MS = 30_000;

// 任一源解析出少于该条数视为「成功但退化」（如远端返回 200 + 空 JSON），
// 同样按失败处理：保留旧索引、告警、退出码 0，避免把已提交的索引覆盖成空集。
const MIN_ENTRIES_PER_SOURCE = 500;

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 三个来源：拉取地址 + 各自解析成精简条目（url 在此把 svg > png > webp 落定）。 */
const SOURCES = [
  {
    name: "dashboard-icons",
    url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json",
    parse(metadata) {
      const out = [];
      for (const [slug, meta] of Object.entries(metadata)) {
        const ext = meta.base === "png" ? "png" : "svg";
        out.push({
          slug,
          name: slug,
          aliases: meta.aliases ?? [],
          source: "dashboard",
          url: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/${ext}/${slug}.${ext}`,
          format: ext,
        });
      }
      return out;
    },
  },
  {
    name: "selfh.st",
    url: "https://cdn.jsdelivr.net/gh/selfhst/icons/index.json",
    parse(index) {
      const out = [];
      for (const item of index) {
        const slug = item.Reference;
        const ext =
          item.SVG === "Yes" ? "svg" : item.PNG === "Yes" ? "png" : "webp";
        out.push({
          slug,
          name: item.Name ?? slug,
          aliases: (item.Tags ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          source: "selfhst",
          url: `https://cdn.jsdelivr.net/gh/selfhst/icons/${ext}/${slug}.${ext}`,
          format: ext,
        });
      }
      return out;
    },
  },
  {
    name: "simple-icons",
    url: "https://cdn.jsdelivr.net/npm/simple-icons@16/data/simple-icons.json",
    parse(data) {
      return data.map((item) => ({
        slug: item.slug,
        name: item.title ?? item.slug,
        aliases: item.aliases?.aka ?? [],
        source: "simple",
        url: `https://cdn.simpleicons.org/${item.slug}`,
        format: "svg",
      }));
    },
  },
];

const entries = [];
for (const source of SOURCES) {
  try {
    const raw = await fetchJson(source.url);
    const parsed = source.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < MIN_ENTRIES_PER_SOURCE) {
      throw new Error(
        `解析结果退化（${Array.isArray(parsed) ? parsed.length : 0} 条 < ${MIN_ENTRIES_PER_SOURCE}）`,
      );
    }
    entries.push(...parsed);
    console.log(`[icon-index] ${source.name}: ${parsed.length} 条`);
  } catch (err) {
    console.error(
      `[icon-index] ${source.name} 拉取/解析失败：${err?.message ?? err}；保留上一次成功生成的索引`,
    );
    process.exit(0);
  }
}

// 按 source + slug 稳定排序，减小每次重生成的 diff 噪音。
entries.sort(
  (a, b) => a.source.localeCompare(b.source) || a.slug.localeCompare(b.slug),
);

writeFileSync(OUT_PATH, JSON.stringify(entries));
console.log(`[icon-index] 共 ${entries.length} 条 → ${OUT_PATH}`);
