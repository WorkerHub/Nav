import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nextThemeMode, type ThemeMode, useThemeCycle } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** 三档各自的图标（Lucide）：跟随系统用显示器、浅色用太阳、深色用月亮。 */
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

const THEME_LABELS: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

/**
 * 主题切换按钮（访客本机偏好，公共页与后台共用同一个组件）：
 * 点击按「跟随系统 → 浅色 → 深色 → 跟随系统」循环，选择写入本机 localStorage，
 * 只影响这个浏览器。没有本机偏好时默认跟随系统，所以按钮任何时刻都可渲染可点。
 *
 * 两种形态：缺省是顶栏用的纯图标按钮（`icon-sm`）；`showLabel` 时是带档位文案的
 * 行（公共页右下角坞里用），`aria-label`/`title` 与点击循环两种形态完全一致。
 */
export function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { mode, cycle } = useThemeCycle();

  const Icon = THEME_ICONS[mode];
  const label = `主题：${THEME_LABELS[mode]}，点击切换为${THEME_LABELS[nextThemeMode(mode)]}`;

  return (
    <Button
      variant="ghost"
      size={showLabel ? "sm" : "icon-sm"}
      className={cn(
        "glass text-foreground hover:text-foreground",
        showLabel && "w-full justify-start gap-1.5",
        className,
      )}
      aria-label={label}
      title={label}
      onClick={cycle}
    >
      <Icon className="size-4" aria-hidden="true" />
      {showLabel && <span className="truncate">{THEME_LABELS[mode]}</span>}
    </Button>
  );
}
