/**
 * 图标策略（design-system/nav/MASTER.md §1.4）：手动指定的图标优先，其次本站图标端点
 * `/api/icon`（worker 端解析目标站图标并缓存），两档都失败回退按域名哈希着色的首字圆。
 */

/** 本站图标端点（契约：`GET /api/icon?url=<encodeURIComponent 后的绝对 http(s) URL>`） */
const SITE_ICON_ENDPOINT = "/api/icon";

/** 图标候选优先级：手动 icon_url > 本站 /api/icon（由 <SiteIcon> 依次回退） */
export function faviconCandidates(
  url: string,
  iconUrl?: string | null,
): string[] {
  const out: string[] = [];
  if (iconUrl) out.push(iconUrl);
  try {
    const { protocol } = new URL(url);
    // 端点只接受绝对 http(s) URL：畸形值与非 http(s) 不发请求，直接走首字圆
    if (protocol === "http:" || protocol === "https:") {
      out.push(`${SITE_ICON_ENDPOINT}?url=${encodeURIComponent(url)}`);
    }
  } catch {
    /* malformed url → 首字圆 */
  }
  return out;
}

/** 8 色安全调色板（MASTER.md §3.3，均可承载白字） */
export const INITIAL_PALETTE = [
  "#2563EB",
  "#7C3AED",
  "#0891B2",
  "#059669",
  "#D97706",
  "#DC2626",
  "#DB2777",
  "#475569",
];

/** 域名哈希 → 调色板索引 */
export function hashColor(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return INITIAL_PALETTE[h % INITIAL_PALETTE.length];
}

/** 首字：域名或标题首字符 */
export function initialOf(title: string, url: string): string {
  const source = title.trim() || safeHost(url);
  return source.slice(0, 1).toUpperCase() || "?";
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
