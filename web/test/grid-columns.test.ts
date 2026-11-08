import { describe, expect, it } from "vitest";
import {
  CLASSIC_MAX_GAP,
  CLASSIC_MIN_GAP,
  CLASSIC_TILE_SIZE,
  DEFAULT_COLUMNS,
  classicGridMetrics,
  resolveColumns,
} from "@/lib/grid-columns";

/**
 * 站点设置 `columns` → classic 排布参数：
 * 1–12 原样生效（当行组列数），`0`（未配置）/缺失/非整数/越界一律回默认 8。
 */
describe("resolveColumns：columns 读侧兜底", () => {
  it("1–12 原样生效（含两端边界）", () => {
    for (const n of [1, 2, 5, 8, 11, 12]) {
      expect(resolveColumns(n)).toBe(n);
    }
  });

  it("0（未配置）回默认 8（后端原样存储 0，不代替用户决定）", () => {
    expect(resolveColumns(0)).toBe(DEFAULT_COLUMNS);
    expect(DEFAULT_COLUMNS).toBe(8);
  });

  it("缺失 / null / 非整数 / 越界一律回默认 8", () => {
    expect(resolveColumns()).toBe(DEFAULT_COLUMNS);
    expect(resolveColumns(undefined)).toBe(DEFAULT_COLUMNS);
    expect(resolveColumns(null)).toBe(DEFAULT_COLUMNS);
    expect(resolveColumns(5.5)).toBe(DEFAULT_COLUMNS);
    expect(resolveColumns(Number.NaN)).toBe(DEFAULT_COLUMNS);
    expect(resolveColumns(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COLUMNS);
    expect(resolveColumns(-1)).toBe(DEFAULT_COLUMNS);
    expect(resolveColumns(13)).toBe(DEFAULT_COLUMNS);
  });
});

/**
 * classic 的排布参数：行组最大宽度 = n×141.5 + (n−1)×48；水平间距 12→48 之间
 * 随容器宽度自然增长（n = 1 时没有砖间距，固定最小值）。
 */
describe("classicGridMetrics：固定方砖 + 间距调个数", () => {
  it("砖是固定 141.5px 方砖（当前默认 8 列在 1216px 内容宽下的实际砖宽）", () => {
    expect(CLASSIC_TILE_SIZE).toBe(141.5);
    expect(CLASSIC_MIN_GAP).toBe(12);
    expect(CLASSIC_MAX_GAP).toBe(48);
  });

  it("columns=8：行组上限 1468px（8 块 + 7 个 48px 间距），间距除数 7、被减 1132px", () => {
    const metrics = classicGridMetrics(8);
    expect(metrics.columns).toBe(8);
    expect(metrics.maxWidth).toBe(1468);
    expect(metrics.columnGap).toBe(
      "clamp(12px, calc((100% - 1132px) / 7), 48px)",
    );
  });

  it("columns=4：行组上限 710px，间距除数 3", () => {
    const metrics = classicGridMetrics(4);
    expect(metrics.maxWidth).toBe(710);
    expect(metrics.columnGap).toContain("/ 3)");
    expect(metrics.columnGap).toContain("566px");
  });

  it("columns=1：没有砖间距（除数为 0），间距取固定最小值 12px", () => {
    const metrics = classicGridMetrics(1);
    expect(metrics.maxWidth).toBe(CLASSIC_TILE_SIZE);
    expect(metrics.columnGap).toBe("12px");
  });

  it("0（未配置）/ 脏值 / 越界：与 columns=8 完全一致", () => {
    const fallback = classicGridMetrics(8);
    for (const value of [0, undefined, null, 5.5, -1, 13]) {
      expect(classicGridMetrics(value)).toEqual(fallback);
    }
  });
});
