/**
 * 「经典」链接网格的桌面列数（站点设置 `columns`）的唯一取值来源：公共页解析与
 * 后台「站点设置」控件共用，避免两处各写一份兜底。
 *
 * 契约（规格已定版）：`columns` 是 classic 档的**桌面端**列数，`1–12` 设几是几；
 * `0` 表示未配置，后端原样存储/返回（见 docs/api-contract.md）。因此读侧把
 * `0`、缺失、非整数与越界一律归一到 `DEFAULT_COLUMNS`（= 改动前的默认梯度，
 * 桌面 8 列）—— 与 `resolveLinkStyle` / `resolveShowUrl` 同一套兜底口径。
 *
 * compact / wide 两档不使用该值（各自排法固定，见 components/link-grid.tsx）。
 */

/** 未配置（`columns: 0`）时 classic 的桌面列数：与改动前的默认梯度一致。 */
export const DEFAULT_COLUMNS = 8;

/** 站点设置 → 生效的 classic 桌面列数（1–12；0/缺失/脏值一律回默认值）。 */
export function resolveColumns(columns?: number | null): number {
  if (typeof columns !== "number" || !Number.isInteger(columns)) {
    return DEFAULT_COLUMNS;
  }
  return columns >= 1 && columns <= 12 ? columns : DEFAULT_COLUMNS;
}
