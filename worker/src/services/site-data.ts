import type {
  AdminSceneDto,
  Category,
  Link,
  PublicCategoryDto,
  PublicLinkDto,
  Scene,
  SceneDto,
  SearchEngine,
  SearchEngineDto,
  SiteDataDto,
  SiteSettingsDto,
} from "../types";

/**
 * Visibility takes the stricter of the two: a public link inside a private
 * category is never delivered on the public surface (SPEC §2).
 */
export function toPublicLinkDto(link: Link): PublicLinkDto {
  return {
    id: link.id,
    categoryId: link.category_id,
    title: link.title,
    url: link.url,
    iconUrl: link.icon_url,
    description: link.description,
    sortOrder: link.sort_order,
  };
}

export function toSearchEngineDto(engine: SearchEngine): SearchEngineDto {
  return {
    id: engine.id,
    name: engine.name,
    urlTemplate: engine.url_template,
    icon: engine.icon,
    sortOrder: engine.sort_order,
    isDefault: engine.is_default === 1,
  };
}

export function toSiteSettingsDto(
  settings: Record<string, string>,
): SiteSettingsDto {
  const columns = Number.parseInt(settings.columns ?? "0", 10);
  return {
    siteTitle: settings.site_title ?? "nav",
    backgroundUrl: settings.background_url ?? "",
    // 缺省/脏值一律归一 `bing`：存量库没有该键时默认用 Bing 每日壁纸。
    wallpaperSource: settings.wallpaper_source === "custom" ? "custom" : "bing",
    logoUrl: settings.logo_url ?? "",
    columns: Number.isFinite(columns) && columns > 0 ? columns : 0,
    // 存量库没有该键时按默认「开」：搜索在新标签页打开，起始页不被顶掉。
    searchNewTab: (settings.search_new_tab ?? "1") === "1",
  };
}

/**
 * Assembles the public/private site data payload.
 *
 * `scenes` must be the **full** scene list (never pre-filtered): the two-layer
 * visibility rule below needs the private scenes to tell 「belongs to a private
 * scene」 apart from 「belongs to the default scene」. The caller passes raw rows
 * and this function is the single place where scene/category/link visibility is
 * enforced for both surfaces.
 */
export function buildSiteData(
  categories: Category[],
  links: Link[],
  engines: SearchEngine[],
  settings: Record<string, string>,
  scenes: Scene[],
  opts: { includePrivate: boolean },
): SiteDataDto {
  // 两层取与（nav #19 B1）：有效可见性 = 场景公开 AND 分类公开。私有场景整个
  // 空间对外不存在——场景本身与它下面的全部分类（无论分类自身标记）都不进入
  // 未登录数据；分类自身 visibility 保留不动，不做级联改写。登录视角全量可见。
  const visibleScenes = opts.includePrivate ? scenes : publicScenes(scenes);
  const visibleSceneIds = new Set(visibleScenes.map((scene) => scene.id));

  const linksByCategory = new Map<string, Link[]>();
  for (const link of links) {
    const bucket = linksByCategory.get(link.category_id) ?? [];
    bucket.push(link);
    linksByCategory.set(link.category_id, bucket);
  }

  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const fallbackSceneId = defaultSceneId(scenes);

  const dtoCategories: PublicCategoryDto[] = [];
  for (const category of categories) {
    const categoryPrivate = category.visibility === "private";
    if (categoryPrivate && !opts.includePrivate) continue;
    // 所属场景在未登录视角不可见（私有场景）→ 该分类整条不出现，链接随分类。
    if (
      !opts.includePrivate &&
      !visibleSceneIds.has(normalizeSceneId(category.scene_id, scenes))
    ) {
      continue;
    }

    const visibleLinks = (linksByCategory.get(category.id) ?? []).filter(
      (link) => {
        if (!opts.includePrivate) return link.visibility === "public";
        return true;
      },
    );

    dtoCategories.push({
      id: category.id,
      name: category.name,
      icon: category.icon,
      sortOrder: category.sort_order,
      // Defensive normalisation only: every write path supplies a scene, but a
      // legacy row written before schema_v2 may still be NULL/dangling.
      sceneId:
        category.scene_id !== null && sceneIds.has(category.scene_id)
          ? category.scene_id
          : fallbackSceneId,
      links: visibleLinks.map(toPublicLinkDto),
    });
  }

  return {
    categories: dtoCategories,
    scenes: visibleScenes.map(toSceneDto),
    searchEngines: engines.map(toSearchEngineDto),
    settings: toSiteSettingsDto(settings),
  };
}

// ─── Scenes ──────────────────────────────────────────────────────────────────

/**
 * 未登录视角下某个场景是否可见：只有 `visibility = 'public'` 的场景存在。
 * 库/行上缺值（更早的库或手写行）按公开处理——与列的 `DEFAULT 'public'` 同口径。
 */
function isPublicScene(scene: Scene): boolean {
  return scene.visibility !== "private";
}

/** 未登录视角可见的场景（保持原有 sort_order, created_at 顺序）。 */
function publicScenes(scenes: Scene[]): Scene[] {
  return scenes.filter(isPublicScene);
}

/**
 * 未登录视角可见的分类：场景公开 AND 分类公开（两层取与）。私有场景下的分类
 * 无论自身标记都不出现；NULL/悬空 scene_id 先归一化为默认场景再判可见性。
 */
export function publicCategories(
  categories: Category[],
  scenes: Scene[],
): Category[] {
  const visibleSceneIds = new Set(
    publicScenes(scenes).map((scene) => scene.id),
  );
  return categories.filter(
    (category) =>
      category.visibility === "public" &&
      visibleSceneIds.has(normalizeSceneId(category.scene_id, scenes)),
  );
}

export function toSceneDto(scene: Scene): SceneDto {
  return {
    id: scene.id,
    name: scene.name,
    icon: scene.icon,
    sortOrder: scene.sort_order,
    isDefault: scene.is_default === 1,
    visibility: scene.visibility === "private" ? "private" : "public",
  };
}

export function toAdminSceneDto(scene: Scene): AdminSceneDto {
  return {
    ...toSceneDto(scene),
    createdAt: scene.created_at,
    updatedAt: scene.updated_at,
  };
}

/**
 * The default scene is identified by `is_default = 1` only — never by id or by
 * the name「通用」(the name is editable). Falls back to the first scene, then to
 * "", so a corrupt database still yields a well-formed DTO.
 */
export function defaultSceneId(scenes: Scene[]): string {
  return (
    scenes.find((scene) => scene.is_default === 1)?.id ?? scenes[0]?.id ?? ""
  );
}

/** Normalises a category's scene to the default scene when it is unset/unknown. */
export function normalizeSceneId(
  sceneId: string | null | undefined,
  scenes: Scene[],
): string {
  if (sceneId && scenes.some((scene) => scene.id === sceneId)) return sceneId;
  return defaultSceneId(scenes);
}
