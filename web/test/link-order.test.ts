import { describe, expect, it } from "vitest";
import { buildMoveIds } from "@/lib/link-order";

/**
 * 首页拖动的全局顺序重建（#28 冻结契约）：落点 = linkId 在 ids 里的下标，
 * ids 必须覆盖全部链接（含其它分类），组内次序只由 sortOrder 相对大小决定。
 */

function link(id: string, categoryId: string, sortOrder: number) {
  return { id, categoryId, sortOrder };
}

const links = [
  link("l1", "c1", 0),
  link("l2", "c2", 1),
  link("l3", "c1", 2),
  link("l4", "c2", 3),
];

describe("buildMoveIds：链接拖动的全局顺序重建", () => {
  it("跨分类落到某个砖之后：插在它后面，不是目标分类末尾", () => {
    expect(buildMoveIds(links, "l1", "c2", "l2")).toEqual([
      "l2",
      "l1",
      "l3",
      "l4",
    ]);
  });

  it("跨分类落到目标分类首位（afterId 为 null）：插到目标分类第一个砖之前", () => {
    expect(buildMoveIds(links, "l4", "c1", null)).toEqual([
      "l4",
      "l1",
      "l2",
      "l3",
    ]);
  });

  it("拖进空分类：组内唯一一项，追加到全表末尾", () => {
    expect(buildMoveIds(links, "l1", "c-empty", null)).toEqual([
      "l2",
      "l3",
      "l4",
      "l1",
    ]);
  });

  it("同分类内换位：其余链接相对次序不变", () => {
    expect(buildMoveIds(links, "l2", "c2", "l4")).toEqual([
      "l1",
      "l3",
      "l4",
      "l2",
    ]);
    expect(buildMoveIds(links, "l4", "c2", "l1")).toEqual([
      "l1",
      "l4",
      "l2",
      "l3",
    ]);
  });

  it("陈旧的 afterId（不属于目标分类 / 已被删）回落为「目标分类首位」", () => {
    expect(buildMoveIds(links, "l1", "c1", "l2")).toEqual([
      "l2",
      "l1",
      "l3",
      "l4",
    ]);
    expect(buildMoveIds(links, "l4", "c1", "gone")).toEqual([
      "l4",
      "l1",
      "l2",
      "l3",
    ]);
  });

  it("输入顺序无关：先按 sortOrder 排序再重建", () => {
    const shuffled = [
      link("l4", "c2", 3),
      link("l2", "c2", 1),
      link("l1", "c1", 0),
      link("l3", "c1", 2),
    ];
    expect(buildMoveIds(shuffled, "l3", "c2", "l2")).toEqual([
      "l1",
      "l2",
      "l3",
      "l4",
    ]);
  });
});
