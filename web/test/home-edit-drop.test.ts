import { describe, expect, it } from "vitest";
import { resolveDropOrder } from "@/components/home-edit-board";

/**
 * 松手结算（跨容器拖拽的「二次位移」回归）。
 *
 * `onDragOver` 已经把 active 插到目标砖之前，那块砖在草稿里顺延一位；dnd-kit 松手时
 * 仍可能把 over 报成那块砖。若再按同容器 arrayMove 结算，active 会多走一位（拖到目标
 * 分类首个砖时永远落不到首位）。
 */

describe("resolveDropOrder：松手结算", () => {
  it("跨分类插到某块砖之前后松手（over 仍指被顺延的那块）：保持草稿不动", () => {
    const initial = { c1: ["x", "a"], c2: ["b", "c"] };
    // onDragOver 之后：a 已从 c1 搬进 c2，插在 b 之前（b 顺延到下标 1）
    const order = { c1: ["x"], c2: ["a", "b", "c"] };

    const final = resolveDropOrder({
      order,
      initialOrder: initial,
      activeId: "a",
      overId: "b",
    });

    expect(final).toBe(order);
    expect(final.c2).toEqual(["a", "b", "c"]);
    expect(final.c1).toEqual(["x"]);
  });

  it("跨分类后松手指向更远的砖：按落点换位", () => {
    const initial = { c1: ["x", "a"], c2: ["b", "c"] };
    const order = { c1: ["x"], c2: ["a", "b", "c"] };

    const final = resolveDropOrder({
      order,
      initialOrder: initial,
      activeId: "a",
      overId: "c",
    });

    expect(final.c2).toEqual(["b", "c", "a"]);
  });

  it("跨分类后拖到分类标题行：落到该分类末尾", () => {
    const initial = { c1: ["x", "a"], c2: ["b", "c"] };
    const order = { c1: ["x"], c2: ["a", "b", "c"] };

    const final = resolveDropOrder({
      order,
      initialOrder: initial,
      activeId: "a",
      overId: "end:c2",
    });

    expect(final.c2).toEqual(["b", "c", "a"]);
  });

  it("同分类内向下换位照常结算（不被跨容器守卫挡住）", () => {
    const initial = { c1: ["a", "b", "c"] };

    const final = resolveDropOrder({
      order: initial,
      initialOrder: initial,
      activeId: "a",
      overId: "b",
    });

    expect(final.c1).toEqual(["b", "a", "c"]);
  });

  it("松手仍指向自己：顺序不变", () => {
    const initial = { c1: ["x", "a"], c2: ["b", "c"] };
    const order = { c1: ["x"], c2: ["a", "b", "c"] };

    const final = resolveDropOrder({
      order,
      initialOrder: initial,
      activeId: "a",
      overId: "a",
    });

    expect(final).toBe(order);
  });

  it("取消拖动（over 为空）：回到进入拖动前的顺序", () => {
    const initial = { c1: ["x", "a"], c2: ["b", "c"] };
    const order = { c1: ["x"], c2: ["a", "b", "c"] };

    const final = resolveDropOrder({
      order,
      initialOrder: initial,
      activeId: "a",
      overId: null,
    });

    expect(final).toBe(initial);
  });
});
