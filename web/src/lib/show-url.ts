import type { SiteSettings } from "@/lib/types";

/**
 * 「显示网址」开关（站点设置 `showUrl`）的唯一取值来源：公共页与后台设置控件共用。
 *
 * 契约：默认开（保持改动前的呈现）。只有**显式 false** 才隐藏网址行；
 * 后端该键未落地、或浏览器里是旧缓存（DTO 无此字段）时一律按开 —— 与 `linkStyle`
 * 的读侧兜底同一口径。开关只作用于普通模式（见 components/link-grid.tsx）；
 * 首页编辑模式恒显示网址（编辑场景要核对地址）。
 */
export function resolveShowUrl(settings?: SiteSettings | null): boolean {
  return settings?.showUrl !== false;
}
