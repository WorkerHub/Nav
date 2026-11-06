import * as React from "react";
import { FadeIn } from "@/components/glass";
import { CategorySection } from "@/components/link-grid";
import { LoginDialog } from "@/components/login-dialog";
import { PublicDock } from "@/components/public-dock";
import { SearchBar } from "@/components/search-bar";
import { SiteClock } from "@/components/site-clock";
import { WallpaperBackground } from "@/components/wallpaper-background";
import { resolveLinkStyle } from "@/lib/link-style";
import { useAuthenticated, useNavStore } from "@/lib/nav-store";
import {
  filterByScene,
  resolvePublicScene,
  useScenePreferenceStore,
} from "@/lib/scene-preference";

/**
 * 公开页（/）：背景图 + 顶部居中时钟块（站点标题/Logo + 时间）+ 毛玻璃搜索框
 * + 「我的导航」图标网格 + 登录后的私有区。**没有顶栏**（2026-11-06 移除）：
 * 场景胶囊与登录态操作都在右下角的固定坞里（`PublicDock`）。
 *
 * 场景（与分类正交）：胶囊在坞的上部、竖向排列，选中值来自本机偏好 `nav.scene`，
 * 切换只过滤前端已拿到的数据、不发请求。胶囊只列当前视角的 `scenes`（未登录只有
 * 公开场景、登录全量），组件内不做可见性判断 —— 两层取与由数据层完成。
 *
 * 链接呈现形态由站点设置 `linkStyle` 决定（缺省 classic），由数据层解析后传给
 * 分类区块，公共页与访客都无法在这里改。
 *
 * 安全口径：未登录时私有区完全不渲染 —— privateData 未加载时组件树里没有私有区块，
 * 数据请求也只发 /api/public（未登录不请求 /api/private）。
 *
 * 登录态是 store 里的三态（pending/authenticated/anonymous）：探活未回时坞里不渲染
 * 任何登录态按钮（不闪「登录」），探活通过后由 store 恢复登录并拉取私有区。
 */
export function PublicPage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const {
    publicData,
    privateData,
    authStatus,
    loadPublic,
    loadPrivate,
    logout,
    setLoginPrompt,
  } = useNavStore();
  const authenticated = useAuthenticated();
  // 本机场景偏好（前后台共用）：只影响显示过滤，不写服务端
  const scenePreference = useScenePreferenceStore((s) => s.raw);
  const setScenePreference = useScenePreferenceStore((s) => s.setRaw);

  React.useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  // 登录后才拉取私有区（未登录不请求 /api/private，401 时 store 内部处理弹登录）
  React.useEffect(() => {
    if (authenticated) void loadPrivate();
  }, [authenticated, loadPrivate]);

  // 契约：/api/private 返回与 /api/public 同结构的全量数据（公开+私有）。
  // 登录后直接以 privateData.categories 作为全量列表，不再拼接 public/private。
  // privateData 未回时先用 publicData 顶上，避免探活/登录后空白一帧。
  const siteData = (authenticated && privateData) || publicData;
  const settings = siteData?.settings;
  const categories = siteData?.categories ?? [];
  // 当前视角的场景全集：未登录只有公开场景、登录全量（数据层过滤，组件不再判断）。
  // 旧后端 / 浏览器旧缓存没有 scenes：按「无场景概念」平铺展示，不渲染胶囊。
  const scenes = siteData?.scenes ?? [];
  // 偏好命中可用场景就用它，否则回落默认场景；没有场景时 null（不做场景过滤）。
  // 本机偏好若指向私有场景，未登录时它不在 scenes 里 → 自然落回公开的默认场景。
  const activeScene = resolvePublicScene(scenePreference, scenes);
  const visibleCategories = activeScene
    ? filterByScene(categories, activeScene)
    : categories;
  // 链接呈现形态（站点设置 linkStyle，缺省 classic；后端无该键时同样回落 classic）
  const linkStyle = resolveLinkStyle(settings);

  // 私有标识：/api/private 的分类 DTO 不含 visibility，用「全量里有、公开列表里没有」推导私有分类。
  const publicIds = new Set(publicData?.categories.map((c) => c.id) ?? []);
  const privateIds = new Set(
    categories.filter((c) => !publicIds.has(c.id)).map((c) => c.id),
  );

  return (
    <div className="relative min-h-screen">
      {/* 背景层（与后台共用同一份实现）：全屏背景图 + 阅读性罩层 */}
      <WallpaperBackground settings={settings} />

      {/*
        正文：时钟块 → 搜索 → 分类区块。
        底部留白 pb-80（320px）大于右下角坞的最大高度（场景组封顶 128 + 间距 8 +
        按钮组 92 = 228px）：滚到页面底部时最后一行链接完整露出，不会被固定坞盖住。
      */}
      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-80 sm:px-8">
        <FadeIn className="pt-10 sm:pt-16">
          <SiteClock
            siteTitle={settings?.siteTitle ?? "我的导航"}
            logoUrl={settings?.logoUrl}
          />
        </FadeIn>

        {/* 搜索区：搜索逻辑（引擎切换、/ 聚焦、#22 的 refer 口径）原样复用 */}
        <FadeIn>
          {siteData && (
            <SearchBar
              engines={siteData.searchEngines}
              openInNewTab={siteData.settings.searchNewTab ?? true}
            />
          )}
        </FadeIn>

        {/* 导航区：分类区块；场景切换在右下角坞里，不占用页面区 */}
        <div className="flex flex-col gap-10">
          {visibleCategories.map((category, i) => (
            <FadeIn key={category.id} delay={Math.min(i * 0.05, 0.3)}>
              <CategorySection
                category={category}
                privateZone={privateIds.has(category.id)}
                linkStyle={linkStyle}
              />
            </FadeIn>
          ))}
        </div>
      </main>

      {/* 右下角固定坞：上部场景胶囊、下部主题与登录态操作 */}
      <PublicDock
        scenes={scenes}
        activeScene={activeScene}
        onSceneChange={setScenePreference}
        authStatus={authStatus}
        onOpenAdmin={onOpenAdmin}
        onLogin={() => setLoginPrompt(true)}
        onLogout={() => void logout()}
      />

      <LoginDialog />
    </div>
  );
}
