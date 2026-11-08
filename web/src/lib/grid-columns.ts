/**
 * 「经典」链接排布的唯一取值来源：公共页解析与后台「站点设置」控件共用，避免两处
 * 各写一份兜底，也避免砖宽、间距两套数字漂移。
 *
 * 契约（规格已定版）：`columns` 是 classic 档的**每行卡片上限**，`1–12`；`0` 表示
 * 未配置，后端原样存储/返回（见 docs/api-contract.md）。因此读侧把 `0`、缺失、
 * 非整数与越界一律归一到 `DEFAULT_COLUMNS`（= 改动前的默认梯度，8 块）—— 与
 * `resolveLinkStyle` / `resolveShowUrl` 同一套兜底口径。
 *
 * 排布模型（规格已定版）：砖是**固定边长方砖**，不再被容器拉伸；一行实际放几块
 * 由容器宽度与砖间距自然决定，`columns` 只是上限。多出来的宽度先进砖间距（封顶
 * `CLASSIC_MAX_GAP`），再进行组两侧留白；每行（含不满的最后一行）整段居中 ——
 * 这些全部由 link-grid.tsx 的 flex 容器 + 下面这组数字表达，没有 JS 测量。
 *
 * compact / wide 两档不使用该值（各自排法固定，见 components/link-grid.tsx）。
 */

/** 未配置（`columns: 0`）时 classic 的每行上限：与改动前的默认梯度一致。 */
export const DEFAULT_COLUMNS = 8;

/**
 * classic 方砖的边长（px，宽高相同）：取改动前默认梯度下桌面砖的实际宽度 ——
 * 桌面内容宽 1216px（`main` 的 max-w-7xl 1280 减 sm:px-8 的 64），8 列、间距 12px
 * 时 (1216 − 7×12) / 8 = 141.5。取整到 142 会让 8 块加 7 个 12px 间距超过 1216，
 * 默认 8 列就会掉成 7 块一行，所以保留这半像素。
 */
export const CLASSIC_TILE_SIZE = 141.5;

/** classic 砖之间的最小水平间距（px）：与改动前的 gap-3 一致。 */
export const CLASSIC_MIN_GAP = 12;

/**
 * classic 砖之间的最大水平间距（px）：`columns` 设小时多出来的宽度先撑到这里，
 * 再多的才进整行两侧留白（避免 2–3 块时砖被推到页面两个边缘）。
 */
export const CLASSIC_MAX_GAP = 48;

export interface ClassicGridMetrics {
  /** 生效的每行上限（1–12） */
  columns: number;
  /** 行组（一排砖）的最大宽度（px）：容器再宽也不超过它，多出的对称留在两侧 */
  maxWidth: number;
  /** CSS `column-gap`：12px → 48px 之间随容器宽度自然增长（上限由 maxWidth 兜住） */
  columnGap: string;
}

/**
 * classic 的排布参数：每行上限 → 行组最大宽度与水平间距。
 *
 * `columnGap` 的算式让「刚好放满 n 块」时行组正好等于容器宽度；容器更窄时它落到
 * 最小值 12px，flex 换行自然少放几块（`columns` 只是上限）；行组达到 `maxWidth`
 * 后间距封顶 48px，剩余宽度由容器 `mx-auto` 变成两侧对称留白。
 *
 * `n = 1` 时没有「砖之间」，除数会是 0，直接给固定 12px。
 */
export function classicGridMetrics(
  columns?: number | null,
): ClassicGridMetrics {
  const n = resolveColumns(columns);
  const maxWidth = n * CLASSIC_TILE_SIZE + (n - 1) * CLASSIC_MAX_GAP;
  const columnGap =
    n > 1
      ? `clamp(${CLASSIC_MIN_GAP}px, calc((100% - ${
          n * CLASSIC_TILE_SIZE
        }px) / ${n - 1}), ${CLASSIC_MAX_GAP}px)`
      : `${CLASSIC_MIN_GAP}px`;
  return { columns: n, maxWidth, columnGap };
}

/** 站点设置 → 生效的 classic 每行上限（1–12；0/缺失/脏值一律回默认值）。 */
export function resolveColumns(columns?: number | null): number {
  if (typeof columns !== "number" || !Number.isInteger(columns)) {
    return DEFAULT_COLUMNS;
  }
  return columns >= 1 && columns <= 12 ? columns : DEFAULT_COLUMNS;
}
