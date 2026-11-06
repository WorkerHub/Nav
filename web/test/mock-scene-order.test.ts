import { beforeEach, describe, expect, it } from "vitest";
import { mockDb } from "@/lib/mockDb";

/**
 * dev mock 的分类 sort_order 必须与真实后端 + 前端新建口径一致：
 * 分类的 sort_order 是**场景内**序号。mock 以前用全表分类数当默认值，
 * 会把「新分类落库为 0、插到场景首项之后」的真实行为盖住。
 */

beforeEach(() => {
  localStorage.clear();
});

describe("mockDb：分类 sortOrder 按场景追加", () => {
  it("省略 sortOrder：该场景当前最大 + 1（不是全表分类数）", async () => {
    const all = await mockDb.adminListAll();
    const defaultScene = all.scenes.find((scene) => scene.isDefault);
    if (!defaultScene) throw new Error("mock 应带默认场景");

    const work = await mockDb.createScene({ name: "工作" });
    const first = await mockDb.createCategory({
      name: "运维",
      sceneId: work.id,
    });
    const second = await mockDb.createCategory({
      name: "发布",
      sceneId: work.id,
    });
    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);

    const defaultMax = Math.max(
      -1,
      ...all.categories
        .filter((category) => category.sceneId === defaultScene.id)
        .map((category) => category.sortOrder),
    );
    const appended = await mockDb.createCategory({
      name: "新分类",
      sceneId: defaultScene.id,
    });
    // 默认场景已有的分类数/序号不会被新场景的分类干扰
    expect(appended.sortOrder).toBe(defaultMax + 1);
  });

  it("显式 sortOrder（前端新建会带场景末尾序号）以传入值为准", async () => {
    const all = await mockDb.adminListAll();
    const scene = all.scenes[0];
    const created = await mockDb.createCategory({
      name: "指定的分类",
      sceneId: scene.id,
      sortOrder: 42,
    });
    expect(created.sortOrder).toBe(42);
  });
});
