import type { LinkStyle, SiteSettings } from "@/lib/types";

/**
 * 链接样式（站点设置 `linkStyle`，冻结契约 #23）的唯一取值来源：
 * 公共页解析与后台「站点设置」控件共用，避免两处各写一份枚举。
 *
 * 契约：枚举 `classic | compact | wide`，缺省 `classic`。后端未落地该键、
 * 或浏览器里是旧缓存（DTO 无此字段）时，`resolveLinkStyle` 一律回落 classic ——
 * 即与改动前的呈现完全一致。
 */
export const LINK_STYLE_OPTIONS: readonly LinkStyle[] = [
  "classic",
  "compact",
  "wide",
];

/** 控件里的可读名称（同时说明形态，免得住客只看「经典」猜不出长什么样）。 */
export const LINK_STYLE_LABELS: Record<LinkStyle, string> = {
  classic: "经典（图标上、名称下）",
  compact: "紧凑（横排单行，无卡片底）",
  wide: "宽卡片（图标 + 名称与域名）",
};

/** 站点设置 → 生效样式：只认契约里的两个非默认值，其余（含缺失/脏值）回落 classic。 */
export function resolveLinkStyle(settings?: SiteSettings | null): LinkStyle {
  const value = settings?.linkStyle;
  return value === "compact" || value === "wide" ? value : "classic";
}
