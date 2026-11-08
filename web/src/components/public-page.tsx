import * as React from "react";
import { toast } from "sonner";
import { LinkEditDialog } from "@/components/admin/link-edit-dialog";
import { FadeIn } from "@/components/glass";
import { HomeEditBoard } from "@/components/home-edit-board";
import { CategorySection } from "@/components/link-grid";
import { LoginDialog } from "@/components/login-dialog";
import { PublicDock } from "@/components/public-dock";
import { SearchBar } from "@/components/search-bar";
import { SiteClock } from "@/components/site-clock";
import { WallpaperBackground } from "@/components/wallpaper-background";
import { resolveColumns } from "@/lib/grid-columns";
import { resolveLinkStyle } from "@/lib/link-style";
import { resolveShowUrl } from "@/lib/show-url";
import { useAuthenticated, useNavStore } from "@/lib/nav-store";
import {
  filterByScene,
  resolvePublicScene,
  useScenePreferenceStore,
} from "@/lib/scene-preference";

/**
 * 公开页（/）：背景图 + 顶部居中时钟块（站点标题/Logo + 时间）+ 毛玻璃搜索框
 * + 「我的导航」图标网格 + 登录后的私有区。**没有顶栏**（2026-11-06 移除）：
 * 场景图标与登录态操作都在右下角的固定图标坞里（`PublicDock`）。
 *
 * 场景（与分类正交）：场景图标在坞的上部、竖向排列（单图标宽），选中值来自本机偏好
 * `nav.scene`，切换只过滤前端已拿到的数据、不发请求。图标只列当前视角的 `scenes`
 * （未登录只有公开场景、登录全量，组件内不再判断）—— 两层取与由数据层完成。
 *
 * 链接呈现形态由站点设置 `linkStyle` 决定（缺省 classic），由数据层解析后传给
 * 分类区块，公共页与访客都无法在这里改。
 *
 * 首页编辑模式（登录态专属，纯前端本地状态）：坞里的铅笔把页面切成
 * `HomeEditBoard`（拖动排序/分组、✕ 延迟删除、单击砖编辑、分类末尾「+」砖新建），
 * 退出/刷新/Esc/切场景/输入搜索都回到正常模式；编辑模式里砖不再跳转。
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
    adminData,
    authStatus,
    editMode,
    loadPublic,
    loadPrivate,
    logout,
    setLoginPrompt,
    enterEditMode,
    exitEditMode,
    moveLinkOnHome,
    removeLinkOnHome,
    applySavedLink,
    createLinkOnHome,
  } = useNavStore();
  const authenticated = useAuthenticated();
  // 本机场景偏好（前后台共用）：只影响显示过滤，不写服务端
  const scenePreference = useScenePreferenceStore((s) => s.raw);
  const setScenePreference = useScenePreferenceStore((s) => s.setRaw);
  // 搜索框内容只用于「编辑模式的进出门槛」，搜索本身仍由 SearchBar 自己持有
  const [searchQuery, setSearchQuery] = React.useState("");
  const [editingLinkId, setEditingLinkId] = React.useState<string | null>(null);
  // 分类末尾「+」砖新建：非 null 时弹窗处于新建态，所属分类预选它
  const [creatingCategoryId, setCreatingCategoryId] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  // 登录后才拉取私有区（未登录不请求 /api/private，401 时 store 内部处理弹登录）
  React.useEffect(() => {
    if (authenticated) void loadPrivate();
  }, [authenticated, loadPrivate]);

  // 页面卸载（跳后台 / 关页面前的路由变化）：退出编辑模式，待落库删除立即落库
  React.useEffect(() => {
    return () => {
      useNavStore.getState().exitEditMode();
    };
  }, []);

  // Esc 退出编辑模式。链接弹窗（编辑态 / 新建态）打开时 Esc 归弹窗：Radix 在同一次
  // keydown 里先把弹窗关掉，React 的 state 可能已经清空、而窗口级的这个监听器最后才跑，
  // 所以光看 state 不够 —— 事件目标仍在弹窗里就不再当成「退出编辑」。
  React.useEffect(() => {
    if (!editMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editingLinkId || creatingCategoryId) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"]'))
        return;
      exitEditMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode, editingLinkId, creatingCategoryId, exitEditMode]);

  // 契约：/api/private 返回与 /api/public 同结构的全量数据（公开+私有）。
  // 登录后直接以 privateData.categories 作为全量列表，不再拼接 public/private。
  // privateData 未回时先用 publicData 顶上，避免探活/登录后空白一帧。
  const siteData = (authenticated && privateData) || publicData;
  const settings = siteData?.settings;
  const categories = siteData?.categories ?? [];
  // 当前视角的场景全集：未登录只有公开场景、登录全量（数据层过滤，组件不再判断）。
  // 旧后端 / 浏览器旧缓存没有 scenes：按「无场景概念」平铺展示，不渲染场景图标。
  const scenes = siteData?.scenes ?? [];
  // 偏好命中可用场景就用它，否则回落默认场景；没有场景时 null（不做场景过滤）。
  // 本机偏好若指向私有场景，未登录时它不在 scenes 里 → 自然落回公开的默认场景。
  const activeScene = resolvePublicScene(scenePreference, scenes);
  const visibleCategories = activeScene
    ? filterByScene(categories, activeScene)
    : categories;
  // 链接呈现形态（站点设置 linkStyle，缺省 classic；后端无该键时同样回落 classic）
  const linkStyle = resolveLinkStyle(settings);
  // 是否显示网址（站点设置 showUrl，缺省开）：只影响普通模式，编辑模式恒显示
  const showUrl = resolveShowUrl(settings);
  // classic 档的成块列数（站点设置 columns，1–12；0/未配置 → 默认 8）：桌面按这个
  // 数成块、整块居中，窄屏放不下整块时一行自然少放几块；compact / wide 不使用
  // 该值（由 linkGridLayout 忽略）
  const columns = resolveColumns(settings?.columns);

  // 私有标识：/api/private 的分类 DTO 不含 visibility，用「全量里有、公开列表里没有」推导私有分类。
  const publicIds = new Set(publicData?.categories.map((c) => c.id) ?? []);
  const privateIds = new Set(
    categories.filter((c) => !publicIds.has(c.id)).map((c) => c.id),
  );

  // 编辑弹窗与后台一致：只列当前场景的分类（按场景内顺序），链接取后台 DTO
  const dialogCategories = React.useMemo(() => {
    const all = adminData?.categories ?? [];
    return (activeScene ? filterByScene(all, activeScene) : all)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [adminData, activeScene]);
  const editingLink =
    (editingLinkId &&
      adminData?.links.find((link) => link.id === editingLinkId)) ||
    null;

  const handleQueryChange = (query: string) => {
    setSearchQuery(query);
    // 编辑中输入搜索 → 自动退出编辑模式（搜索框照常可继续输入/提交）
    if (editMode && query.trim() !== "") exitEditMode();
  };

  const handleToggleEdit = () => {
    if (editMode) {
      exitEditMode();
      return;
    }
    // 搜索有内容时按钮无动作（规格 §3.2）
    if (searchQuery.trim() !== "") return;
    void enterEditMode().then((ok) => {
      if (!ok) toast.error("进入编辑模式失败，请稍后重试");
    });
  };

  const handleSceneChange = (sceneId: string) => {
    // 编辑中切场景：先退出编辑（顺带落库待删），再切显示场景
    if (editMode) exitEditMode();
    setScenePreference(sceneId);
  };

  const handleMoveLink = React.useCallback(
    (linkId: string, categoryId: string, afterId: string | null) => {
      void moveLinkOnHome({ linkId, categoryId, afterId }).catch(() => {
        toast.error("保存失败，已恢复原顺序");
      });
    },
    [moveLinkOnHome],
  );

  return (
    <div className="relative min-h-screen">
      {/* 背景层（与后台共用同一份实现）：全屏背景图 + 阅读性罩层 */}
      <WallpaperBackground settings={settings} />

      {/*
        正文：时钟块 → 搜索 → 分类区块。
        底部留白 pb-96（384px）大于右下角坞的最大高度（场景组封顶 160 + 间距 8 +
        按钮组「编辑/主题/后台/退出」188 = 356px，再加坞离底边的 16px）：滚到页面
        底部时最后一行链接完整露出，不会被固定坞盖住。
      */}
      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-96 sm:px-8">
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
              onQueryChange={handleQueryChange}
            />
          )}
        </FadeIn>

        {/* 导航区：正常模式是外跳链接；编辑模式是 dnd-kit 拖动看板 */}
        {editMode ? (
          <HomeEditBoard
            categories={visibleCategories}
            linkStyle={linkStyle}
            columns={columns}
            privateCategories={privateIds}
            onEditLink={setEditingLinkId}
            onRemoveLink={removeLinkOnHome}
            onMoveLink={handleMoveLink}
            onAddLink={setCreatingCategoryId}
          />
        ) : (
          <div className="flex flex-col gap-10">
            {visibleCategories.map((category, i) => (
              <FadeIn key={category.id} delay={Math.min(i * 0.05, 0.3)}>
                <CategorySection
                  category={category}
                  privateZone={privateIds.has(category.id)}
                  linkStyle={linkStyle}
                  showUrl={showUrl}
                  columns={columns}
                />
              </FadeIn>
            ))}
          </div>
        )}
      </main>

      {/* 右下角固定坞：上部场景图标、下部主题与登录态图标按钮 */}
      <PublicDock
        scenes={scenes}
        activeScene={activeScene}
        onSceneChange={handleSceneChange}
        authStatus={authStatus}
        editMode={editMode}
        onToggleEdit={handleToggleEdit}
        onOpenAdmin={onOpenAdmin}
        onLogin={() => setLoginPrompt(true)}
        onLogout={() => void logout()}
      />

      {/*
        首页编辑模式的链接弹窗：点砖是编辑（复用后台同一份实现）、分类末尾「+」砖是新建
        （所属分类预选该分类，排序号由 store 定为分类末尾）。两态共用一个弹窗与一条
        「保存后并入 store」的路径。
      */}
      <LinkEditDialog
        open={!!editingLink || !!creatingCategoryId}
        link={editingLink}
        categories={dialogCategories}
        defaultCategoryId={creatingCategoryId ?? undefined}
        onCreateLink={createLinkOnHome}
        onClose={() => {
          setEditingLinkId(null);
          setCreatingCategoryId(null);
        }}
        onSaved={(link) => {
          applySavedLink(link);
          setEditingLinkId(null);
          setCreatingCategoryId(null);
        }}
      />

      <LoginDialog />
    </div>
  );
}
