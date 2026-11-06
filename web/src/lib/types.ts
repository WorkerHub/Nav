/**
 * nav 前端数据契约（对齐冻结契约 docs/api-contract.md，字段 camelCase）。
 *
 * 两组 DTO：
 *  - SiteData：GET /api/public 与 GET /api/private（分类内嵌链接，无 visibility / 时间戳）。
 *  - Admin*：/api/admin/* 各实体独立 CRUD（扁平列表，含 visibility / 时间戳）。
 *
 * 站点设置（SiteSettings）**不含主题**：深浅色不是站点级配置，只由访客本机偏好
 * 决定（顶栏主题按钮，默认跟随系统），见 `lib/theme.ts`。
 */

export type Visibility = "public" | "private";

// ─── 站点数据（/api/public、/api/private）─────────────────────────────────────

/**
 * 场景（与分类正交的组织维度，冻结契约 #16 §四）：
 * 默认场景 `isDefault === true`，不可删；场景顺序由 `sortOrder` 决定，默认场景不特判。
 * 形状与后台共用（后台 DTO 另带时间戳，见 AdminScene）。
 */
export interface Scene {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
}

export interface SiteLink {
  id: string;
  categoryId: string;
  title: string;
  url: string;
  iconUrl: string | null;
  description: string | null;
  sortOrder: number;
}

export interface SiteCategory {
  id: string;
  name: string;
  icon: string | null;
  /** 所属场景 id：链接不加场景字段，其场景由分类唯一决定 */
  sceneId: string;
  sortOrder: number;
  links: SiteLink[];
}

export interface SearchEngine {
  id: string;
  name: string;
  /** 含 `{q}` 占位符 */
  urlTemplate: string;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
}

export interface SiteSettings {
  siteTitle: string;
  backgroundUrl: string;
  /** 壁纸来源（后端 KV `wallpaper_source`，无此键时为 bing）：`bing` 每日壁纸 / `custom` 用 backgroundUrl */
  wallpaperSource: "bing" | "custom";
  /** 站点 Logo 图片地址（外链 URL 或上传后的 `/assets/...` 路径，空串表示无） */
  logoUrl: string;
  /** 0–12（后端接受并原样存储），0 表示未配置（用默认值） */
  columns: number;
  /** 搜索在新标签页打开（后端 KV `search_new_tab`，无此键时为 true） */
  searchNewTab: boolean;
}

export interface SiteData {
  categories: SiteCategory[];
  /**
   * 全部场景（默认场景是普通成员，位置由 sortOrder 决定）。
   * 契约必填；读侧仍按「缺失 = 无场景概念」兜底（旧后端 / 浏览器里的旧缓存），
   * 见 lib/scene-preference.ts。
   */
  scenes: Scene[];
  searchEngines: SearchEngine[];
  settings: SiteSettings;
}

export type PublicData = SiteData;
export type PrivateData = SiteData;

// ─── 后台数据（/api/admin/*）──────────────────────────────────────────────────

export interface AdminCategory {
  id: string;
  name: string;
  icon: string | null;
  /** 所属场景 id（PUT 改它即「整分类移入另一场景」，链接随分类走） */
  sceneId: string;
  sortOrder: number;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

/** 后台场景 DTO：场景字段 + 时间戳 */
export interface AdminScene extends Scene {
  createdAt: string;
  updatedAt: string;
}

export interface AdminLink {
  id: string;
  categoryId: string;
  title: string;
  url: string;
  iconUrl: string | null;
  description: string | null;
  sortOrder: number;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

// ─── setup 三件套（SETUP-PAGE-SPEC §3，对齐 worker types.ts）──────────────────

/** `GET /api/setup/state`（及兼容别名 `status`）—— 不含任何密钥/哈希。 */
export interface SetupState {
  enabled: boolean;
  ownerExists: boolean;
  tablePrefix: string;
}

export interface SetupMigration {
  name: string;
  status: "applied" | "skipped" | "error";
}

/** `POST /api/setup` 与 `POST /api/admin/setup`（形状完全一致）。 */
export interface SetupResult {
  success: true;
  tablePrefix: string;
  migrations: SetupMigration[];
  ownerExists: boolean;
}

/** `POST /api/auth/setup`（迁移 + 建唯一所有者 + 签发会话）。 */
export interface SetupOwnerResult {
  success: true;
  user: { id: string; username: string };
  tablePrefix: string;
  migrations: SetupMigration[];
}

/** `GET /api/admin/system`。 */
export interface AdminSystem {
  tablePrefix: string;
  setupPageEnabled: boolean;
  ledger: string[];
}

// ─── 两步验证（/api/auth/passkey/*，字段对齐 worker/src/routes/passkey.ts）──────

/** `GET /api/auth/passkey/totp` —— 只回启用态，绝不回 secret。 */
export interface TotpStatus {
  enabled: boolean;
}

/** `POST /api/auth/passkey/totp/setup` —— 待确认的一次性密钥（仅存内存，不落盘不打日志）。 */
export interface TotpSetup {
  /** base32 密钥，供手动录入（等同凭据，不得写日志/评论/提交） */
  secret: string;
  /** `otpauth://` URI，仅用于生成二维码 */
  uri: string;
}

/** `GET /api/auth/passkey/credentials` 单条凭据（后端只回 id / counter / createdAt）。 */
export interface PasskeyCredential {
  id: string;
  counter: number;
  createdAt: string;
}

// ─── 导入导出 ─────────────────────────────────────────────────────────────────

export interface ImportLink {
  title: string;
  url: string;
  iconUrl?: string | null;
  description?: string | null;
  visibility?: Visibility;
}

export interface ImportCategory {
  name: string;
  icon?: string | null;
  visibility?: Visibility;
  links: ImportLink[];
}

export interface ExportCategory {
  name: string;
  icon: string | null;
  visibility: Visibility;
  links: ExportLink[];
}

export interface ExportLink {
  title: string;
  url: string;
  iconUrl: string | null;
  description: string | null;
  visibility: Visibility;
}

export interface NavExport {
  version: 1;
  exportedAt: string;
  categories: ExportCategory[];
  searchEngines: SearchEngine[];
  settings: SiteSettings;
}
