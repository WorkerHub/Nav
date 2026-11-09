import { describe, expect, it } from "vitest";
import {
  TILE_JIGGLE_CLASS,
  tileJiggleStyle,
} from "@/components/home-edit-board";

/**
 * 编辑模式砖块抖动的相位/周期（home-edit-board.tsx 的 `tileJiggleStyle`）。
 *
 * 规格：每块砖的相位/周期要错开（不得整齐划一同相位摆动），但同一块砖必须稳定
 * —— 用 id 的散列而不是 Math.random，重渲染才不会把动画拽回起点。
 */

/** 与实现同口径的六个 key：三个链接 id + 三块「+」砖（含空分类那块） */
const KEYS = ["l1", "l2", "l3", "add:c-dev", "add:c-empty", "add:c-work"];

/** `-180ms` → 180（毫秒数，延迟本身取负） */
function delayMs(style: { animationDelay?: string | number }): number {
  const raw = String(style.animationDelay);
  expect(raw.startsWith("-")).toBe(true);
  expect(raw.endsWith("ms")).toBe(true);
  return Number(raw.slice(1, -2));
}

describe("tileJiggleStyle：每块砖的抖动相位与周期", () => {
  it("同一个 key 每次算出来都一样（重渲染不重启动画）", () => {
    for (const key of KEYS) {
      expect(tileJiggleStyle(key)).toEqual(tileJiggleStyle(key));
    }
  });

  it("延迟是负值、落在 0–399ms；时长只取 160 / 180 / 200 三档", () => {
    for (const key of KEYS) {
      const style = tileJiggleStyle(key);
      const delay = delayMs(style);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(400);
      expect(["160ms", "180ms", "200ms"]).toContain(
        String(style.animationDuration),
      );
    }
  });

  it("六块砖的相位错开：延迟去重后至少三个值", () => {
    const delays = new Set(KEYS.map((key) => delayMs(tileJiggleStyle(key))));
    expect(delays.size).toBeGreaterThanOrEqual(3);
  });

  it("工具类是完整字面量（Tailwind 只扫字面量）", () => {
    expect(TILE_JIGGLE_CLASS).toBe("animate-nav-tile-jiggle");
  });
});
