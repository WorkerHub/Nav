import type { TileSize } from "@/lib/types";

/**
 * 「经典」链接排布的唯一取值来源：公共页解析与后台「站点设置」控件共用，避免两处
 * 各写一份兜底，也避免砖宽、间距两套数字漂移。
 *
 * 契约（规格已定版）：`columns` 是 classic 档的**成块列数**，`1–12`；`0` 表示
 * 未配置，后端原样存储/返回（见 docs/api-contract.md）。因此读侧把 `0`、缺失、
 * 非整数与越界一律归一到 `DEFAULT_COLUMNS`（= 改动前的默认梯度，8 块）—— 与
 * `resolveLinkStyle` / `resolveTileSize` / `resolveShowUrl` 同一套兜底口径。
 *
 * 砖的边长由站点设置 `tileSize` 决定三档（`large` 141.5 / `medium` 113 / `small` 92，
 * 见 `CLASSIC_TILE_SIZES`）；砖是**正方形**（高 = 宽），`columns` 与边长一起算行组
 * 宽度与间距。
 *
 * 排布模型（规格已定版）：砖是**定边长的正方形卡片**，不再被容器拉伸。桌面按 `columns`
 * 成块：一行正好 `columns` 块，行组宽度封顶 `maxWidth`，整块水平居中；窄屏放不
 * 下整块时一行自然少放几块，块仍居中、不溢出。多出来的宽度先进砖间距（封顶
 * `CLASSIC_MAX_GAP`），再进行整块两侧的对称留白。不满一行的末行从行组左端起排
 * （与满行同列对齐）—— 那是 flex 容器的 `justify-start` 给的，不在这里；这里只
 * 算数字，没有 JS 测量。
 *
 * compact / wide 两档不使用这些值（各自排法固定，见 components/link-grid.tsx）。
 */

/** 未配置（`columns: 0`）时 classic 的成块列数：与改动前的默认梯度一致。 */
export const DEFAULT_COLUMNS = 8;

/**
 * classic 三档砖的**边长**（px，正方形：高与宽同值；成块排布与间距都按宽度算）。
 * `large` 取改动前默认梯度下桌面砖的实际宽度 —— 桌面内容宽 1216px（`main` 的
 * max-w-7xl 1280 减 sm:px-8 的 64），8 列、间距 12px 时 (1216 − 7×12) / 8 = 141.5。
 * 取整到 142 会让 8 块加 7 个 12px 间距超过 1216，默认 8 列就会掉成 7 块一行，
 * 所以保留这半像素。
 *
 * medium / small 以 141.5 × 0.8 = 113.2、141.5 × 0.65 = 91.975 为起点取整到
 * 整数像素（113 / 92），避免 1x 屏亚像素发虚；实际比例 1 : 0.7986 : 0.6502。
 *
 * 高 = 宽（正方形，用户 2026-11-09 定版）：砖内是「图标盒 + 名称一行 + 网址一行」，
 * 图标盒取边长的 46%（`CLASSIC_ICON_BOX`）、名称与网址各单行截断，密度见
 * `components/link-grid.tsx` 的 `CLASSIC_TILE_DENSITY`；三档的余量分别是
 * 6.5 / 3 / 4px（见那里的测算）。宽度仍是成块排布的唯一依据。
 */
export const CLASSIC_TILE_SIZES: Record<TileSize, number> = {
  large: 141.5,
  medium: 113,
  small: 92,
};

/**
 * 与 `CLASSIC_TILE_SIZES` 一一对应的 Tailwind 静态宽度类。
 *
 * 必须是源码里的字面量：Tailwind 只扫字面量生成 CSS，动态拼 `w-[${n}px]`
 * 会漏生成。单测会逐档校验这里与 `CLASSIC_TILE_SIZES` 同步。
 */
export const CLASSIC_TILE_WIDTH_CLASS: Record<TileSize, string> = {
  large: "w-[141.5px]",
  medium: "w-[113px]",
  small: "w-[92px]",
};

/**
 * 与 `CLASSIC_TILE_SIZES` 一一对应的 Tailwind 静态高度类（同为字面量，理由同上）。
 *
 * 砖是正方形，所以这里的数值与 `CLASSIC_TILE_WIDTH_CLASS` 完全相同 —— 两个字典
 * 都保留（宽决定成块排布、高决定卡片外形，语义不同），单测逐档校验两者相等。
 */
export const CLASSIC_TILE_HEIGHT_CLASS: Record<TileSize, string> = {
  large: "h-[141.5px]",
  medium: "h-[113px]",
  small: "h-[92px]",
};

/** 兼容既有引用：默认（large）砖边长。 */
export const CLASSIC_TILE_SIZE = CLASSIC_TILE_SIZES.large;

/** classic 砖之间的最小水平间距（px）：与改动前的 gap-3 一致。 */
export const CLASSIC_MIN_GAP = 12;

/**
 * classic 砖之间的最大水平间距（px）：`columns` 设小时多出来的宽度先撑到这里，
 * 再多的才进整行两侧留白（避免 2–3 块时砖被推到页面两个边缘）。
 */
export const CLASSIC_MAX_GAP = 48;

export interface ClassicGridMetrics {
  /** 生效的成块列数（1–12） */
  columns: number;
  /** 行组（一整块）的最大宽度（px）：容器再宽也不超过它，多出的对称留在两侧 */
  maxWidth: number;
  /** CSS `column-gap`：12px → 48px 之间随容器宽度自然增长（上限由 maxWidth 兜住） */
  columnGap: string;
}

/**
 * classic 的排布参数：成块列数 + 砖块尺寸 → 行组最大宽度与水平间距。
 *
 * `columnGap` 的算式让「刚好放满 n 块」时行组正好等于容器宽度；容器更窄时它落到
 * 最小值 12px，flex 换行自然少放几块（窄屏降每行个数，块仍居中）；行组达到
 * `maxWidth` 后间距封顶 48px，剩余宽度由容器 `mx-auto` 变成行组两侧的对称留白。
 *
 * `n = 1` 时没有「砖之间」，除数会是 0，直接给固定 12px。
 */
export function classicGridMetrics(
  columns?: number | null,
  tileSize: TileSize = "large",
): ClassicGridMetrics {
  const n = resolveColumns(columns);
  const tile = CLASSIC_TILE_SIZES[tileSize];
  const maxWidth = n * tile + (n - 1) * CLASSIC_MAX_GAP;
  const columnGap =
    n > 1
      ? `clamp(${CLASSIC_MIN_GAP}px, calc((100% - ${
          n * tile
        }px) / ${n - 1}), ${CLASSIC_MAX_GAP}px)`
      : `${CLASSIC_MIN_GAP}px`;
  return { columns: n, maxWidth, columnGap };
}

/** 站点设置 → 生效的 classic 成块列数（1–12；0/缺失/脏值一律回默认值）。 */
export function resolveColumns(columns?: number | null): number {
  if (typeof columns !== "number" || !Number.isInteger(columns)) {
    return DEFAULT_COLUMNS;
  }
  return columns >= 1 && columns <= 12 ? columns : DEFAULT_COLUMNS;
}
