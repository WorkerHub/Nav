import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nextThemeMode, type ThemeMode, useThemeCycle } from "@/lib/theme";

/** 三档各自的图标（Lucide）：跟随系统用显示器、浅色用太阳、深色用月亮。 */
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

const THEME_LABELS: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

/**
 * 顶栏主题切换按钮（访客本机偏好，公共页与后台共用同一个组件）：
 * 点击按「跟随系统 → 浅色 → 深色 → 跟随系统」循环，选择写入本机 localStorage，
 * 只影响这个浏览器。没有本机偏好时默认跟随系统，所以按钮任何时刻都可渲染可点。
 */
export function ThemeToggle() {
  const { mode, cycle } = useThemeCycle();

  const Icon = THEME_ICONS[mode];
  const label = `主题：${THEME_LABELS[mode]}，点击切换为${THEME_LABELS[nextThemeMode(mode)]}`;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="glass text-foreground hover:text-foreground"
      aria-label={label}
      title={label}
      onClick={cycle}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}
