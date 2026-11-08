import type { SiteSettings, TileSize } from "@/lib/types";

/**
 * classic 砖块尺寸（站点设置 `tileSize`）的唯一取值来源：
 * 公共页解析与后台「站点设置」控件共用，避免两处各写一份枚举。
 *
 * 契约：枚举 `large | medium | small`，缺省 `large`（砖宽 141.5px，即 #35 定版的
 * 默认梯度砖宽）。
 * 后端未落地该键、或浏览器里是旧缓存（DTO 无此字段）时，`resolveTileSize`
 * 一律回落 `large` —— 与 `resolveLinkStyle` / `resolveShowUrl` 同一套读侧兜底。
 */
export const TILE_SIZE_OPTIONS: readonly TileSize[] = [
  "large",
  "medium",
  "small",
];

/** 控件里的可读名称（具体 px 由后台控件从 `CLASSIC_TILE_SIZES` 补上）。 */
export const TILE_SIZE_LABELS: Record<TileSize, string> = {
  large: "大",
  medium: "中",
  small: "小",
};

/** 站点设置 → 生效尺寸：只认 `medium` / `small`，其余（含缺失/脏值）回落 `large`。 */
export function resolveTileSize(settings?: SiteSettings | null): TileSize {
  const value = settings?.tileSize;
  return value === "medium" || value === "small" ? value : "large";
}
