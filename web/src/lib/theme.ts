import { create } from "zustand";
import { useNavStore } from "@/lib/nav-store";
import type { SiteSettings } from "@/lib/types";

/**
 * 主题分两层：
 *  - 站点设置 `settings.theme`（后端 settings 表，经 /api/public、/api/private、
 *    /api/admin/settings 下发）是**默认值**，决定没点过切换按钮的访客看到什么；
 *  - 访客本机还可以有自己的偏好（localStorage，键见 VISITOR_THEME_KEY），只影响这一个
 *    浏览器，不改站点设置、不影响别人。
 *
 * 解析顺序：本机偏好（若有）> 站点设置。`system` 一档再用
 * `matchMedia('(prefers-color-scheme: dark)')` 解析成当前的深/浅色，并监听系统外观
 * 变化实时跟随；解析结果不落盘。
 *
 * 已确认的口径：「跟随系统」跟的是访客**自己的系统外观**，不是把控制权交回站点默认。
 * 所以访客一旦点过按钮，站点默认对他就不再生效（除非清掉本机偏好）；站点默认只决定
 * 从没点过的访客看到什么。
 *
 * 本机偏好在模块加载时同步读入 store（见 useVisitorThemeStore），所以挂载的那次
 * useLayoutEffect 就能用上它：有偏好的访客首帧就是对色，不会先亮后暗。
 */
export type ThemeMode = SiteSettings["theme"];
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

/** 合法的三档主题档位（后端 settings 表是自由文本，取到值必须先过这一步）。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * 站点设置里的主题档位（**不含**访客本机偏好）；null = 站点数据尚未加载 / 值不认识。
 *
 * 后端 settings 表本来就不带类型约束（PUT 只校验写入，存量行可以是任意字符串），
 * 所以这里先过 `isThemeMode`：脏值当「没拿到」，回落到「不猜颜色」，不让它一路流到
 * 图标表 / resolveTheme（否则 `THEME_ICONS[mode]` 会是 undefined，整页渲染直接抛错）。
 *
 * 优先级 adminData > privateData > publicData：后台刚写入的值最新；已登录刷新时
 * `bootstrapSession` 先拉 /api/private，`loadPublic` 可能还没回，取 privateData 才不
 * 会让私有界面先渲染、主题却解析不出来。
 */
export function useSiteThemeMode(): ThemeMode | null {
  const theme = useNavStore(
    (s) =>
      s.adminData?.settings.theme ??
      s.privateData?.settings.theme ??
      s.publicData?.settings.theme ??
      null,
  );
  return isThemeMode(theme) ? theme : null;
}

/** 访客本机主题偏好的 localStorage 键（键不存在 = 从未点过切换按钮）。 */
export const VISITOR_THEME_KEY = "nav.visitor-theme";

/** 三档循环顺序（顶栏按钮每点一次走一格）。 */
const THEME_CYCLE: readonly ThemeMode[] = ["system", "light", "dark"];

/**
 * 读本机偏好：没存过 / 值不合法（被人手改过）/ localStorage 不可用 → null，
 * 一律当作「没点过」，回落站点设置。
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
  /** 本机偏好；null = 从未点过（此时用站点设置） */
  mode: ThemeMode | null;
  setMode: (mode: ThemeMode) => void;
}

/**
 * 访客本机偏好（zustand）。初值在模块加载时同步读取，因此首帧绘制前就可用；
 * 每次切换都写字面三档（点回「跟随系统」写 `"system"`、不删键，因为它跟的是系统外观，
 * 而不是交回站点默认）。
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
 * 生效中的档位：本机偏好（若有）> 站点设置。
 * null 只在「没点过 且 站点数据未加载」时出现 —— 此时不猜深浅色。
 */
export function useEffectiveThemeMode(): ThemeMode | null {
  const visitorMode = useVisitorThemeStore((s) => s.mode);
  const siteMode = useSiteThemeMode();
  return visitorMode ?? siteMode;
}

/**
 * 顶栏主题按钮用：当前生效档位 + 切到下一档（写入本机偏好）。
 * 站点数据未加载且没点过时 mode 为 null，cycle 是空操作（按钮也不渲染）。
 * 循环到「跟随系统」不回退到站点默认：它跟的是访客自己的系统外观（已确认口径）。
 */
export function useThemeCycle(): {
  mode: ThemeMode | null;
  cycle: () => void;
} {
  const mode = useEffectiveThemeMode();
  const setMode = useVisitorThemeStore((s) => s.setMode);
  return {
    mode,
    cycle: () => {
      if (mode) setMode(nextThemeMode(mode));
    },
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

/** 生效中的实际主题；null 表示站点数据未加载且没有本机偏好（不要当 light 兜底渲染）。 */
export function useResolvedTheme(): ResolvedTheme | null {
  const mode = useEffectiveThemeMode();
  const systemDark = useThemeStore((s) => s.systemDark);
  return mode ? resolveTheme(mode, systemDark) : null;
}
