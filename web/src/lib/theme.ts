import { create } from "zustand";

/**
 * 主题模型（站点级主题已删除，2026-11-05 定版）：
 *
 *  - 只有一层：**本机偏好**（localStorage，键见 VISITOR_THEME_KEY）。
 *  - 没有本机偏好时默认「跟随系统」：再按
 *    `matchMedia('(prefers-color-scheme: dark)')` 解析成当前的深/浅色，并监听系统
 *    外观变化实时跟随；解析结果不落盘。
 *  - 公共页与后台共用同一份偏好与同一套解析（同一个 ThemeToggle、同一个 Provider）。
 *
 * 已确认的口径：「跟随系统」跟的是访客**自己的系统外观**。所以点回「跟随系统」
 * 是回到系统外观，不是回到某个站点默认值（那个配置已经不存在了）。
 *
 * 本机偏好在模块加载时同步读入 store（见 useVisitorThemeStore），所以挂载的那次
 * useLayoutEffect 就能用上它：有偏好的访客首帧就是对色，不会先亮后暗。
 */
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** 当前系统外观（无 matchMedia 的环境按浅色处理） */
export function readSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/** 三档 → 实际生效的深浅色 */
export function resolveTheme(
  mode: ThemeMode,
  systemDark: boolean,
): ResolvedTheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** 合法的三档主题档位（本机偏好来自 localStorage，取到值必须先过这一步）。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

/** 访客本机主题偏好的 localStorage 键（键不存在 = 从未点过切换按钮）。 */
export const VISITOR_THEME_KEY = "nav.visitor-theme";

/** 三档循环顺序（顶栏按钮每点一次走一格）。 */
const THEME_CYCLE: readonly ThemeMode[] = ["system", "light", "dark"];

/**
 * 读本机偏好：没存过 / 值不合法（被人手改过）/ localStorage 不可用 → null，
 * 一律当作「没点过」，回落「跟随系统」。
 */
export function readVisitorTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VISITOR_THEME_KEY);
    return isThemeMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 「跟随系统 → 浅色 → 深色 → 跟随系统」 */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_CYCLE.indexOf(mode);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
}

interface VisitorThemeState {
  /** 本机偏好；null = 从未点过（此时跟随系统） */
  mode: ThemeMode | null;
  setMode: (mode: ThemeMode) => void;
}

/**
 * 访客本机偏好（zustand）。初值在模块加载时同步读取，因此首帧绘制前就可用；
 * 每次切换都写字面三档（点回「跟随系统」写 `"system"`、不删键，因为它跟的是系统外观）。
 */
export const useVisitorThemeStore = create<VisitorThemeState>((set) => ({
  mode: readVisitorTheme(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(VISITOR_THEME_KEY, mode);
    } catch {
      // 隐私模式 / 被禁用：偏好只在本次会话的内存里生效，不影响页面
    }
    set({ mode });
  },
}));

/**
 * 生效中的档位：本机偏好（若有）→ 否则「跟随系统」。永远有值 —— 主题不再依赖
 * 站点数据是否加载，所以主题按钮任何时刻都能渲染、能点。
 */
export function useEffectiveThemeMode(): ThemeMode {
  const visitorMode = useVisitorThemeStore((s) => s.mode);
  return visitorMode ?? "system";
}

/**
 * 顶栏主题按钮用：当前生效档位 + 切到下一档（写入本机偏好）。
 * 循环到「跟随系统」不回退到任何站点默认：它跟的是访客自己的系统外观。
 */
export function useThemeCycle(): {
  mode: ThemeMode;
  cycle: () => void;
} {
  const mode = useEffectiveThemeMode();
  const setMode = useVisitorThemeStore((s) => s.setMode);
  return {
    mode,
    cycle: () => setMode(nextThemeMode(mode)),
  };
}

/** 系统外观状态（系统事实，不是站点设置）。 */
interface ThemeState {
  systemDark: boolean;
  setSystemDark: (systemDark: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  systemDark: readSystemDark(),
  setSystemDark: (systemDark) =>
    set((s) => (s.systemDark === systemDark ? s : { systemDark })),
}));

/** 生效中的实际深浅色（本机偏好 ?? 跟随系统）。 */
export function useResolvedTheme(): ResolvedTheme {
  const mode = useEffectiveThemeMode();
  const systemDark = useThemeStore((s) => s.systemDark);
  return resolveTheme(mode, systemDark);
}
