import { create } from "zustand";
import type { Scene } from "@/lib/types";

/**
 * 场景本机偏好（冻结契约 #16 §七，nav #19 §B4 前端收口）。
 *
 * 口径：
 *  - 前后台共用同一个 localStorage 键（`nav.scene`），值是场景 id。
 *  - 切换场景**只做前端显示过滤**：服务端（/api/public、/api/private、/api/admin/*）
 *    始终返回当前视角可见的全量（未登录只有公开场景），切场景不发请求。
 *  - 前台胶囊不再有「全部」聚合项（nav #19 §A2）。偏好没选过、存量值是废弃的
 *    `"all"`、或指向已被删除 / 当前视角不可见（未登录时的私有场景）的场景时，
 *    `resolvePublicScene` 一律回落到默认场景（`isDefault` 优先，不可用时取第一个
 *    可用场景）；一个场景都没有（旧后端 / 老缓存）时返回 null，表示不做场景过滤。
 *  - 兜底解析是纯函数，**回落结果不写回 localStorage**（键里保留原值，场景恢复后
 *    偏好自然回来；也让「删场景后另一个标签页还停在旧偏好」不会互相覆盖）。
 *  - 登出不清空：这是本机显示偏好，与登录态无关。
 *  - 读写一律 try/catch：隐私模式 / localStorage 被禁用时只在本次会话内存里生效。
 */

/** 本机偏好的 localStorage 键（前后台共用） */
export const SCENE_PREFERENCE_KEY = "nav.scene";

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
  /** 原始偏好（场景 id / null）；不做回落，回落由 resolve* 纯函数负责 */
  raw: string | null;
  /** 写入偏好：空串（ToggleGroup 取消选中）忽略；localStorage 不可用时仍更新内存值 */
  setRaw: (raw: string) => void;
}

export const useScenePreferenceStore = create<ScenePreferenceState>((set) => ({
  // 模块加载时同步读入：首屏就能按上次选的场景渲染，不会先闪一下默认场景
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
 * 前台生效场景：偏好命中「当前视角可用」的场景就用它，否则回落默认场景
 * （`isDefault` 优先，不可用时第一个可用场景）；没有场景时返回 null。
 *
 * 这里传入的 `scenes` 就是当前视角的场景全集 —— 未登录只有公开场景、登录全量
 * （过滤在数据层完成，组件不做可见性判断）。因此本机偏好指向私有场景时，
 * 未登录打开会自然落回某个公开场景，页面不报错、不空白。
 * 存量偏好 `"all"`（已删除的「全部」哨兵）同样匹配不到任何场景，走同一回落。
 * 纯函数，不写回偏好。
 */
export function resolvePublicScene(
  raw: string | null,
  scenes: readonly Scene[],
): string | null {
  if (scenes.length === 0) return null;
  if (raw && scenes.some((scene) => scene.id === raw)) return raw;
  return defaultScene(scenes)?.id ?? null;
}

/**
 * 后台生效场景：与前台同一套回落口径（默认场景优先）。
 * 没有场景（旧后端 / 老缓存）时返回 null —— 此时分类/链接面板按现状平铺、不渲染胶囊。
 */
export function resolveAdminScene(
  raw: string | null,
  scenes: readonly Scene[],
): string | null {
  return resolvePublicScene(raw, scenes);
}

/**
 * 按场景过滤（保持 DTO 顺序）：只留该场景的分类。
 * 只用于分类这类带 `sceneId` 的实体 —— 链接的场景由所属分类唯一决定，经分类 id 过滤。
 */
export function filterByScene<T extends { sceneId: string }>(
  items: readonly T[],
  sceneId: string,
): T[] {
  return items.filter((item) => item.sceneId === sceneId);
}
