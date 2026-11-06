import { LogIn, LogOut, Settings } from "lucide-react";
import { SceneSwitcher } from "@/components/scene-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { AuthStatus } from "@/lib/nav-store";
import type { Scene } from "@/lib/types";

/**
 * 公共页右下角固定坞（顶栏移除后的场景与操作入口）：
 *
 *  - 上部：场景胶囊组（数据源由调用方给：未登录只有公开场景、登录全量；
 *    组件内不做可见性判断）。场景多时在**组内**纵向滚动，不把坞撑高。
 *  - 下部：按钮组纵向排列 —— 主题三态切换，然后是登录态三态的操作：
 *    探活未回（pending）时不渲染任何登录态按钮（不闪「登录」），
 *    已登录是「后台」+「退出」，未登录是「登录」（仍由公共页弹 LoginDialog）。
 *
 * 布局：`fixed` 贴右下、层级高于页面内容；外层不吃点击（`pointer-events-none`），
 * 只有两块面板各自 `pointer-events-auto` —— 坞占的那片透明区域不会挡住下面的链接。
 * 宽度固定 `w-28`，窄屏（390px 级）贴右下角也不会溢出视口。
 */
export function PublicDock({
  scenes,
  activeScene,
  onSceneChange,
  authStatus,
  onOpenAdmin,
  onLogin,
  onLogout,
}: {
  scenes: readonly Scene[];
  /** 当前生效的场景 id；没有场景概念时为 null */
  activeScene: string | null;
  onSceneChange: (sceneId: string) => void;
  authStatus: AuthStatus;
  onOpenAdmin: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  // 只有一个场景（仅「通用」）时不显示胶囊：与场景维度上线前的公共页一致
  const showScenes = scenes.length > 1 && activeScene !== null;

  return (
    <aside
      aria-label="场景与快捷操作"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex flex-col items-end gap-2 px-4"
    >
      {showScenes && (
        <SceneSwitcher
          scenes={scenes}
          value={activeScene}
          onValueChange={onSceneChange}
          ariaLabel="切换场景"
          className="no-scrollbar pointer-events-auto max-h-32 w-28 flex-col flex-nowrap overflow-y-auto"
          itemClassName="w-full min-w-0 justify-start"
        />
      )}
      <div className="pointer-events-auto flex w-28 flex-col gap-1">
        {/* 主题是访客本机偏好，不受登录态影响：pending 期间照常可点 */}
        <ThemeToggle showLabel className="w-full justify-start" />
        {authStatus === "pending" ? null : authStatus === "authenticated" ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="glass w-full justify-start gap-1.5 text-foreground hover:text-foreground"
              onClick={onOpenAdmin}
            >
              <Settings className="size-4" aria-hidden="true" />
              后台
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="glass w-full justify-start gap-1.5 text-foreground hover:text-foreground"
              onClick={onLogout}
            >
              <LogOut className="size-4" aria-hidden="true" />
              退出
            </Button>
          </>
        ) : (
          // 低调登录入口：仍走 LoginDialog（弹窗由公共页持有）
          <Button
            variant="ghost"
            size="sm"
            className="glass w-full justify-start gap-1.5 text-foreground hover:text-foreground"
            onClick={onLogin}
          >
            <LogIn className="size-4" aria-hidden="true" />
            登录
          </Button>
        )}
      </div>
    </aside>
  );
}
