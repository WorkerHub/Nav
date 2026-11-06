import { create } from "zustand";
import type { Scene } from "@/lib/types";

/**
 * 场景本机偏好（冻结契约 #16 §七，规格 v1.1 §3.4）。
 *
 * 口径：
 *  - 前后台共用同一个 localStorage 键（`nav.scene`），值只有两种：`"all"` 或场景 id。
 *  - 切换场景**只做前端显示过滤**：服务端（/api/public、/api/private、/api/admin/*）
 *    始终返回全量，切场景不发请求。
 *  - 兜底解析是纯函数（resolvePublicScene / resolveAdminScene）：偏好指向已被删除的场景时
 *    前台回落「全部」、后台回落默认场景；**回落结果不写回 localStorage**（键里保留原值，
 *    场景恢复后偏好自然回来；也让「删场景后另一个标签页还停在旧偏好」不会互相覆盖）。
 *  - 登出不清空：这是本机显示偏好，与登录态无关。
 *  - 读写一律 try/catch：隐私模式 / localStorage 被禁用时只在本次会话内存里生效。
 */

/** 本机偏好的 localStorage 键（前后台共用） */
export const SCENE_PREFERENCE_KEY = "nav.scene";

/** 「全部」哨兵值：前台第一段；后台不提供（后台永远停在某个具体场景） */
export const ALL_SCENES = "all";

/** 读本机偏好：没存过 / 空串 / localStorage 不可用 → null（= 从未选过） */
function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeRaw(window.localStorage.getItem(SCENE_PREFERENCE_KEY));
  } catch {
    return null;
  }
}

/**
 * localStorage 里的值归一：空串（手改 / 旧版本写入）当没存过；首尾空白直接去掉
 * （手改或外部写入的 `" s_work "` 也要能命中场景，否则会写进一个永远匹配不到的 id）。
 */
function normalizeRaw(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed === "" ? null : trimmed;
}

interface ScenePreferenceState {
  /** 原始偏好（`"all"` / 场景 id / null）；不做回落，回落由 resolve* 纯函数负责 */
  raw: string | null;
  /** 写入偏好：空串（ToggleGroup 取消选中）忽略；localStorage 不可用时仍更新内存值 */
  setRaw: (raw: string) => void;
}

export const useScenePreferenceStore = create<ScenePreferenceState>((set) => ({
  // 模块加载时同步读入：首帧就能按上次选的场景渲染，不会先闪一下「全部」
  raw: readRaw(),
  setRaw: (raw) => {
    const next = normalizeRaw(raw);
    if (!next) return;
    try {
      window.localStorage.setItem(SCENE_PREFERENCE_KEY, next);
    } catch {
      // 隐私模式 / 被禁用：偏好只在本次会话的内存里生效
    }
    set({ raw: next });
  },
}));

/**
 * 多标签同步：另一个标签页改了 `nav.scene`，这里跟着更新（不写回、不发请求）。
 * `event.key === null` 是 `localStorage.clear()`，视为「没存过」。
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== SCENE_PREFERENCE_KEY) return;
    const next = event.key === null ? null : normalizeRaw(event.newValue);
    useScenePreferenceStore.setState({ raw: next });
  });
}

/** 默认场景：`isDefault` 优先，否则按 DTO 顺序取第一个；没有场景时为 null */
export function defaultScene(scenes: readonly Scene[]): Scene | null {
  return scenes.find((scene) => scene.isDefault) ?? scenes[0] ?? null;
}

/**
 * 前台生效场景：偏好命中某个场景就用它，否则（没选过 / 选的是「全部」/ 场景已被删）
 * 回落 `"all"`。纯函数，不写回偏好。
 */
export function resolvePublicScene(
  raw: string | null,
  scenes: readonly Scene[],
): string {
  if (raw && raw !== ALL_SCENES && scenes.some((s) => s.id === raw)) {
    return raw;
  }
  return ALL_SCENES;
}

/**
 * 后台生效场景：偏好命中某个场景就用它，否则回落默认场景（`isDefault` 优先）。
 * 没有场景（旧后端 / 老缓存）时返回 null —— 此时分类/链接面板按现状平铺、不渲染胶囊。
 */
export function resolveAdminScene(
  raw: string | null,
  scenes: readonly Scene[],
): string | null {
  if (scenes.length === 0) return null;
  if (raw && raw !== ALL_SCENES && scenes.some((scene) => scene.id === raw)) {
    return raw;
  }
  return defaultScene(scenes)?.id ?? null;
}

/**
 * 按场景过滤（保持 DTO 顺序）：`"all"` 原样返回全部，否则只留该场景的分类。
 * 只用于分类这类带 `sceneId` 的实体 —— 链接的场景由所属分类唯一决定，经分类 id 过滤。
 */
export function filterByScene<T extends { sceneId: string }>(
  items: readonly T[],
  sceneId: string,
): T[] {
  if (sceneId === ALL_SCENES) return [...items];
  return items.filter((item) => item.sceneId === sceneId);
}

/**
 * 「全部」视图的本地显示顺序：先按所属场景的顺序（`scenes[]` 的 `sortOrder`），
 * 再按分类自身的 `sortOrder`。
 *
 * 为什么需要：分类的 `sort_order` 是**场景内**序号，服务端全量列表仍按
 * `sort_order, created_at` 排，直接渲染会出现 A0/B0/A1/B1 交错（契约的「保持 DTO
 * 顺序」只对单一场景成立）。按场景分组排序后，默认场景（`sort_order` 最小）的现有
 * 分类保持原顺序在前，新场景依次追加；只排序、**不加场景分段标题**（仍是「现状平铺」）。
 *
 * 未知场景（旧数据 / 悬空 id）排在最后；排序稳定，同序项保持 DTO 顺序。
 * 没有场景（旧后端 / 老缓存）时原样返回，保持「按现状平铺」。
 */
export function sortCategoriesByScene<
  T extends { sceneId: string; sortOrder: number },
>(items: readonly T[], scenes: readonly Scene[]): T[] {
  if (scenes.length === 0) return [...items];
  const sceneSortOrder = new Map(
    scenes.map((scene) => [scene.id, scene.sortOrder]),
  );
  return [...items].sort((a, b) => {
    const aScene = sceneSortOrder.get(a.sceneId) ?? Number.POSITIVE_INFINITY;
    const bScene = sceneSortOrder.get(b.sceneId) ?? Number.POSITIVE_INFINITY;
    if (aScene !== bScene) return aScene - bScene;
    return a.sortOrder - b.sortOrder;
  });
}
