import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultScene,
  filterByScene,
  resolveAdminScene,
  resolvePublicScene,
  SCENE_PREFERENCE_KEY,
  useScenePreferenceStore,
} from "@/lib/scene-preference";
import type { Scene, Visibility } from "@/lib/types";

const scene = (
  id: string,
  name: string,
  sortOrder: number,
  isDefault = false,
  visibility: Visibility = "public",
): Scene => ({ id, name, icon: null, sortOrder, isDefault, visibility });

/** 默认场景「通用」不是第一段：验证解析不按位置/名字猜默认 */
const scenes: Scene[] = [
  scene("s_work", "工作", 0),
  scene("s_default", "通用", 1, true),
  scene("s_life", "生活", 2),
];

beforeEach(() => {
  localStorage.clear();
  useScenePreferenceStore.setState({ raw: null });
});

describe("resolvePublicScene：前台偏好回落默认场景（不再有「全部」）", () => {
  it("没选过 / 存量值是已废弃的 all：回落默认场景", () => {
    expect(resolvePublicScene(null, scenes)).toBe("s_default");
    expect(resolvePublicScene("all", scenes)).toBe("s_default");
  });

  it("命中场景 id：用它（含默认场景，同等成段）", () => {
    expect(resolvePublicScene("s_work", scenes)).toBe("s_work");
    expect(resolvePublicScene("s_default", scenes)).toBe("s_default");
  });

  it("场景已被删除（偏好里的 id 不在列表里）：回落默认场景，且不写回偏好", () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "s_gone");
    expect(resolvePublicScene("s_gone", scenes)).toBe("s_default");
    // 纯函数：回落结果不落盘，键里还保留原值（场景恢复后偏好自然回来）
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_gone");
  });

  it("偏好指向私有场景、未登录时它不在可用列表里：回落公开的默认场景", () => {
    // /api/public 只下发公开场景；登录时的私有偏好不能把未登录页带空。
    const publicScenes = scenes.filter((s) => s.visibility === "public");
    expect(resolvePublicScene("s_private", publicScenes)).toBe("s_default");
  });

  it("没有默认标记（防御）：退化为第一个可用场景", () => {
    const noDefault = [scene("s_a", "甲", 0), scene("s_b", "乙", 1)];
    expect(resolvePublicScene("s_gone", noDefault)).toBe("s_a");
  });

  it("没有场景（旧后端 / 老缓存）：null（不做场景过滤）", () => {
    expect(resolvePublicScene("s_work", [])).toBeNull();
    expect(resolvePublicScene(null, [])).toBeNull();
  });
});

describe("resolveAdminScene：后台偏好与前台同一套回落", () => {
  it("没有场景：null（后台保持现状平铺，不渲染胶囊）", () => {
    expect(resolveAdminScene("s_work", [])).toBeNull();
  });

  it("没选过 / 存量值是 all：默认场景（isDefault 优先，不按位置或名字猜）", () => {
    expect(resolveAdminScene(null, scenes)).toBe("s_default");
    expect(resolveAdminScene("all", scenes)).toBe("s_default");
  });

  it("命中场景 id：用它", () => {
    expect(resolveAdminScene("s_life", scenes)).toBe("s_life");
  });

  it("场景已被删除：回落默认场景", () => {
    expect(resolveAdminScene("s_gone", scenes)).toBe("s_default");
  });

  it("列表里没有 isDefault 标记（防御）：退化为第一个场景", () => {
    const noDefault = [scene("s_a", "甲", 0), scene("s_b", "乙", 1)];
    expect(defaultScene(noDefault)?.id).toBe("s_a");
    expect(resolveAdminScene("s_gone", noDefault)).toBe("s_a");
  });
});

describe("filterByScene：只做单场景显示过滤，保持 DTO 顺序", () => {
  const categories = [
    { id: "c1", sceneId: "s_work" },
    { id: "c2", sceneId: "s_default" },
    { id: "c3", sceneId: "s_work" },
  ];

  it("具体场景：只留该场景，相对顺序与 DTO 一致", () => {
    expect(filterByScene(categories, "s_work").map((c) => c.id)).toEqual([
      "c1",
      "c3",
    ]);
    expect(filterByScene(categories, "s_default").map((c) => c.id)).toEqual([
      "c2",
    ]);
  });

  it("返回新数组，不改入参", () => {
    const result = filterByScene(categories, "s_work");
    expect(result).not.toBe(categories);
    expect(categories).toHaveLength(3);
  });
});

describe("useScenePreferenceStore：本机偏好（nav.scene）", () => {
  it("setRaw 写回 localStorage 并同步 state", () => {
    useScenePreferenceStore.getState().setRaw("s_work");
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_work");
    expect(useScenePreferenceStore.getState().raw).toBe("s_work");
  });

  it("手改/外部写入带首尾空白的值：写盘与 state 都归一为 trim 后的值", () => {
    useScenePreferenceStore.getState().setRaw("  s_work  ");
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_work");
    expect(useScenePreferenceStore.getState().raw).toBe("s_work");
  });

  it("空串（ToggleGroup 取消选中）被忽略：不写盘也不改 state", () => {
    useScenePreferenceStore.getState().setRaw("s_work");
    useScenePreferenceStore.getState().setRaw("");
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_work");
    expect(useScenePreferenceStore.getState().raw).toBe("s_work");
  });

  it("localStorage 不可用（隐私模式 / 被禁用）时只在内存里生效，不抛错", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() =>
      useScenePreferenceStore.getState().setRaw("s_life"),
    ).not.toThrow();
    expect(useScenePreferenceStore.getState().raw).toBe("s_life");
  });

  it("模块加载时（初始化）读取 localStorage 里的偏好", async () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "s_life");
    vi.resetModules();
    const fresh = await import("@/lib/scene-preference");
    expect(fresh.useScenePreferenceStore.getState().raw).toBe("s_life");
    // 复位，避免影响后续用例
    localStorage.clear();
  });

  it("模块加载时读到带空白的值也会 trim（能命中场景）", async () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "  s_life  ");
    vi.resetModules();
    const fresh = await import("@/lib/scene-preference");
    expect(fresh.useScenePreferenceStore.getState().raw).toBe("s_life");
    expect(
      fresh.resolvePublicScene(
        fresh.useScenePreferenceStore.getState().raw,
        scenes,
      ),
    ).toBe("s_life");
    localStorage.clear();
  });

  it("多标签同步：收到 storage 事件即更新（不写回）", () => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: SCENE_PREFERENCE_KEY,
        newValue: "s_work",
      }),
    );
    expect(useScenePreferenceStore.getState().raw).toBe("s_work");

    // 另一个标签页写入的值同样归一（手改带空白也能命中）
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: SCENE_PREFERENCE_KEY,
        newValue: "  s_life  ",
      }),
    );
    expect(useScenePreferenceStore.getState().raw).toBe("s_life");

    // 空值 / 其它键被清空（localStorage.clear()）→ 视为没存过
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: SCENE_PREFERENCE_KEY,
        newValue: null,
      }),
    );
    expect(useScenePreferenceStore.getState().raw).toBeNull();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "nav.visitor-theme",
        newValue: "dark",
      }),
    );
    expect(useScenePreferenceStore.getState().raw).toBeNull();
  });
});
