/**
 * Worker 端图标解析器：读目标站 HTML 的 `<link rel="icon">` 声明、探测根文件
 * favicon.ico / .svg / .png / apple-touch-icon.png，抓到后写入 R2 缓存，由
 * `GET /api/icon` 直接回图。契约见 docs/api-contract.md §GET /api/icon。
 *
 * 设计取舍：
 * - 缓存不建表：图标字节与「有图 / 无图」状态都落在既有 R2 桶的保留前缀
 *   `_cache/favicons/{host}` 下，新鲜度写在对象的 customMetadata.fetchedAt 里。
 *   因此本功能不产生 D1 迁移、不新增绑定，也不需要定时任务刷新。
 * - 出网边界：只访问注册表（本站链接与搜索引擎的 host）登记过的 origin，
 *   且只碰 origin 根路径与四个固定根文件；重定向只在同一个 host 内最多跟 2 跳
 *   （允许 http→https 升级），跨域/超跳数一律当该候选失败。
 */
import type { Env } from "../types";
import {
  listCategories,
  listLinks,
  listScenes,
  listSearchEngines,
} from "../db/queries/content";
import { publicCategories } from "./site-data";
import {
  detectBinaryImageKind,
  isSvgDocument,
  RESERVED_ASSET_KEY_PREFIX,
  type ImageKind,
} from "./assets";

/** 图标缓存对象 key = 保留前缀 + favicons/ + host。 */
export const ICON_CACHE_PREFIX = `${RESERVED_ASSET_KEY_PREFIX}favicons/`;

/** 「有图」结果的保鲜期：30 天。 */
const ICON_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 「无图」结果的保鲜期：7 天。 */
const ICON_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 单次抓取上限：HTML 256KB、图标 512KB。 */
const HTML_MAX_BYTES = 256 * 1024;
const ICON_MAX_BYTES = 512 * 1024;

/** 单次请求超时，以及一次解析的总预算（防止端点挂住）。 */
const FETCH_TIMEOUT_MS = 5000;
const RESOLVE_BUDGET_MS = 8000;

/** 同一个 origin 内最多跟随几跳重定向（302 多来自 UA/地区差异）。 */
const MAX_REDIRECTS = 2;

/** 站点的 HTML 里最多认几个 `<link rel="icon">` 声明。 */
const MAX_DECLARED_ICONS = 3;

const USER_AGENT = "nav-favicon/1";

/** 根文件探测顺序（与契约一致）。 */
export const ROOT_ICON_PATHS = [
  "/favicon.ico",
  "/favicon.svg",
  "/favicon.png",
  "/apple-touch-icon.png",
] as const;

const MIME_BY_KIND: Record<ImageKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

// ─── 目标与出网边界 ──────────────────────────────────────────────────────────

export interface IconTarget {
  /** 小写 host（URL 解析后的值，IPv6 带方括号）。 */
  host: string;
  /** `scheme://host[:port]`，不带尾部斜杠。 */
  origin: string;
}

/**
 * 解析并校验一个图标目标 URL。只放行 http/https、无账号密码、默认端口、
 * 且 host 不是内网/回环/保留地址的目标；其余返回 null。
 */
export function parseIconTarget(value: string): IconTarget | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const port = url.port;
  if (port !== "" && port !== "80" && port !== "443") return null;

  // WHATWG URL 不剥主机名末尾的根点（`example.com.`），统一规范化。
  const host = normalizeHostname(url.hostname);
  if (!isPublicHostname(host)) return null;

  return { host, origin: `${url.protocol}//${host}${port ? `:${port}` : ""}` };
}

/** 小写 + 去掉末尾根点：`localhost.` 与 `localhost` 必须是同一个名字。 */
function normalizeHostname(rawHost: string): string {
  return rawHost.toLowerCase().replace(/\.+$/, "");
}

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

/** 内网名字、单标签主机名与私网/保留 IP 字面量一律拒绝。 */
export function isPublicHostname(rawHost: string): boolean {
  const host = normalizeHostname(rawHost);
  if (!host) return false;

  // WHATWG URL 把 IPv6 字面量放在方括号里（`[::1]`）。
  if (host.startsWith("[") && host.endsWith("]")) {
    return isPublicIpv6(host.slice(1, -1));
  }
  if (host === "localhost") return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return false;
  }
  // 单标签（intranet、printer …）只能是内网名字。
  if (!host.includes(".")) return false;

  const ipv4 = parseIpv4(host);
  if (ipv4) return isPublicIpv4(ipv4);

  return true;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets as [number, number, number, number];
}

function isPublicIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // 本网 / 内网 / 环回
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // 链路本地（云元数据）
  if (a === 172 && b >= 16 && b <= 31) return false; // 内网
  if (a === 192 && b === 168) return false; // 内网
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // 基准测试
  if (a === 198 && b === 51 && c === 100) return false; // 文档
  if (a === 203 && b === 0 && c === 113) return false; // 文档
  if (a >= 224) return false; // 组播 / 保留 / 广播
  return true;
}

function isPublicIpv6(raw: string): boolean {
  const host = raw.toLowerCase();
  if (host === "::" || host === "::1") return false; // 未指定 / 环回
  if (/^f[cd]/.test(host)) return false; // fc00::/7 唯一本地
  if (/^fe[89ab]/.test(host)) return false; // fe80::/10 链路本地
  if (/^ff/.test(host)) return false; // 组播
  // IPv4 映射 / NAT64 可能藏一个私网 v4 地址。
  if (host.startsWith("::ffff:") || host.startsWith("64:ff9b:")) return false;
  return true;
}

// ─── HTML 中的图标声明 ──────────────────────────────────────────────────────

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * 纯函数：从 HTML 里取 `<link rel="icon">` 类声明，按偏好排序后返回绝对 URL。
 *
 * 不引 HTML 解析依赖：worker 现有依赖（hono、webauthn）无一覆盖 DOM 解析，
 * 而 `HTMLRewriter` 在 node 测试环境不存在；这里只关心 `<link>` 标签，正则
 * 足够且可被现有 vitest（environment: node）直接单测。
 *
 * `documentUrl` 是这份 HTML 的真实地址（跟随同域重定向后的最终 URL），相对
 * 路径按它解析 —— 否则 `/` 302 到 `/sub/dir/page` 后，`pic.png` 会被算错一层。
 * 只接受与文档同 host 的声明（跨 host/CDN 的图标一律忽略，不扩大出网边界）。
 */
export function parseIconLinks(html: string, documentUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(documentUrl);
  } catch {
    return [];
  }
  const baseHost = base.hostname.toLowerCase();
  const origin = base.origin;
  const found: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  for (const tag of html.match(LINK_TAG_RE) ?? []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(ATTR_RE)) {
      const name = match[1].toLowerCase();
      if (name in attrs) continue;
      attrs[name] = match[2] ?? match[3] ?? match[4] ?? "";
    }

    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.some((t) => t === "icon" || t.startsWith("apple-touch-icon"))) {
      continue;
    }
    // mask-icon 是 Safari 的单色钉住图标，不适合当站点图标。
    if (rel.includes("mask-icon")) continue;

    const href = (attrs.href ?? "").trim();
    if (!href) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.hostname.toLowerCase() !== baseHost) continue;
    if (!resolved.pathname || resolved.pathname === "/") continue;

    const url = `${origin}${resolved.pathname}${resolved.search}`;
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ url, score: iconLinkScore(attrs, resolved) });
  }

  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DECLARED_ICONS)
    .map((entry) => entry.url);
}

/** 越大越优先：svg > png/webp > ico，再按 sizes 加分。 */
function iconLinkScore(attrs: Record<string, string>, resolved: URL): number {
  const type = (attrs.type ?? "").toLowerCase();
  const ext = resolved.pathname.split(".").pop()?.toLowerCase() ?? "";
  const hint = type || ext;

  let score = 10;
  if (hint.includes("svg")) score = 40;
  else if (hint.includes("png")) score = 30;
  else if (["webp", "gif", "jpg", "jpeg"].some((v) => hint.includes(v))) {
    score = 25;
  } else if (hint.includes("icon") || hint === "ico") score = 20;

  return score + sizeBonus(attrs.sizes);
}

function sizeBonus(sizes: string | undefined): number {
  const value = (sizes ?? "").trim().toLowerCase();
  if (!value) return 0;
  if (value === "any") return 32; // 可缩放（svg）
  let max = 0;
  for (const match of value.matchAll(/(\d+)\s*x\s*(\d+)/g)) {
    max = Math.max(max, Number(match[1]), Number(match[2]));
  }
  return Math.min(Math.floor(max / 10), 32);
}

// ─── 抓取与类型嗅探 ──────────────────────────────────────────────────────────

interface FetchedBody {
  bytes: Uint8Array;
  /** 小写、无参数部分的 Content-Type；缺失时为空串。 */
  contentType: string;
  /** 跟随同域重定向后的最终 URL（用作 sourceUrl 诊断）。 */
  finalUrl: string;
}

/** HTML 错误页 / JSON 一律不认（XHTML 同样以 `<?xml` 开头，能骗过 SVG 探测）。 */
const NON_IMAGE_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "text/json",
]);

export interface IconImage {
  kind: ImageKind;
  mime: string;
}

/**
 * 以字节为准判定图标类型（复用 assets 服务的魔数探测），声明与内容不符即丢弃。
 */
export function sniffIcon(
  bytes: Uint8Array,
  declaredContentType: string,
): IconImage | null {
  if (bytes.length === 0) return null;
  if (NON_IMAGE_CONTENT_TYPES.has(declaredContentType)) return null;

  const binary = detectBinaryImageKind(bytes);
  if (binary) return { kind: binary, mime: MIME_BY_KIND[binary] };

  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 1024));
  if (
    isSvgDocument(bytes) &&
    /<svg[\s>]/i.test(head) &&
    !/<html[\s>]/i.test(head)
  ) {
    return { kind: "svg", mime: MIME_BY_KIND.svg };
  }
  return null;
}

/** 读响应体，超过上限就放弃（返回 null），避免把大文件拖进内存。 */
async function readCapped(
  res: Response,
  limit: number,
): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!res.body) return new Uint8Array(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {
        // 取消失败无关紧要，反正这份响应已经弃用。
      }
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * 重定向目标必须仍在**同一个 host** 内（允许 http→https 升级，禁止 https→http 降级）；
 * 端口仍只允许默认值且不能带账号密码。域外/解析不了一律返回 null —— 宁可
 * 这一候选失败，也不扩大出网边界。
 */
export function sameHostRedirect(
  location: string | null,
  currentUrl: string,
  allowedHost: string,
): string | null {
  if (!location) return null;
  let next: URL;
  try {
    next = new URL(location, currentUrl);
  } catch {
    return null;
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") return null;
  if (next.hostname.toLowerCase() !== allowedHost) return null;
  if (next.port !== "" && next.port !== "80" && next.port !== "443") {
    return null;
  }
  if (next.username || next.password) return null;

  // 不允许从 https 降回 http（明文）。
  let currentSecure = false;
  try {
    currentSecure = new URL(currentUrl).protocol === "https:";
  } catch {
    return null;
  }
  if (currentSecure && next.protocol !== "https:") return null;

  return next.toString();
}

/**
 * 单次抓取：`redirect: "manual"` 自己管重定向 —— 只有 Location 仍在 `allowedHost`
 * 内才跟（最多 {@link MAX_REDIRECTS} 跳），跨域 3xx 当该候选失败。最终只认 200。
 */
async function fetchLimited(
  url: string,
  accept: string,
  maxBytes: number,
  timeoutMs: number,
  allowedHost: string,
): Promise<FetchedBody | null> {
  const deadline = Date.now() + timeoutMs;
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const remaining = Math.min(FETCH_TIMEOUT_MS, deadline - Date.now());
    if (remaining <= 0) return null;

    let res: Response;
    try {
      res = await fetch(current, {
        headers: { accept, "user-agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
      });
    } catch {
      return null;
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const next = sameHostRedirect(
        res.headers.get("location"),
        current,
        allowedHost,
      );
      if (!next || hop === MAX_REDIRECTS) return null;
      current = next;
      continue;
    }
    if (res.status !== 200) return null;

    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(res, maxBytes);
    } catch {
      return null;
    }
    if (!bytes) return null;

    return {
      bytes,
      contentType: (res.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase(),
      finalUrl: current,
    };
  }

  return null;
}

/** 尝试时长：单个请求上限 5s，且不超过本次解析的剩余预算。 */
function attemptTimeout(deadline: number): number {
  return Math.min(FETCH_TIMEOUT_MS, deadline - Date.now());
}

// ─── 解析结果与 R2 缓存 ──────────────────────────────────────────────────────

export interface CachedIcon {
  status: "ok" | "none";
  bytes?: Uint8Array;
  mime?: string;
  /** 抓取时间（ISO），缓存新鲜度的唯一依据。 */
  fetchedAt: string;
  /** 图标来源 URL（诊断用，仅存 customMetadata）。 */
  sourceUrl?: string;
}

function cacheKey(host: string): string {
  return `${ICON_CACHE_PREFIX}${host}`;
}

async function readCache(
  bucket: R2Bucket,
  host: string,
): Promise<CachedIcon | null> {
  try {
    const object = await bucket.get(cacheKey(host));
    if (!object) return null;

    const meta = object.customMetadata ?? {};
    const uploaded =
      object.uploaded instanceof Date ? object.uploaded.toISOString() : "";
    const fetchedAt = meta.fetchedAt ?? uploaded;

    if (meta.status === "none") return { status: "none", fetchedAt };
    if (meta.status !== "ok") return null;

    const bytes = await object.bytes();
    const mime =
      meta.mime ??
      object.httpMetadata?.contentType ??
      "application/octet-stream";
    return {
      status: "ok",
      bytes,
      mime,
      fetchedAt,
      sourceUrl: meta.sourceUrl || undefined,
    };
  } catch {
    // 缓存读取失败等同未命中：重新抓一次即可。
    return null;
  }
}

async function writeCache(
  bucket: R2Bucket | undefined,
  host: string,
  icon: CachedIcon,
): Promise<void> {
  if (!bucket) return;
  const bytes = icon.status === "ok" ? icon.bytes : undefined;
  const hasImage = Boolean(bytes && icon.mime);

  const customMetadata: Record<string, string> = {
    status: icon.status,
    fetchedAt: icon.fetchedAt,
  };
  if (hasImage) {
    customMetadata.mime = icon.mime as string;
    customMetadata.sourceUrl = icon.sourceUrl ?? "";
  }

  try {
    await bucket.put(cacheKey(host), bytes ?? new Uint8Array(0), {
      httpMetadata: {
        contentType: hasImage ? (icon.mime as string) : "application/json",
        cacheControl: "no-store",
      },
      customMetadata,
    });
  } catch (err) {
    // 缓存是尽力而为：写失败不影响本次回图。
    console.warn(`failed to cache icon for "${host}"`, err);
  }
}

function isFresh(icon: CachedIcon, now: number): boolean {
  const at = Date.parse(icon.fetchedAt);
  if (!Number.isFinite(at)) return false;
  const ttl = icon.status === "ok" ? ICON_TTL_MS : ICON_MISS_TTL_MS;
  return now - at < ttl;
}

// ─── 站点注册表 ──────────────────────────────────────────────────────────────

export interface IconRegistryEntry {
  /** 注册表里登记的 origin，图标一律只从这里取。 */
  origin: string;
}

/** host → 登记信息。 */
export type IconRegistry = Map<string, IconRegistryEntry>;

/**
 * 用本站数据建注册表：搜索引擎的 host 恒公开，链接按可见性（私有链接的 host
 * 只有带会话时才入表）。库未初始化/查询失败按空注册表处理，端点回 404 而不
 * 是 500。
 */
export async function loadIconRegistry(
  env: Env,
  prefix: string,
  options: { includePrivate: boolean },
): Promise<IconRegistry> {
  const registry: IconRegistry = new Map();

  const add = (rawUrl: string | null | undefined): void => {
    if (!rawUrl) return;
    const target = parseIconTarget(rawUrl);
    if (!target) return; // 内网/非法 URL 永远进不了注册表

    const existing = registry.get(target.host);
    // 同一 host 既有 http 又有 https 时优先 https：不要因为插入顺序退到明文。
    if (!existing) {
      registry.set(target.host, { origin: target.origin });
      return;
    }
    if (
      existing.origin.startsWith("http://") &&
      target.origin.startsWith("https://")
    ) {
      registry.set(target.host, { origin: target.origin });
    }
  };

  try {
    const [categories, engines, links] = await Promise.all([
      listCategories(env.DB, prefix),
      listSearchEngines(env.DB, prefix),
      listLinks(env.DB, prefix),
    ]);
    // 场景维度可能还没迁移（库停在 schema_v1，或 Worker 先于库升级）：这时没有
    // `scenes` 表，`listScenes` 会抛 `no such table`。不能让它把整段查询一起拖
    // 下水——那会让一次未迁移的读把全部公开 host 变成「未登记」。降级为引入场景
    // 维度之前的口径：只看分类自身 visibility。
    const scenes = await listScenes(env.DB, prefix).catch(() => null);
    // 匿名视角的可见分类 = 场景公开 AND 分类公开（两层取与，与 /api/public
    // 同一口径）：私有场景整个空间对匿名不存在，其下链接的 host 也不算登记。
    const visibleCategoryIds = new Set(
      (scenes === null
        ? categories.filter((category) => category.visibility === "public")
        : publicCategories(categories, scenes)
      ).map((category) => category.id),
    );

    for (const engine of engines) {
      add(engine.url_template.replace("{q}", ""));
    }
    for (const link of links) {
      // 可见性取更严一方：私有分类下的 public 链接、私有场景下的链接同样不算
      // 公开（与 /api/public 一致）。
      if (!options.includePrivate) {
        if (link.visibility !== "public") continue;
        if (!visibleCategoryIds.has(link.category_id)) continue;
      }
      add(link.url);
    }
  } catch {
    // 库还没建表：注册表为空，调用方回 404。
  }

  return registry;
}

// ─── 解析与取图 ──────────────────────────────────────────────────────────────

/** 抓 HTML + 逐个候选取图；全失败则记为「无图」。 */
export async function resolveIcon(target: IconTarget): Promise<CachedIcon> {
  const fetchedAt = new Date().toISOString();
  const deadline = Date.now() + RESOLVE_BUDGET_MS;

  const candidates: string[] = [];
  const html = await fetchLimited(
    `${target.origin}/`,
    "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    HTML_MAX_BYTES,
    attemptTimeout(deadline),
    target.host,
  );
  if (html) {
    candidates.push(
      ...parseIconLinks(
        new TextDecoder("utf-8").decode(html.bytes),
        // 相对路径按 HTML 的真实地址解，而不是注册表 origin 的根。
        html.finalUrl,
      ),
    );
  }
  for (const path of ROOT_ICON_PATHS) {
    candidates.push(`${target.origin}${path}`);
  }

  for (const url of candidates) {
    const timeout = attemptTimeout(deadline);
    if (timeout <= 0) break;

    const candidate = await fetchLimited(
      url,
      "image/*,*/*;q=0.8",
      ICON_MAX_BYTES,
      timeout,
      target.host,
    );
    if (!candidate) continue;

    const image = sniffIcon(candidate.bytes, candidate.contentType);
    if (!image) continue;

    return {
      status: "ok",
      bytes: candidate.bytes,
      mime: image.mime,
      fetchedAt,
      // 记跟随同域重定向后的最终地址，方便排查。
      sourceUrl: candidate.finalUrl,
    };
  }

  return { status: "none", fetchedAt };
}

/** 同一 host 的并发解析合并：一次页面加载不会对同一个站重复开抓。 */
const inflight = new Map<string, Promise<CachedIcon>>();

function resolveAndCache(
  env: Env,
  target: IconTarget,
  previous: CachedIcon | null,
): Promise<CachedIcon> {
  const existing = inflight.get(target.host);
  if (existing) return existing;

  const task = resolveIcon(target)
    .then(async (fresh) => {
      // 刷新失败不能把在用的好图标降级成 7 天负缓存：保留旧图，只顺延保鲜期，
      // 让下一次过期时再重试（旧结果才是它的底线，不是一次失败就能抹掉的）。
      const icon =
        fresh.status === "none" && previous?.status === "ok"
          ? { ...previous, fetchedAt: fresh.fetchedAt }
          : fresh;
      await writeCache(env.R2, target.host, icon);
      return icon;
    })
    .finally(() => {
      inflight.delete(target.host);
    });

  inflight.set(target.host, task);
  return task;
}

/** 后台任务调度器：路由传 `ctx.waitUntil`，测试环境可以什么都不做。 */
export type IconScheduler = (task: Promise<unknown>) => void;

/**
 * 取某个 host 的图标：
 * - 缓存新鲜 → 直接用；
 * - 缓存过期 → 先回旧结果，后台重抓（无定时任务）；
 * - 没缓存 → 现抓并写缓存。R2 未绑定或读写失败时降级为「现抓现发、不缓存」。
 */
export async function getIcon(
  env: Env,
  target: IconTarget,
  schedule: IconScheduler,
): Promise<CachedIcon> {
  const bucket = env.R2;
  const cached = bucket ? await readCache(bucket, target.host) : null;

  if (cached && isFresh(cached, Date.now())) return cached;
  if (cached) {
    schedule(resolveAndCache(env, target, cached).catch(() => undefined));
    return cached;
  }
  return resolveAndCache(env, target, null);
}
