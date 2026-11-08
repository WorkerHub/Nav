import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, resolveColumns } from "@/lib/grid-columns";

/**
 * 站点设置 `columns` → classic 桌面列数的读侧口径：
 * 1–12 原样生效（设几是几），`0`（未配置）/缺失/非整数/越界一律回默认梯度 8 列。
 */
describe("resolveColumns：columns 读侧兜底", () => {
  it("1–12 原样生效（含两端边界）", () => {
    for (const n of [1, 2, 5, 8, 11, 12]) {
      expect(resolveColumns(n)).toBe(n);
    }
  });

  it("0（未配置）回默认 8 列（后端原样存储 0，不代替用户决定）", () => {
    expect(resolveColumns(0)).toBe(DEFAULT_COLUMNS);
    expect(DEFAULT_COLUMNS).toBe(8);
  });

  it("缺失 / null / 非整数 / 越界一律回默认 8 列", () => {
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
