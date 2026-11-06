import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  applyMigrationList,
  runMigrations,
} from "../src/lib/migrations-runner";
import { getMigrations } from "../src/lib/migrations";
import { assetPublicRoutes } from "../src/routes/assets";
import { iconRoutes } from "../src/routes/icon";
import {
  ICON_CACHE_PREFIX,
  loadIconRegistry,
  parseIconLinks,
  parseIconTarget,
  sameHostRedirect,
  sniffIcon,
} from "../src/services/favicon";
import { signJWT } from "../src/core/auth";
import { createOwner, insertSession } from "../src/db/queries/users";
import { getTablePrefix, type Env } from "../src/types";
import { MemoryR2, makeEnv, readJson, type SqliteD1 } from "./helpers";

// ─── 夹具 ────────────────────────────────────────────────────────────────────

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);

const ICO_BYTES = new Uint8Array([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00,
]);

const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
);

function htmlResponse(
  html: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function bytesResponse(
  bytes: Uint8Array,
  contentType: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": contentType, ...headers },
  });
}

const NOT_FOUND = () => new Response("", { status: 404 });

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/icon", iconRoutes);
  app.route("/assets", assetPublicRoutes);
  return app;
}

function sql(env: Env) {
  return (env.DB as unknown as SqliteD1).db;
}

function seedContent(
  env: Env,
  links: Array<{
    id: string;
    url: string;
    visibility?: string;
    categoryId?: string;
  }> = [],
  engines: Array<{ id: string; urlTemplate: string }> = [],
  categories: Array<{ id: string; visibility?: string }> = [{ id: "cat-1" }],
): void {
  const db = sql(env);
  const now = new Date().toISOString();
  for (const category of categories) {
    db.prepare(
      "INSERT OR IGNORE INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      category.id,
      category.id,
      null,
      0,
      category.visibility ?? "public",
      now,
      now,
    );
  }

  for (const link of links) {
    db.prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      link.id,
      link.categoryId ?? categories[0].id,
      link.id,
      link.url,
      null,
      null,
      0,
      link.visibility ?? "public",
      now,
      now,
    );
  }

  for (const engine of engines) {
    db.prepare(
      "INSERT INTO search_engines (id, name, url_template, icon, sort_order, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(engine.id, engine.id, engine.urlTemplate, null, 0, 0, now, now);
  }
}

/** 伪造一个有效会话 Cookie（不依赖 setup 流程与密钥）。 */
async function makeSessionCookie(env: Env): Promise<string> {
  const prefix = getTablePrefix(env);
  const userId = "user-1";
  const sid = "sid-1";
  const now = Math.floor(Date.now() / 1000);

  await createOwner(env.DB, prefix, {
    id: userId,
    username: "owner",
    password_hash: "not-used-here",
  });
  await insertSession(env.DB, prefix, {
    id: sid,
    user_id: userId,
    expires_at: new Date((now + 3600) * 1000).toISOString(),
    ip: null,
    user_agent: null,
  });
  const token = await signJWT(
    {
      typ: "access",
      sub: userId,
      jti: "jti-1",
      sid,
      iat: now,
      exp: now + 3600,
    },
    env.SESSION_SECRET,
  );
  return `nav_session=${token}`;
}

function iconRequest(
  app: Hono,
  env: Env,
  target: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(
    `/api/icon?url=${encodeURIComponent(target)}`,
    { headers },
    env,
  );
}

// ─── 目标校验（SSRF） ────────────────────────────────────────────────────────

describe("parseIconTarget", () => {
  it("拒绝内网、回环、保留地址与非 http(s) 目标", () => {
    const blocked = [
      "http://127.0.0.1/",
      "http://127.0.0.1:8080/admin",
      "http://localhost/",
      "http://LOCALHOST/",
      "http://10.0.0.5/x",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
      "http://224.0.0.1/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://intranet/",
      "http://printer.local/",
      "http://metadata.internal/",
      "http://box.home.arpa/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "https://user:pw@example.com/",
      "http://example.com:8080/",
    ];
    for (const target of blocked) {
      expect(parseIconTarget(target), target).toBeNull();
    }
  });

  it("放行公网目标，只保留 host 与 scheme（丢掉 path/query）", () => {
    expect(parseIconTarget("https://Example.COM/docs?q=1")).toEqual({
      host: "example.com",
      origin: "https://example.com",
    });
    expect(parseIconTarget("https://example.com:443/")?.origin).toBe(
      "https://example.com",
    );
    expect(parseIconTarget("http://news.ycombinator.com/item?id=1")).toEqual({
      host: "news.ycombinator.com",
      origin: "http://news.ycombinator.com",
    });
    expect(parseIconTarget("not a url")).toBeNull();
  });

  it("末尾根点不能绕过内网黑名单，公网域名则被规范化", () => {
    for (const target of [
      "http://localhost./",
      "http://printer.local./",
      "http://box.home.arpa./",
      "http://metadata.internal./",
    ]) {
      expect(parseIconTarget(target), target).toBeNull();
    }
    // `example.com.` 与 `example.com` 必须是同一个目标（同一个缓存条目）。
    expect(parseIconTarget("https://example.com./")).toEqual({
      host: "example.com",
      origin: "https://example.com",
    });
  });
});

// ─── HTML 图标声明 ───────────────────────────────────────────────────────────

describe("parseIconLinks", () => {
  it("按 svg > png > ico 排序，忽略跨 host 声明与 mask-icon", () => {
    const html = `
      <head>
        <link rel="icon" href="/favicon-16.ico" sizes="16x16">
        <link rel="icon" type="image/png" href="/static/icon-32.png" sizes="32x32">
        <link rel="icon" type="image/svg+xml" href="/static/icon.svg">
        <link rel="apple-touch-icon" sizes="180x180" href="https://cdn.other.net/touch.png">
        <link rel="mask-icon" href="/mask.svg">
        <link rel="stylesheet" href="/app.css">
      </head>`;
    expect(parseIconLinks(html, "https://example.com")).toEqual([
      "https://example.com/static/icon.svg",
      "https://example.com/static/icon-32.png",
      "https://example.com/favicon-16.ico",
    ]);
  });

  it("协议相对与 http 声明都收敛到注册表 origin，重复的只留一条", () => {
    const html =
      '<link rel="shortcut icon" href="//example.com/a.png">' +
      '<link rel="icon" href="http://example.com/b.ico">' +
      "<link rel=icon href=/a.png>";
    expect(parseIconLinks(html, "https://example.com")).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.ico",
    ]);
  });

  it("相对路径按 HTML 的真实地址解（含同域重定向后的子路径）", () => {
    const html =
      '<link rel="icon" href="pic.png"><link rel="icon" href="../up.ico">';
    expect(
      parseIconLinks(html, "https://rel.example/sub/dir/index.html"),
    ).toEqual([
      "https://rel.example/sub/dir/pic.png",
      "https://rel.example/sub/up.ico",
    ]);
  });

  it("没有声明时返回空数组", () => {
    expect(
      parseIconLinks("<html><head></head></html>", "https://a.com"),
    ).toEqual([]);
  });
});

// ─── 字节嗅探 ────────────────────────────────────────────────────────────────

describe("sniffIcon", () => {
  it("只认真正的图片字节，HTML 错误页冒充 SVG 会被拒", () => {
    const xhtml = new TextEncoder().encode(
      '<?xml version="1.0"?><html><body>not found</body></html>',
    );
    expect(sniffIcon(xhtml, "image/svg+xml")).toBeNull();
    expect(
      sniffIcon(new TextEncoder().encode("<html>404</html>"), "text/html"),
    ).toBeNull();
    expect(sniffIcon(new Uint8Array(0), "image/png")).toBeNull();
    expect(sniffIcon(new Uint8Array([1, 2, 3, 4]), "image/png")).toBeNull();
  });

  it("按魔数判定类型，不看声明的 Content-Type", () => {
    expect(sniffIcon(PNG_BYTES, "application/octet-stream")).toEqual({
      kind: "png",
      mime: "image/png",
    });
    expect(sniffIcon(ICO_BYTES, "")).toEqual({
      kind: "ico",
      mime: "image/x-icon",
    });
    expect(sniffIcon(SVG_BYTES, "image/svg+xml")).toEqual({
      kind: "svg",
      mime: "image/svg+xml",
    });
  });
});

// ─── 站点注册表 ──────────────────────────────────────────────────────────────

describe("loadIconRegistry", () => {
  let env: Env;

  beforeEach(async () => {
    env = makeEnv();
    await runMigrations(env);
  });

  it("只收公网 origin：内网/非法 URL 永远进不了注册表", async () => {
    seedContent(env, [
      { id: "l1", url: "http://127.0.0.1:8080/admin" },
      { id: "l2", url: "https://ok.example/" },
      { id: "l3", url: "not a url" },
      { id: "l4", url: "https://secret.example/", visibility: "private" },
    ]);
    const registry = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: false,
    });
    expect([...registry.keys()]).toEqual(["ok.example"]);
    expect(registry.get("ok.example")).toEqual({
      origin: "https://ok.example",
    });

    const withPrivate = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: true,
    });
    expect([...withPrivate.keys()].sort()).toEqual([
      "ok.example",
      "secret.example",
    ]);
  });

  it("搜索引擎的 urlTemplate 也入表", async () => {
    seedContent(
      env,
      [],
      [{ id: "e1", urlTemplate: "https://www.google.com/search?q={q}" }],
    );
    const registry = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: false,
    });
    expect(registry.get("www.google.com")).toEqual({
      origin: "https://www.google.com",
    });
  });

  it("同一 host 既有 http 又有 https 链接时优先 https", async () => {
    seedContent(env, [
      { id: "l1", url: "http://both.example/" },
      { id: "l2", url: "https://both.example/" },
    ]);
    const registry = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: false,
    });
    expect(registry.get("both.example")).toEqual({
      origin: "https://both.example",
    });
  });

  it("私有分类下的 public 链接对匿名不算登记（可见性取更严一方）", async () => {
    seedContent(
      env,
      [{ id: "l1", url: "https://hidden.example/", categoryId: "cat-hidden" }],
      [],
      [{ id: "cat-hidden", visibility: "private" }],
    );

    const anonymous = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: false,
    });
    expect(anonymous.has("hidden.example")).toBe(false);

    const authed = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: true,
    });
    expect(authed.get("hidden.example")).toEqual({
      origin: "https://hidden.example",
    });
  });

  it("私有场景下的链接对匿名不算登记（两层取与）", async () => {
    const now = new Date().toISOString();
    sql(env)
      .prepare(
        "INSERT INTO scenes (id, name, icon, sort_order, is_default, visibility, created_at, updated_at) VALUES ('scene_secret', '秘密', NULL, 9, 0, 'private', ?, ?)",
      )
      .run(now, now);
    sql(env)
      .prepare(
        "INSERT INTO categories (id, name, icon, sort_order, visibility, scene_id, created_at, updated_at) VALUES ('cat-secret', '秘密分类', NULL, 0, 'public', 'scene_secret', ?, ?)",
      )
      .run(now, now);
    sql(env)
      .prepare(
        "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES ('l-secret', 'cat-secret', 't', 'https://hidden-scene.example/', NULL, NULL, 0, 'public', ?, ?)",
      )
      .run(now, now);

    const anonymous = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: false,
    });
    expect(anonymous.has("hidden-scene.example")).toBe(false);

    const authed = await loadIconRegistry(env, getTablePrefix(env), {
      includePrivate: true,
    });
    expect(authed.get("hidden-scene.example")).toEqual({
      origin: "https://hidden-scene.example",
    });
  });

  it("库停在 schema_v1（没有 scenes 表）时仍按旧的分类口径登记公开 host", async () => {
    // Worker 先于库升级时数据库可能还停在 schema_v1：没有 scenes 表，也没有
    // categories.scene_id。此时必须退化为「只看分类 visibility」，不能因为
    // listScenes 抛错就把整张注册表清空（全部公开 host 变成 404）。
    const legacy = makeEnv();
    const v1 = getMigrations("")[0];
    if (!v1) throw new Error("schema_v1 missing");
    await applyMigrationList(legacy.DB, "", [v1]);

    const now = new Date().toISOString();
    sql(legacy)
      .prepare(
        "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES ('cat-v1', 'v1', NULL, 0, 'public', ?, ?)",
      )
      .run(now, now);
    sql(legacy)
      .prepare(
        "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES ('cat-v1-private', 'v1p', NULL, 1, 'private', ?, ?)",
      )
      .run(now, now);
    sql(legacy)
      .prepare(
        "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES ('l-v1', 'cat-v1', 't', 'https://legacy.example/', NULL, NULL, 0, 'public', ?, ?)",
      )
      .run(now, now);
    sql(legacy)
      .prepare(
        "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES ('l-v1-hidden', 'cat-v1-private', 't', 'https://hidden-v1.example/', NULL, NULL, 0, 'public', ?, ?)",
      )
      .run(now, now);

    const registry = await loadIconRegistry(legacy, getTablePrefix(legacy), {
      includePrivate: false,
    });
    expect([...registry.keys()]).toEqual(["legacy.example"]);

    const authed = await loadIconRegistry(legacy, getTablePrefix(legacy), {
      includePrivate: true,
    });
    expect([...authed.keys()].sort()).toEqual([
      "hidden-v1.example",
      "legacy.example",
    ]);
  });

  it("库还没初始化时退化为空注册表（不抛）", async () => {
    const fresh = makeEnv();
    const registry = await loadIconRegistry(fresh, getTablePrefix(fresh), {
      includePrivate: true,
    });
    expect(registry.size).toBe(0);
  });
});

// ─── 端点 ────────────────────────────────────────────────────────────────────

describe("GET /api/icon", () => {
  let env: Env;
  let r2: MemoryR2;
  let app: Hono;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    r2 = new MemoryR2();
    env = makeEnv({ R2: r2 as unknown as R2Bucket });
    await runMigrations(env);
    app = makeApp();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("冷启动按声明取图、按真实类型回图并写入 R2，二次请求不再回源", async () => {
    seedContent(env, [{ id: "l1", url: "https://example.com/docs" }]);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://example.com/") {
        return htmlResponse(
          '<link rel="icon" type="image/svg+xml" href="/icon.svg">',
        );
      }
      if (input === "https://example.com/icon.svg") {
        return bytesResponse(SVG_BYTES, "image/svg+xml", {
          "x-upstream-secret": "leak",
          "set-cookie": "upstream=1",
        });
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://example.com/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // 第三方 SVG 不能被当本站文档执行脚本；会话相关的响应不能被共享缓存复用。
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(res.headers.get("vary")).toBe("Cookie");
    // 上游响应头一概不透传。
    expect(res.headers.get("x-upstream-secret")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
      Array.from(SVG_BYTES),
    );

    // 出网一律 redirect: manual（绝不跟去别的 origin）。
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).redirect).toBe("manual");
    }

    const cached = r2.objects.get(`${ICON_CACHE_PREFIX}example.com`);
    expect(cached?.customMetadata).toMatchObject({
      status: "ok",
      mime: "image/svg+xml",
      sourceUrl: "https://example.com/icon.svg",
    });
    expect(cached?.httpMetadata?.contentType).toBe("image/svg+xml");

    const callsAfterFirst = fetchMock.mock.calls.length;
    const again = await iconRequest(app, env, "https://example.com/docs");
    expect(again.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("抓不到图标时 404 并写负缓存，二次请求不再回源", async () => {
    seedContent(env, [{ id: "l1", url: "https://nope.example/" }]);
    fetchMock.mockImplementation(async () => NOT_FOUND());

    const res = await iconRequest(app, env, "https://nope.example/");
    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ error: "icon not found" });
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("vary")).toBe("Cookie");
    expect(
      r2.objects.get(`${ICON_CACHE_PREFIX}nope.example`)?.customMetadata
        ?.status,
    ).toBe("none");
    // 1 次 HTML + 4 次根文件探测
    expect(fetchMock.mock.calls.length).toBe(5);

    const again = await iconRequest(app, env, "https://nope.example/");
    expect(again.status).toBe(404);
    expect(fetchMock.mock.calls.length).toBe(5);
  });

  it("未登记的 host 直接 404，且不发起任何外部请求", async () => {
    seedContent(env, [{ id: "l1", url: "https://example.com/" }]);
    const res = await iconRequest(app, env, "https://unknown.example/");
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("只出现在私有链接里的 host：匿名 404，带会话 200", async () => {
    seedContent(env, [
      { id: "l1", url: "https://secret.example/", visibility: "private" },
    ]);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://secret.example/") return htmlResponse("");
      if (input === "https://secret.example/favicon.ico") {
        return bytesResponse(ICO_BYTES, "image/x-icon");
      }
      return NOT_FOUND();
    });

    const anonymous = await iconRequest(app, env, "https://secret.example/");
    expect(anonymous.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    const cookie = await makeSessionCookie(env);
    const authed = await iconRequest(app, env, "https://secret.example/", {
      cookie,
    });
    expect(authed.status).toBe(200);
    expect(authed.headers.get("content-type")).toBe("image/x-icon");
  });

  it("私有分类里的 public 链接：匿名 404 且不出网，带会话 200", async () => {
    seedContent(
      env,
      [{ id: "l1", url: "https://hidden.example/", categoryId: "cat-hidden" }],
      [],
      [{ id: "cat-hidden", visibility: "private" }],
    );
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://hidden.example/") return htmlResponse("");
      if (input === "https://hidden.example/favicon.ico") {
        return bytesResponse(ICO_BYTES, "image/x-icon");
      }
      return NOT_FOUND();
    });

    const anonymous = await iconRequest(app, env, "https://hidden.example/");
    expect(anonymous.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    const cookie = await makeSessionCookie(env);
    const authed = await iconRequest(app, env, "https://hidden.example/", {
      cookie,
    });
    expect(authed.status).toBe(200);
    expect(authed.headers.get("vary")).toBe("Cookie");
  });

  it("搜索引擎的 host 匿名也能取图", async () => {
    seedContent(
      env,
      [],
      [{ id: "e1", urlTemplate: "https://www.google.com/search?q={q}" }],
    );
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://www.google.com/") return htmlResponse("");
      if (input === "https://www.google.com/favicon.ico") {
        return bytesResponse(PNG_BYTES, "image/png");
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://www.google.com/search?q=");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("跨 host 的图标声明被忽略，回落到根文件", async () => {
    seedContent(env, [{ id: "l1", url: "https://cdn.example/" }]);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://cdn.example/") {
        return htmlResponse(
          '<link rel="icon" href="https://assets.other.net/i.png">',
        );
      }
      if (input === "https://cdn.example/favicon.ico") {
        return bytesResponse(ICO_BYTES, "image/x-icon");
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://cdn.example/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).not.toContain("https://assets.other.net/i.png");
    for (const url of urls) {
      expect(url.startsWith("https://cdn.example/")).toBe(true);
    }
  });

  it("声明指向 HTML 页时跳过，继续试下一个候选", async () => {
    seedContent(env, [{ id: "l1", url: "https://page.example/" }]);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://page.example/") {
        return htmlResponse('<link rel="icon" href="/soft-404.png">');
      }
      if (input === "https://page.example/soft-404.png") {
        return htmlResponse("<html>not an image</html>");
      }
      if (input === "https://page.example/favicon.png") {
        return bytesResponse(PNG_BYTES, "image/png");
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://page.example/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("超过体积上限的响应被丢弃，最终 404", async () => {
    seedContent(env, [{ id: "l1", url: "https://big.example/" }]);
    const huge = new Uint8Array(600 * 1024).fill(7);
    fetchMock.mockImplementation(
      async () =>
        new Response(huge, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );

    const res = await iconRequest(app, env, "https://big.example/");
    expect(res.status).toBe(404);
    expect(
      r2.objects.get(`${ICON_CACHE_PREFIX}big.example`)?.customMetadata?.status,
    ).toBe("none");
  });

  it("跨域 3xx 不跟随：Location 落到别的 host 就当该候选失败", async () => {
    seedContent(env, [{ id: "l1", url: "https://redirect.example/" }]);
    fetchMock.mockImplementation(async (input: string) =>
      input === "https://redirect.example/"
        ? new Response("", {
            status: 302,
            headers: { location: "https://cdn.elsewhere.net/favicon.ico" },
          })
        : NOT_FOUND(),
    );

    const res = await iconRequest(app, env, "https://redirect.example/");
    expect(res.status).toBe(404);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0]).startsWith("https://redirect.example/")).toBe(
        true,
      );
    }
  });

  it("HTML 跟随同域重定向后，相对路径图标按新路径解", async () => {
    seedContent(env, [{ id: "l1", url: "https://rel.example/" }]);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://rel.example/") {
        return new Response("", {
          status: 302,
          headers: { location: "/sub/dir/index.html" },
        });
      }
      if (input === "https://rel.example/sub/dir/index.html") {
        return htmlResponse('<link rel="icon" href="pic.png">');
      }
      if (input === "https://rel.example/sub/dir/pic.png") {
        return bytesResponse(PNG_BYTES, "image/png");
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://rel.example/");
    expect(res.status).toBe(200);
    expect(
      r2.objects.get(`${ICON_CACHE_PREFIX}rel.example`)?.customMetadata
        ?.sourceUrl,
    ).toBe("https://rel.example/sub/dir/pic.png");
  });

  it("带 <script> 的第三方 SVG 也带沙箱 CSP，直接导航不会在本站执行脚本", async () => {
    seedContent(env, [{ id: "l1", url: "https://evil.example/" }]);
    const sneaky = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://evil.example/") return htmlResponse("");
      if (input === "https://evil.example/favicon.svg") {
        return bytesResponse(sneaky, "image/svg+xml");
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://evil.example/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("同域 302 跟随：Location 仍在同一 origin 时跟过去取图", async () => {
    seedContent(env, [{ id: "l1", url: "https://www.engine.example/" }]);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://www.engine.example/") {
        return new Response("", {
          status: 302,
          headers: { location: "/home?hl=zh-CN" },
        });
      }
      if (input === "https://www.engine.example/home?hl=zh-CN") {
        return htmlResponse("");
      }
      if (input === "https://www.engine.example/favicon.ico") {
        return new Response("", {
          status: 302,
          headers: { location: "https://www.engine.example/v2/favicon.ico" },
        });
      }
      if (input === "https://www.engine.example/v2/favicon.ico") {
        return bytesResponse(ICO_BYTES, "image/x-icon");
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://www.engine.example/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    // 落缓存的来源记的是跟随重定向后的最终地址。
    expect(
      r2.objects.get(`${ICON_CACHE_PREFIX}www.engine.example`)?.customMetadata
        ?.sourceUrl,
    ).toBe("https://www.engine.example/v2/favicon.ico");
  });

  it("同域重定向最多跟 2 跳，第 3 次响应就停", async () => {
    seedContent(env, [{ id: "l1", url: "https://loop.example/" }]);
    fetchMock.mockImplementation(async (input: string) => {
      const hop = Number(new URL(String(input)).searchParams.get("hop") ?? 0);
      return new Response("", {
        status: 302,
        headers: { location: `https://loop.example/?hop=${hop + 1}` },
      });
    });

    const res = await iconRequest(app, env, "https://loop.example/");
    expect(res.status).toBe(404);

    // 每个候选恰好 1 次原始请求 + 2 跳 = 3 次；共 1 个 HTML + 4 个根文件。
    expect(fetchMock.mock.calls.length).toBe(5 * 3);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    // 第 4 次（hop=3）从未发生，说明跳数上限确实生效。
    expect(urls.some((url) => url.includes("hop=3"))).toBe(false);
    expect(urls.filter((url) => url === "https://loop.example/")).toHaveLength(
      1,
    );
  });

  it("重定向目标只放行同一个 host：相对路径放行，跨域 / 降级 http 拒绝", () => {
    const current = "https://example.com/favicon.ico";
    expect(sameHostRedirect("/next/icon.png", current, "example.com")).toBe(
      "https://example.com/next/icon.png",
    );
    // http → https 升级允许
    expect(
      sameHostRedirect(
        "https://example.com/icon.ico",
        "http://example.com/favicon.ico",
        "example.com",
      ),
    ).toBe("https://example.com/icon.ico");
    // https → http 降级拒绝
    expect(
      sameHostRedirect("http://example.com/icon.ico", current, "example.com"),
    ).toBeNull();
    // 跨 host（含子域 / CDN）一律拒绝
    expect(
      sameHostRedirect(
        "https://other.example/icon.png",
        current,
        "example.com",
      ),
    ).toBeNull();
    expect(
      sameHostRedirect(
        "https://cdn.example.com/icon.png",
        current,
        "example.com",
      ),
    ).toBeNull();
    // 非默认端口、缺 location
    expect(
      sameHostRedirect(
        "https://example.com:8443/i.png",
        current,
        "example.com",
      ),
    ).toBeNull();
    expect(sameHostRedirect(null, current, "example.com")).toBeNull();
  });

  it("缓存过期时先回旧图，后台重抓并更新缓存", async () => {
    seedContent(env, [{ id: "l1", url: "https://stale.example/" }]);
    const staleAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    r2.objects.set(`${ICON_CACHE_PREFIX}stale.example`, {
      bytes: PNG_BYTES,
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        status: "ok",
        mime: "image/png",
        sourceUrl: "https://stale.example/old.png",
        fetchedAt: staleAt.toISOString(),
      },
      uploaded: staleAt,
    });
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://stale.example/") {
        return htmlResponse('<link rel="icon" href="/new.ico">');
      }
      if (input === "https://stale.example/new.ico") {
        return bytesResponse(ICO_BYTES, "image/x-icon");
      }
      return NOT_FOUND();
    });

    const res = await iconRequest(app, env, "https://stale.example/");
    expect(res.status).toBe(200);
    // 过期也先回旧结果，页面不等重抓。
    expect(res.headers.get("content-type")).toBe("image/png");

    await vi.waitFor(() => {
      expect(
        r2.objects.get(`${ICON_CACHE_PREFIX}stale.example`)?.customMetadata
          ?.sourceUrl,
      ).toBe("https://stale.example/new.ico");
    });
  });

  it("后台刷新失败不会把在用的图标改写成负缓存", async () => {
    seedContent(env, [{ id: "l1", url: "https://flaky.example/" }]);
    const staleAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const key = `${ICON_CACHE_PREFIX}flaky.example`;
    r2.objects.set(key, {
      bytes: PNG_BYTES,
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        status: "ok",
        mime: "image/png",
        sourceUrl: "https://flaky.example/old.png",
        fetchedAt: staleAt.toISOString(),
      },
      uploaded: staleAt,
    });
    // 站点这会儿挂了：所有候选都 503。
    fetchMock.mockImplementation(async () => new Response("", { status: 503 }));

    const first = await iconRequest(app, env, "https://flaky.example/");
    expect(first.status).toBe(200);

    // 后台刷新跑完：抓取失败，但缓存必须还是那张好图（不是 none）。
    await vi.waitFor(() => {
      expect(r2.objects.get(key)?.customMetadata?.fetchedAt).not.toBe(
        staleAt.toISOString(),
      );
    });
    const cached = r2.objects.get(key);
    expect(cached?.customMetadata?.status).toBe("ok");
    expect(cached?.customMetadata?.mime).toBe("image/png");
    expect(cached?.customMetadata?.sourceUrl).toBe(
      "https://flaky.example/old.png",
    );
    expect(Array.from(cached?.bytes ?? [])).toEqual(Array.from(PNG_BYTES));

    // 紧随其后的请求仍然拿得到图，而不是 404。
    const second = await iconRequest(app, env, "https://flaky.example/");
    expect(second.status).toBe(200);
    expect(second.headers.get("content-type")).toBe("image/png");
  });

  it("同一 host 的并发请求只抓一次", async () => {
    seedContent(env, [
      { id: "l1", url: "https://example.com/a" },
      { id: "l2", url: "https://example.com/b" },
    ]);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "https://example.com/") return htmlResponse("");
      if (input === "https://example.com/favicon.ico") {
        return bytesResponse(ICO_BYTES, "image/x-icon");
      }
      return NOT_FOUND();
    });

    const [a, b] = await Promise.all([
      iconRequest(app, env, "https://example.com/a"),
      iconRequest(app, env, "https://example.com/b"),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const htmlCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "https://example.com/",
    );
    expect(htmlCalls.length).toBe(1);
  });

  it("不读也不改写 links.icon_url（手动图标仍由前端直连）", async () => {
    seedContent(env, [{ id: "l1", url: "https://manual.example/" }]);
    sql(env)
      .prepare("UPDATE links SET icon_url = ? WHERE id = ?")
      .run("https://manual.example/hand.png", "l1");
    fetchMock.mockImplementation(async (input: string) =>
      input === "https://manual.example/"
        ? htmlResponse('<link rel="icon" href="/real.ico">')
        : input === "https://manual.example/real.ico"
          ? bytesResponse(ICO_BYTES, "image/x-icon")
          : NOT_FOUND(),
    );

    const res = await iconRequest(app, env, "https://manual.example/");
    expect(res.status).toBe(200);
    expect(
      r2.objects.get(`${ICON_CACHE_PREFIX}manual.example`)?.customMetadata
        ?.sourceUrl,
    ).toBe("https://manual.example/real.ico");
    const row = sql(env)
      .prepare("SELECT icon_url FROM links WHERE id = ?")
      .get("l1") as { icon_url: string };
    expect(row.icon_url).toBe("https://manual.example/hand.png");
  });

  it("R2 未绑定时仍然回图（不缓存）", async () => {
    const noR2 = makeEnv({ R2: undefined as unknown as R2Bucket });
    await runMigrations(noR2);
    seedContent(noR2, [{ id: "l1", url: "https://example.com/" }]);
    fetchMock.mockImplementation(async (input: string) =>
      input === "https://example.com/"
        ? htmlResponse('<link rel="icon" href="/i.png">')
        : input === "https://example.com/i.png"
          ? bytesResponse(PNG_BYTES, "image/png")
          : NOT_FOUND(),
    );

    const res = await iconRequest(makeApp(), noR2, "https://example.com/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("缺 url / 非法 url 返回 400", async () => {
    const missing = await app.request("/api/icon", {}, env);
    expect(missing.status).toBe(400);
    expect(await readJson(missing)).toEqual({
      error: "url must be an absolute http(s) URL",
    });

    const ftp = await app.request(
      `/api/icon?url=${encodeURIComponent("ftp://example.com/")}`,
      {},
      env,
    );
    expect(ftp.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("内部缓存的保留前缀不经 /assets/* 公开", async () => {
    r2.objects.set(`${ICON_CACHE_PREFIX}example.com`, {
      bytes: PNG_BYTES,
      httpMetadata: { contentType: "image/png" },
      customMetadata: { status: "ok", mime: "image/png", fetchedAt: "now" },
    });

    const res = await app.request(
      `/assets/${ICON_CACHE_PREFIX}example.com`,
      {},
      env,
    );
    expect(res.status).toBe(404);
  });
});
