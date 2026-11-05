/**
 * 图标库静态索引的加载与本地搜索。
 *
 * 索引由 scripts/generate-icon-index.mjs 在构建期生成，作为静态资产
 * /icon-index.json 发布；仅后台图标选择器需要时惰性加载，不进主 bundle。
 */

export type IconSource = "dashboard" | "selfhst" | "simple";

/** 图标文件格式（构建期已解析，用于前端打 SVG 角标等）。 */
export type IconFormat = "svg" | "png" | "webp";

export interface IconIndexEntry {
  slug: string;
  name: string;
  aliases: string[];
  source: IconSource;
  /** 已解析的 CDN 地址（构建期 svg > png > webp 降级）。 */
  url: string;
  /** 该 url 实际指向的文件格式（Simple Icons 的 url 无 .svg 后缀但仍是 svg）。 */
  format: IconFormat;
}

/** source 排序优先级（候选排序：Dashboard Icons > selfh.st > Simple Icons）。 */
const SOURCE_ORDER: Record<IconSource, number> = {
  dashboard: 0,
  selfhst: 1,
  simple: 2,
};

/** slugify 归一：小写、非字母数字转连字符、去首尾连字符。 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let indexPromise: Promise<IconIndexEntry[]> | null = null;

/** 惰性加载索引并模块级缓存；失败不缓存（重置后下次调用重试），由调用方决定降级。 */
export function loadIconIndex(): Promise<IconIndexEntry[]> {
  if (!indexPromise) {
    indexPromise = fetch("/icon-index.json")
      .then((res) => {
        if (!res.ok) throw new Error(`icon index ${res.status}`);
        return res.json() as Promise<IconIndexEntry[]>;
      })
      .catch((err) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

/**
 * 在索引里按 query 本地搜索，返回按 source 优先级 + 匹配度排序的候选。
 * query 经 slugify 归一后与 slug / name / aliases 比对。
 */
export function searchIcons(
  index: IconIndexEntry[],
  query: string,
  limit = 50,
): IconIndexEntry[] {
  const q = slugify(query);
  if (!q) return [];

  const scored: { entry: IconIndexEntry; score: number }[] = [];
  for (const entry of index) {
    const score = matchScore(
      q,
      slugify(entry.slug),
      slugify(entry.name),
      entry.aliases.map(slugify).filter(Boolean),
    );
    if (score >= 0) scored.push({ entry, score });
  }

  // 先按匹配分（精确 > 前缀 > 包含），再按 source 优先级，避免单源吃满 limit 截断别源的精确命中。
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const bySource =
      SOURCE_ORDER[a.entry.source] - SOURCE_ORDER[b.entry.source];
    if (bySource !== 0) return bySource;
    return a.entry.name.localeCompare(b.entry.name);
  });

  return scored.slice(0, limit).map((x) => x.entry);
}

/** 返回匹配分（越小越靠前）；-1 表示不匹配。 */
function matchScore(
  q: string,
  slug: string,
  name: string,
  aliases: string[],
): number {
  if (slug === q) return 0;
  if (slug.startsWith(q)) return 1;
  if (name === q || aliases.includes(q)) return 2;
  if (slug.includes(q)) return 3;
  if (name.includes(q) || aliases.some((a) => a.includes(q))) return 4;
  // token 前缀命中（如 "actual budget" → q "actual"）
  const tokens = [name, ...aliases]
    .flatMap((s) => s.split("-"))
    .filter(Boolean);
  if (tokens.some((t) => t.startsWith(q))) return 5;
  return -1;
}
