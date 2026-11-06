/**
 * 联调 mock（仅开发环境动态加载，生产构建不打包本文件）：
 * 以 localStorage 持久化的内存库，形状与冻结契约 camelCase 一致。
 *
 * 安全验收口径：
 *  - getPublic() 只吐公开分类与公开链接（分类内嵌链接），无私有数据、不打码、不占位；
 *  - 未登录时 getPrivate() 抛 UnauthorizedError，私有数据不出现在任何返回里。
 */
import type {
  AdminCategory,
  AdminLink,
  AdminScene,
  PrivateData,
  PublicData,
  SearchEngine,
  SiteSettings,
  ImportCategory,
  Visibility,
} from "./types";

const STORAGE_KEY = "nav.mock.db.v2";
const SESSION_KEY = "nav.mock.session";

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

interface MockState {
  scenes: AdminScene[];
  categories: AdminCategory[];
  links: AdminLink[];
  searchEngines: SearchEngine[];
  settings: SiteSettings;
}

/** mock 的默认场景 id：与真实迁移（schema_v2）种子行一致，便于对照契约 */
const DEFAULT_SCENE_ID = "scene_default";

function makeScene(
  id: string,
  name: string,
  sort: number,
  isDefault: boolean,
  icon: string | null = null,
  visibility: Visibility = "public",
): AdminScene {
  return {
    id,
    name,
    icon,
    sortOrder: sort,
    isDefault,
    visibility,
    createdAt: now(),
    updatedAt: now(),
  };
}

function makeLink(
  categoryId: string,
  title: string,
  url: string,
  sort: number,
  visibility: "public" | "private" = "public",
  iconUrl: string | null = null,
  description: string | null = null,
): AdminLink {
  return {
    id: uid(),
    categoryId,
    title,
    url,
    iconUrl,
    description,
    sortOrder: sort,
    visibility,
    createdAt: now(),
    updatedAt: now(),
  };
}

function seed(): MockState {
  // 契约：默认有且仅有一个内置场景「通用」，不预置工作/生活等
  const scenes = [makeScene(DEFAULT_SCENE_ID, "通用", 0, true)];

  const cat = (
    name: string,
    sort: number,
    visibility: "public" | "private" = "public",
  ): AdminCategory => ({
    id: uid(),
    name,
    icon: null,
    sceneId: DEFAULT_SCENE_ID,
    sortOrder: sort,
    visibility,
    createdAt: now(),
    updatedAt: now(),
  });

  const dev = cat("开发", 0);
  const daily = cat("日常", 1);
  const reading = cat("阅读", 2);
  const selfhost = cat("自托管服务", 3, "private");

  const links: AdminLink[] = [
    makeLink(dev.id, "GitHub", "https://github.com", 0),
    makeLink(dev.id, "MDN Web Docs", "https://developer.mozilla.org", 1),
    makeLink(dev.id, "Stack Overflow", "https://stackoverflow.com", 2),
    makeLink(dev.id, "Cloudflare Docs", "https://developers.cloudflare.com", 3),
    makeLink(daily.id, "Gmail", "https://mail.google.com", 0),
    makeLink(daily.id, "Google Calendar", "https://calendar.google.com", 1),
    makeLink(daily.id, "Google Drive", "https://drive.google.com", 2),
    makeLink(daily.id, "YouTube", "https://www.youtube.com", 3),
    makeLink(reading.id, "Hacker News", "https://news.ycombinator.com", 0),
    makeLink(reading.id, "少数派", "https://sspai.com", 1),
    makeLink(reading.id, "知乎", "https://www.zhihu.com", 2),
    makeLink(
      selfhost.id,
      "示例私有服务 A",
      "https://svc-a.internal.example",
      0,
      "private",
    ),
    makeLink(
      selfhost.id,
      "示例私有服务 B",
      "https://svc-b.internal.example",
      1,
      "private",
    ),
    makeLink(
      selfhost.id,
      "示例私有服务 C",
      "https://svc-c.internal.example",
      2,
      "private",
    ),
  ];

  return {
    scenes,
    categories: [dev, daily, reading, selfhost],
    links,
    searchEngines: [
      {
        id: uid(),
        name: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
        icon: null,
        sortOrder: 0,
        isDefault: true,
      },
      {
        id: uid(),
        name: "Bing",
        urlTemplate: "https://www.bing.com/search?q={q}",
        icon: null,
        sortOrder: 1,
        isDefault: false,
      },
      {
        id: uid(),
        name: "DuckDuckGo",
        urlTemplate: "https://duckduckgo.com/?q={q}",
        icon: null,
        sortOrder: 2,
        isDefault: false,
      },
      {
        id: uid(),
        name: "GitHub",
        urlTemplate: "https://github.com/search?q={q}",
        icon: null,
        sortOrder: 3,
        isDefault: false,
      },
    ],
    settings: {
      siteTitle: "我的导航",
      backgroundUrl:
        "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2400&q=80",
      wallpaperSource: "bing",
      logoUrl: "",
      columns: 8,
      searchNewTab: true,
    },
  };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // 旧 mock 库没有 searchNewTab / wallpaperSource：按契约默认补齐，避免界面读到 undefined
      const state = JSON.parse(raw) as Omit<MockState, "settings"> & {
        settings: Partial<SiteSettings> & { theme?: unknown };
      };
      state.settings = {
        searchNewTab: true,
        wallpaperSource: "bing",
        ...state.settings,
      };
      // 站点主题已删除：旧 mock 库存下的 theme 行不再属于契约，读入时丢掉（不迁移数据）
      delete state.settings.theme;
      // 旧 mock 库没有场景维度：补一个默认场景并把存量分类归进去，
      // 与真实迁移 schema_v2 的回填口径一致（不丢数据、不预置额外场景）
      if (!Array.isArray(state.scenes) || state.scenes.length === 0) {
        state.scenes = [makeScene(DEFAULT_SCENE_ID, "通用", 0, true)];
      }
      // 旧 mock 库的场景没有 visibility（schema_v3 之前的形状）：按列默认值 public 补齐，
      // 与真实迁移同口径（已显式标为 private 的场景保持私有）。
      state.scenes = state.scenes.map((scene) => ({
        ...scene,
        visibility: scene.visibility === "private" ? "private" : "public",
      }));
      const fallbackSceneId =
        state.scenes.find((scene) => scene.isDefault)?.id ?? state.scenes[0].id;
      const knownSceneIds = new Set(state.scenes.map((scene) => scene.id));
      state.categories = state.categories.map((category) => ({
        ...category,
        // 缺失/悬空 sceneId 归一化为默认场景，与后端 DTO 口径一致
        sceneId: knownSceneIds.has(category.sceneId)
          ? category.sceneId
          : fallbackSceneId,
      }));
      return state as MockState;
    }
  } catch {
    /* fall through to seed */
  }
  const s = seed();
  persist(s);
  return s;
}

function persist(state: MockState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const bySort = (a: { sortOrder: number }, b: { sortOrder: number }) =>
  a.sortOrder - b.sortOrder;

/**
 * 场景内追加序号：分类的 sort_order 是**场景内**序号（冻结契约 #16）。
 * mock 必须与真实后端 + 前端新建口径一致：省略 sortOrder 时按该场景当前最大 + 1，
 * 而不是全表分类数——否则「追加到末尾」只是 mock 的错觉，真实后端会落到 0。
 */
function nextCategorySortOrder(state: MockState, sceneId: string): number {
  return (
    Math.max(
      -1,
      ...state.categories
        .filter((category) => category.sceneId === sceneId)
        .map((category) => category.sortOrder),
    ) + 1
  );
}

/** 组装站点数据：两层取与（场景公开 AND 分类公开）；私有端点返回全量 */
function toSiteData(state: MockState, includePrivate: boolean): PublicData {
  // 未登录视角下私有场景整个空间对外不存在：场景本身不下发，其下分类也一并滤掉
  const scenes = [...state.scenes]
    .filter((scene) => includePrivate || scene.visibility !== "private")
    .sort(bySort);
  const visibleSceneIds = new Set(scenes.map((scene) => scene.id));
  const categories = state.categories
    .filter(
      (c) =>
        (includePrivate || c.visibility === "public") &&
        (includePrivate || visibleSceneIds.has(c.sceneId)),
    )
    .sort(bySort)
    .map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      sceneId: c.sceneId,
      sortOrder: c.sortOrder,
      links: state.links
        .filter(
          (l) =>
            l.categoryId === c.id &&
            (includePrivate || l.visibility === "public"),
        )
        .sort(bySort)
        .map((l) => ({
          id: l.id,
          categoryId: l.categoryId,
          title: l.title,
          url: l.url,
          iconUrl: l.iconUrl,
          description: l.description,
          sortOrder: l.sortOrder,
        })),
    }));
  return {
    categories,
    scenes,
    searchEngines: [...state.searchEngines].sort(bySort),
    settings: state.settings,
  };
}

export const mockDb = {
  isLoggedIn(): boolean {
    return localStorage.getItem(SESSION_KEY) === "1";
  },

  async loginPassword(input: {
    username: string;
    password: string;
  }): Promise<{ requires2fa: true; tempToken: string } | { ok: true }> {
    if (!input.username || !input.password)
      throw new Error("username and password required");
    // mock：固定口令 nav1234（仅联调用，真实实现走后端）
    if (input.password !== "nav1234") throw new Error("invalid credentials");
    // mock：模拟已启用 TOTP，进入第二步
    return { requires2fa: true, tempToken: "mock-temp-token" };
  },

  async verifyTotp(input: { tempToken: string; code: string }): Promise<void> {
    if (input.tempToken !== "mock-temp-token" || input.code !== "123456") {
      throw new Error("invalid verification code");
    }
    localStorage.setItem(SESSION_KEY, "1");
  },

  async loginPasskey(): Promise<void> {
    localStorage.setItem(SESSION_KEY, "1");
  },

  async logout(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
  },

  async getPublic(): Promise<PublicData> {
    return toSiteData(load(), false);
  },

  async getPrivate(): Promise<PrivateData> {
    if (!this.isLoggedIn()) throw new Error("unauthorized");
    return toSiteData(load(), true);
  },

  async adminListAll() {
    const state = load();
    return {
      scenes: [...state.scenes].sort(bySort),
      categories: [...state.categories].sort(bySort),
      links: [...state.links].sort(bySort),
      searchEngines: [...state.searchEngines].sort(bySort),
      settings: state.settings,
    };
  },

  async createCategory(input: {
    name: string;
    icon?: string | null;
    sceneId?: string;
    sortOrder?: number;
    visibility?: "public" | "private";
  }): Promise<AdminCategory> {
    const state = load();
    const fallbackSceneId =
      state.scenes.find((scene) => scene.isDefault)?.id ?? state.scenes[0].id;
    const sceneId = input.sceneId ?? fallbackSceneId;
    const item: AdminCategory = {
      id: uid(),
      name: input.name ?? "未命名分类",
      icon: input.icon ?? null,
      sceneId,
      sortOrder: input.sortOrder ?? nextCategorySortOrder(state, sceneId),
      visibility: input.visibility ?? "public",
      createdAt: now(),
      updatedAt: now(),
    };
    state.categories.push(item);
    persist(state);
    return item;
  },

  async updateCategory(
    id: string,
    input: Partial<AdminCategory>,
  ): Promise<AdminCategory> {
    const state = load();
    const item = state.categories.find((c) => c.id === id);
    if (!item) throw new Error("category not found");
    Object.assign(item, input, { updatedAt: now() });
    persist(state);
    return item;
  },

  async deleteCategory(id: string): Promise<void> {
    const state = load();
    state.categories = state.categories.filter((c) => c.id !== id);
    state.links = state.links.filter((l) => l.categoryId !== id);
    persist(state);
  },

  async reorderCategories(ids: string[]): Promise<void> {
    const state = load();
    ids.forEach((id, index) => {
      const c = state.categories.find((x) => x.id === id);
      if (c) {
        c.sortOrder = index;
        c.updatedAt = now();
      }
    });
    persist(state);
  },

  async createScene(input: {
    name: string;
    icon?: string | null;
    sortOrder?: number;
    visibility?: Visibility;
  }): Promise<AdminScene> {
    const state = load();
    const item = makeScene(
      uid(),
      input.name ?? "新场景",
      input.sortOrder ?? state.scenes.length,
      false,
      input.icon ?? null,
      input.visibility === "private" ? "private" : "public",
    );
    state.scenes.push(item);
    persist(state);
    return item;
  },

  async updateScene(
    id: string,
    input: { name?: string; icon?: string | null; visibility?: Visibility },
  ): Promise<AdminScene> {
    const state = load();
    const item = state.scenes.find((scene) => scene.id === id);
    if (!item) throw new Error("scene not found");
    // 契约：默认场景不得改为私有（与真实后端同口径，校验失败整次更新不落库）
    if (item.isDefault && input.visibility === "private") {
      throw new Error("default scene cannot be private");
    }
    // isDefault 只读：mock 与后端同口径（忽略该字段）
    Object.assign(item, input, { updatedAt: now() });
    persist(state);
    return item;
  },

  async deleteScene(id: string): Promise<void> {
    const state = load();
    const item = state.scenes.find((scene) => scene.id === id);
    if (!item) throw new Error("scene not found");
    if (item.isDefault) throw new Error("default scene cannot be deleted");
    const fallback = state.scenes.find((scene) => scene.isDefault);
    if (!fallback) throw new Error("default scene not found");
    // 与后端一致：分类（链接随分类走）先移入默认场景，再从末尾接上排序
    const base =
      Math.max(
        -1,
        ...state.categories
          .filter((category) => category.sceneId === fallback.id)
          .map((category) => category.sortOrder),
      ) + 1;
    state.categories = state.categories.map((category) =>
      category.sceneId === id
        ? {
            ...category,
            sceneId: fallback.id,
            sortOrder: base + category.sortOrder,
            updatedAt: now(),
          }
        : category,
    );
    state.scenes = state.scenes.filter((scene) => scene.id !== id);
    persist(state);
  },

  async reorderScenes(ids: string[]): Promise<void> {
    const state = load();
    ids.forEach((id, index) => {
      const scene = state.scenes.find((item) => item.id === id);
      if (scene) {
        scene.sortOrder = index;
        scene.updatedAt = now();
      }
    });
    persist(state);
  },

  async createLink(input: {
    title: string;
    url: string;
    categoryId: string;
    iconUrl?: string | null;
    description?: string | null;
    sortOrder?: number;
    visibility?: "public" | "private";
  }): Promise<AdminLink> {
    const state = load();
    const item: AdminLink = {
      id: uid(),
      categoryId: input.categoryId ?? state.categories[0]?.id ?? "",
      title: input.title ?? "未命名链接",
      url: input.url ?? "https://",
      iconUrl: input.iconUrl ?? null,
      description: input.description ?? null,
      sortOrder:
        input.sortOrder ??
        state.links.filter((l) => l.categoryId === input.categoryId).length,
      visibility: input.visibility ?? "public",
      createdAt: now(),
      updatedAt: now(),
    };
    state.links.push(item);
    persist(state);
    return item;
  },

  async updateLink(id: string, input: Partial<AdminLink>): Promise<AdminLink> {
    const state = load();
    const item = state.links.find((l) => l.id === id);
    if (!item) throw new Error("link not found");
    // 与后端 PUT /api/admin/links/:id 同口径：换分类且未给 sortOrder 时落全局 MAX+1
    // （链接未变分类则不扰动顺序），供 dev 联调对照真实行为。
    const moved =
      input.categoryId !== undefined && input.categoryId !== item.categoryId;
    const appendAt =
      state.links.reduce((max, l) => Math.max(max, l.sortOrder), -1) + 1;
    Object.assign(item, input, {
      sortOrder:
        moved && input.sortOrder === undefined
          ? appendAt
          : (input.sortOrder ?? item.sortOrder),
      updatedAt: now(),
    });
    persist(state);
    return item;
  },

  async deleteLink(id: string): Promise<void> {
    const state = load();
    state.links = state.links.filter((l) => l.id !== id);
    persist(state);
  },

  async reorderLinks(ids: string[]): Promise<void> {
    const state = load();
    ids.forEach((id, index) => {
      const l = state.links.find((x) => x.id === id);
      if (l) {
        l.sortOrder = index;
        l.updatedAt = now();
      }
    });
    persist(state);
  },

  async createEngine(input: {
    name: string;
    urlTemplate: string;
    icon?: string | null;
    sortOrder?: number;
    isDefault?: boolean;
  }): Promise<SearchEngine> {
    const state = load();
    const item: SearchEngine = {
      id: uid(),
      name: input.name ?? "新引擎",
      urlTemplate: input.urlTemplate ?? "https://example.com/search?q={q}",
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? state.searchEngines.length,
      isDefault: input.isDefault ?? false,
    };
    if (item.isDefault)
      state.searchEngines.forEach((e) => {
        e.isDefault = false;
      });
    state.searchEngines.push(item);
    persist(state);
    return item;
  },

  async updateEngine(
    id: string,
    input: Partial<SearchEngine>,
  ): Promise<SearchEngine> {
    const state = load();
    const item = state.searchEngines.find((e) => e.id === id);
    if (!item) throw new Error("engine not found");
    Object.assign(item, input);
    if (item.isDefault)
      state.searchEngines.forEach((e) => {
        e.isDefault = e.id === id;
      });
    persist(state);
    return item;
  },

  async deleteEngine(id: string): Promise<void> {
    const state = load();
    state.searchEngines = state.searchEngines.filter((e) => e.id !== id);
    persist(state);
  },

  async reorderEngines(ids: string[]): Promise<void> {
    const state = load();
    ids.forEach((id, index) => {
      const e = state.searchEngines.find((x) => x.id === id);
      if (e) {
        e.sortOrder = index;
      }
    });
    persist(state);
  },

  async updateSettings(input: Partial<SiteSettings>): Promise<SiteSettings> {
    const state = load();
    state.settings = { ...state.settings, ...input };
    persist(state);
    return state.settings;
  },

  /**
   * 上传资源（mock）：**不做任何真实上传**，只回一个明确标注 `mock-` 的占位路径，
   * 让上传后的回填/预览交互在 vite dev 里可点。真实链路（校验、大小限制、R2 落盘）
   * 必须用 `pnpm build:web` + `wrangler dev`（R2 本地模拟）验证。
   */
  async uploadAsset(
    file: File,
    purpose: "background" | "logo" | "icon",
  ): Promise<{ path: string }> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    return { path: `/assets/mock-${purpose}/${uid()}.${ext}` };
  },

  /** 删除资源（mock）：无对象可删，仅回成功（真实删除走 worker + R2）。 */
  async deleteAsset(_key: string): Promise<void> {
    return;
  },

  async importCategories(
    categories: ImportCategory[],
  ): Promise<{ categoryCount: number; linkCount: number }> {
    const state = load();
    let linkCount = 0;
    for (const cat of categories) {
      const sceneId =
        state.scenes.find((scene) => scene.isDefault)?.id ?? state.scenes[0].id;
      const created: AdminCategory = {
        id: uid(),
        name: cat.name,
        icon: cat.icon ?? null,
        sceneId,
        // 场景内追加（与真实后端的省略 sortOrder 口径保持本地一致）
        sortOrder: nextCategorySortOrder(state, sceneId),
        visibility: cat.visibility ?? "public",
        createdAt: now(),
        updatedAt: now(),
      };
      state.categories.push(created);
      for (const link of cat.links) {
        state.links.push({
          id: uid(),
          categoryId: created.id,
          title: link.title,
          url: link.url,
          iconUrl: link.iconUrl ?? null,
          description: link.description ?? null,
          sortOrder: state.links.filter((l) => l.categoryId === created.id)
            .length,
          visibility: link.visibility ?? "public",
          createdAt: now(),
          updatedAt: now(),
        });
        linkCount++;
      }
    }
    persist(state);
    return { categoryCount: categories.length, linkCount };
  },

  async importEngines(engines: SearchEngine[]): Promise<void> {
    const state = load();
    for (const engine of engines) {
      state.searchEngines.push({
        id: uid(),
        name: engine.name,
        urlTemplate: engine.urlTemplate,
        icon: engine.icon,
        sortOrder: state.searchEngines.length,
        isDefault: engine.isDefault,
      });
    }
    persist(state);
  },
};
