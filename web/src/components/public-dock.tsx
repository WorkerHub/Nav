import { LogIn, LogOut, Settings } from "lucide-react";
import { SceneSwitcher } from "@/components/scene-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { AuthStatus } from "@/lib/nav-store";
import type { Scene } from "@/lib/types";

/**
 * 公共页右下角固定坞（顶栏移除后的场景与操作入口）。
 *
 * 竖排图标轨道，宽度正好一个图标按钮（`w-11`，44px），不再有横向文字：
 *  - 上部：场景图标按钮组（数据源由调用方给：未登录只有公开场景、登录全量；
 *    组件内不做可见性判断）。没设图标的场景由 SceneSwitcher 回退「首字圆」；
 *    场景多时在**组内**纵向滚动（`max-h-40`），不把坞撑高。
 *  - 下部：主题三态 + 登录态三态，各一个图标按钮：探活未回（pending）时不渲染
 *    任何登录态按钮（不闪「登录」），已登录是「后台」+「退出」，未登录是「登录」
 *    （仍由公共页弹 LoginDialog）。
 *
 * 布局：`fixed` 贴右下、层级高于页面内容；外层不吃点击（`pointer-events-none`），
 * 只有两块面板各自 `pointer-events-auto` —— 坞占的那片透明区域不会挡住下面的链接。
 * 窄屏（390px 级）也只有 44px 宽，不会盖住正文。
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
  // 只有一个场景（仅「通用」）时不显示场景图标：与场景维度上线前的公共页一致
  const showScenes = scenes.length > 1 && activeScene !== null;

  return (
    <aside
      aria-label="场景与快捷操作"
      className="pointer-events-none fixed right-4 bottom-4 z-30 flex w-11 flex-col items-center gap-2"
    >
      {showScenes && (
        <SceneSwitcher
          scenes={scenes}
          value={activeScene}
          onValueChange={onSceneChange}
          ariaLabel="切换场景"
          iconOnly
          className="no-scrollbar pointer-events-auto max-h-40 w-full flex-col flex-nowrap gap-1 overflow-y-auto"
          itemClassName="size-11 rounded-full p-0"
        />
      )}
      <div className="pointer-events-auto flex w-full flex-col gap-1">
        {/* 主题是访客本机偏好，不受登录态影响：pending 期间照常可点 */}
        <ThemeToggle className="size-11 rounded-full" />
        {authStatus === "pending" ? null : authStatus === "authenticated" ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="glass size-11 rounded-full text-foreground hover:text-foreground"
              aria-label="后台"
              title="后台"
              onClick={onOpenAdmin}
            >
              <Settings className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="glass size-11 rounded-full text-foreground hover:text-foreground"
              aria-label="退出"
              title="退出"
              onClick={onLogout}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
          </>
        ) : (
          // 低调登录入口：仍走 LoginDialog（弹窗由公共页持有）
          <Button
            variant="ghost"
            size="icon"
            className="glass size-11 rounded-full text-foreground hover:text-foreground"
            aria-label="登录"
            title="登录"
            onClick={onLogin}
          >
            <LogIn className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </aside>
  );
}
