import {
  ArrowDownUp,
  ArrowLeft,
  FolderTree,
  Info,
  Layers,
  Link as LinkIcon,
  LogOut,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import * as React from "react";
import { AboutPanel } from "@/components/admin/about-panel";
import { CategoryPanel, LinkPanel } from "@/components/admin/crud-panels";
import { ScenePanel } from "@/components/admin/scene-panel";
import { SecurityPanel } from "@/components/admin/security-panel";
import {
  ImportExportPanel,
  SearchEnginePanel,
  SettingsPanel,
} from "@/components/admin/settings-panels";
import { SystemPanel } from "@/components/admin/system-panel";
import { FadeIn, GlassCard } from "@/components/glass";
import { SceneSwitcher } from "@/components/scene-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WallpaperBackground } from "@/components/wallpaper-background";
import { useNavStore } from "@/lib/nav-store";
import {
  filterByScene,
  resolveAdminScene,
  useScenePreferenceStore,
} from "@/lib/scene-preference";
import type { AdminScene } from "@/lib/types";

/**
 * 后台（/#admin）：与公共页同一套设计语言 —— 壁纸背景 + 玻璃顶栏 + 毛玻璃左栏
 * + 玻璃内容卡。分区菜单用 Radix Tabs 单一根：宽屏是左栏竖排，窄屏变内容区顶部的
 * 横向滚动菜单条（同一个 TabsList，只换 orientation 与响应式类，不做抽屉）。
 *
 * 分区内容（分类 / 链接 / 场景管理 / 搜索引擎 / 站点设置 / 导入导出 /
 * 安全·两步验证 / 系统管理 / 关于）的容器换成了玻璃卡，面板组件本身的表单与业务逻辑不动。
 *
 * 后台数据由 store（useNavStore.adminData）承载，本页只负责加载与分发；
 * 安全区的数据（2FA 状态、Passkey 凭据）属会话期敏感数据，由 SecurityPanel 自行拉取，
 * 不进全局 store。
 */

/** 左栏菜单项（图标用 Lucide，与前台同一视觉家族）。 */
const ADMIN_TABS = [
  { value: "categories", label: "分类", icon: FolderTree },
  { value: "links", label: "链接", icon: LinkIcon },
  { value: "scenes", label: "场景管理", icon: Layers },
  { value: "engines", label: "搜索引擎", icon: Search },
  { value: "settings", label: "站点设置", icon: SettingsIcon },
  { value: "io", label: "导入导出", icon: ArrowDownUp },
  { value: "security", label: "安全 / 两步验证", icon: ShieldCheck },
  { value: "system", label: "系统管理", icon: Wrench },
  { value: "about", label: "关于", icon: Info },
] as const;

/** 与 Tailwind `lg` 断点保持一致：左栏竖排 ↔ 顶部横排菜单条的分界。 */
const WIDE_VIEWPORT_QUERY = "(min-width: 1024px)";

function subscribeWideViewport(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * 宽屏判定：Tabs 的 orientation 必须跟着布局走 —— Radix 用 orientation 决定方向键
 * 语义，宽屏左栏竖排时上下键切换、窄屏横排时左右键切换；只在 CSS 里假装横排会让
 * 键盘用户的方向键失效。
 */
function useWideViewport(): boolean {
  return React.useSyncExternalStore(
    subscribeWideViewport,
    () => window.matchMedia(WIDE_VIEWPORT_QUERY).matches,
    () => true,
  );
}

/** 分区内容卡：毛玻璃面 + 圆角（沿用 .glass 令牌），不做 hover 上浮。 */
function PanelCard({ children }: { children: React.ReactNode }) {
  return (
    <GlassCard hover={false} className="w-full max-w-3xl p-5 sm:p-6">
      {children}
    </GlassCard>
  );
}

/**
 * 后台场景胶囊：「分类」「链接」两分区内容卡顶部，只有场景、没有「全部」
 * （后台永远停在具体场景：新建分类/链接要带 sceneId）。与前台共用 `nav.scene`。
 * 没有场景（旧后端 / 无场景概念）时不渲染。
 */
function AdminSceneBar({
  scenes,
  sceneId,
}: {
  scenes: AdminScene[];
  sceneId: string | null;
}) {
  const setScenePreference = useScenePreferenceStore((s) => s.setRaw);
  if (!sceneId || scenes.length === 0) return null;
  return (
    <SceneSwitcher
      scenes={scenes}
      value={sceneId}
      onValueChange={setScenePreference}
      ariaLabel="选择场景"
    />
  );
}

export function AdminPage({ onBack }: { onBack: () => void }) {
  const adminData = useNavStore((s) => s.adminData);
  const loadAdmin = useNavStore((s) => s.loadAdmin);
  const logout = useNavStore((s) => s.logout);
  const wide = useWideViewport();

  React.useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  const categories = adminData?.categories ?? [];
  const links = adminData?.links ?? [];
  const scenes = adminData?.scenes ?? [];
  const engines = adminData?.searchEngines ?? [];
  const settings = adminData?.settings ?? null;

  // 场景偏好与前台共用同一个键；后台回落默认场景（不回写 localStorage）
  const scenePreference = useScenePreferenceStore((s) => s.raw);
  const activeScene = resolveAdminScene(scenePreference, scenes);
  // 分类/链接面板只看当前场景；无场景概念时保持现状（全量）
  const sceneCategories = activeScene
    ? filterByScene(categories, activeScene)
    : categories;
  // 当前场景的可见性：分类列表据此提示「场景私有，对外不可见」（两层取与）
  const activeSceneVisibility =
    scenes.find((scene) => scene.id === activeScene)?.visibility ?? "public";

  return (
    <div className="relative min-h-screen">
      {/* 背景层（与公共页共用同一份实现：壁纸来源解析 + 罩层） */}
      <WallpaperBackground settings={settings} />

      {/* 顶栏：整条毛玻璃，左侧站点标题/Logo，右侧返回首页、主题切换、退出登录 */}
      <header className="glass-bar sticky top-0 z-20">
        <FadeIn className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <h1 className="flex min-w-0 items-center font-heading text-lg font-semibold text-foreground">
            {settings?.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.siteTitle || "站点 Logo"}
                className="h-8 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <span className="min-w-0 truncate">
                {settings?.siteTitle ?? "我的导航"}
              </span>
            )}
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/*
              顶栏按钮统一用前景色（与公共页同一口径）：浅色档玻璃底近白，白字对比度不够。
              窄屏只留图标，靠 aria-label 保住可读名称。
            */}
            <Button
              variant="ghost"
              size="sm"
              className="glass gap-1.5 text-foreground hover:text-foreground"
              aria-label="返回首页"
              title="返回首页"
              onClick={onBack}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">返回首页</span>
            </Button>
            {/* 主题按钮直接复用公共页的 ThemeToggle（本机偏好，前后台同一份） */}
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className="glass gap-1.5 text-foreground hover:text-foreground"
              aria-label="退出登录"
              title="退出登录"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">退出登录</span>
            </Button>
          </div>
        </FadeIn>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {settings ? (
          <Tabs
            defaultValue="categories"
            orientation={wide ? "vertical" : "horizontal"}
            className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6"
          >
            {/* 左栏（宽屏固定宽 230px 玻璃面）/ 顶部横排滚动菜单条（窄屏） */}
            <div className="w-full lg:sticky lg:top-20 lg:w-[230px] lg:shrink-0">
              {/*
                - `bg-[var(--glass-bg)]`：shadcn TabsList 默认变体带 `bg-muted`，它在 utilities 层，
                  会盖掉 components 层 `.glass` 的半透明底（左栏就变成不透明实色块）。
                  同组冲突由 cn 的 tailwind-merge 收掉 `bg-muted`，这里只把 `.glass` 的同名令牌
                  再写一遍，不引入新颜色。
                - `justify-start`：窄屏内容比容器宽时，默认的 justify-center 会让左半截滚不到
                  （flex 居中溢出的已知行为），头几项就点不到。
                - `group-data-horizontal/tabs:h-12`：shadcn TabsList 横排默认 h-8（32px），
                  与 36px 的触发区不匹配；这里改回 48px，让玻璃条包住整颗胶囊。
                - `no-scrollbar`：横向滚动条隐藏但仍可滑（shadcn 自带的 utility）。
              */}
              <TabsList className="glass no-scrollbar flex w-full items-stretch justify-start gap-1 overflow-x-auto rounded-xl bg-[var(--glass-bg)] p-1.5 group-data-horizontal/tabs:h-12 lg:flex-col lg:overflow-visible">
                {ADMIN_TABS.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="glass-nav-trigger h-9 flex-none gap-2 px-3 lg:w-full lg:justify-start"
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="whitespace-nowrap">{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* 内容区：各分区面板放进玻璃卡 */}
            <div className="min-w-0 flex-1">
              <TabsContent value="categories">
                <PanelCard>
                  <div className="flex flex-col gap-5">
                    <AdminSceneBar scenes={scenes} sceneId={activeScene} />
                    <CategoryPanel
                      categories={sceneCategories}
                      sceneId={activeScene}
                      sceneVisibility={activeSceneVisibility}
                      onChanged={() => void loadAdmin()}
                    />
                  </div>
                </PanelCard>
              </TabsContent>

              <TabsContent value="links">
                <PanelCard>
                  <div className="flex flex-col gap-5">
                    <AdminSceneBar scenes={scenes} sceneId={activeScene} />
                    <LinkPanel
                      categories={sceneCategories}
                      links={links}
                      onChanged={() => void loadAdmin()}
                    />
                  </div>
                </PanelCard>
              </TabsContent>

              <TabsContent value="scenes">
                <PanelCard>
                  <ScenePanel
                    scenes={scenes}
                    onChanged={() => void loadAdmin()}
                  />
                </PanelCard>
              </TabsContent>

              <TabsContent value="engines">
                <PanelCard>
                  <SearchEnginePanel
                    engines={engines}
                    onChanged={() => void loadAdmin()}
                  />
                </PanelCard>
              </TabsContent>

              <TabsContent value="settings">
                <PanelCard>
                  <SettingsPanel
                    settings={settings}
                    onChanged={() => void loadAdmin()}
                  />
                </PanelCard>
              </TabsContent>

              <TabsContent value="io">
                <PanelCard>
                  <ImportExportPanel
                    categories={categories}
                    links={links}
                    engines={engines}
                    settings={settings}
                    onChanged={() => void loadAdmin()}
                  />
                </PanelCard>
              </TabsContent>

              <TabsContent value="security">
                <PanelCard>
                  <SecurityPanel />
                </PanelCard>
              </TabsContent>

              <TabsContent value="system">
                <PanelCard>
                  <SystemPanel />
                </PanelCard>
              </TabsContent>

              <TabsContent value="about">
                <PanelCard>
                  <AboutPanel />
                </PanelCard>
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <GlassCard
            hover={false}
            className="w-full max-w-3xl px-5 py-4 text-sm text-muted-foreground"
          >
            加载中…
          </GlassCard>
        )}
      </main>
    </div>
  );
}
