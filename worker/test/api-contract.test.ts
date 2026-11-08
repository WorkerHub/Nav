import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { runMigrations } from "../src/lib/migrations-runner";
import { publicRoutes } from "../src/routes/public";
import { privateRoutes } from "../src/routes/private";
import { adminRoutes } from "../src/routes/admin";
import { authRoutes } from "../src/routes/auth";
import type { Env } from "../src/types";
import { makeEnv, type SqliteD1, readJson } from "./helpers";

function setupRequest(app: Hono, env: Env): Promise<Response> {
  return app.request(
    "/api/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({ username: "owner", password: "password123" }),
      headers: {
        "content-type": "application/json",
        "X-Setup-Secret": "test-setup-secret",
      },
    },
    env,
  );
}

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  app.route("/api/public", publicRoutes);
  app.route("/api/private", privateRoutes);
  app.route("/api/admin", adminRoutes);
  return app;
}

async function seedContent(db: SqliteD1): Promise<void> {
  const now = new Date().toISOString();
  const sql = db.db;
  sql
    .prepare(
      "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("cat-public", "Public Cat", null, 0, "public", now, now);
  sql
    .prepare(
      "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("cat-private", "Private Cat", null, 1, "private", now, now);
  sql
    .prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "link-pub",
      "cat-public",
      "Public Link",
      "https://pub.example.com",
      null,
      null,
      0,
      "public",
      now,
      now,
    );
  sql
    .prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "link-priv",
      "cat-private",
      "Private Link",
      "https://priv.example.com",
      null,
      null,
      0,
      "private",
      now,
      now,
    );
  // Public link nested under a private category — stricter visibility wins.
  sql
    .prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "link-nested",
      "cat-private",
      "Nested Public Link",
      "https://nested.example.com",
      null,
      null,
      1,
      "public",
      now,
      now,
    );
  sql
    .prepare(
      "INSERT INTO search_engines (id, name, url_template, icon, sort_order, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "se-1",
      "Google",
      "https://www.google.com/search?q={q}",
      null,
      0,
      1,
      now,
      now,
    );
  sql
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run("site_title", "My Nav", now);
}

describe("public/private surface isolation", () => {
  let env: Env;
  let app: Hono;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    await seedContent(env.DB as unknown as SqliteD1);
  });

  it("GET /api/public contains no private categories or links", async () => {
    const res = await app.request("/api/public", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");

    const body = await readJson(res);
    const text = JSON.stringify(body);
    expect(text).not.toContain("Private Cat");
    expect(text).not.toContain("priv.example.com");
    // Public link inside a private category is also withheld.
    expect(text).not.toContain("Nested Public Link");
    expect(text).not.toContain("nested.example.com");

    expect(body.categories).toHaveLength(1);
    expect(body.categories[0].id).toBe("cat-public");
    expect(body.categories[0].links).toHaveLength(1);
    expect(body.settings.siteTitle).toBe("My Nav");
    expect(body.searchEngines).toHaveLength(1);
    expect(body.searchEngines[0].isDefault).toBe(true);
  });

  it("GET /api/private without a session returns 401 JSON with no-store", async () => {
    const res = await app.request("/api/private", {}, env);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await readJson(res);
    expect(body).toEqual({ error: "unauthorized" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("priv.example.com");
  });

  it("GET /api/admin/* without a session returns 401 JSON", async () => {
    for (const path of [
      "/api/admin/categories",
      "/api/admin/links",
      "/api/admin/settings",
    ]) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(401);
      expect(await readJson(res)).toEqual({ error: "unauthorized" });
    }
    const write = await app.request(
      "/api/admin/categories",
      {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(write.status).toBe(401);
    // 跨分类原子保存端点同口径（nav #28）
    const move = await app.request(
      "/api/admin/links/move",
      {
        method: "POST",
        body: JSON.stringify({ linkId: "x", categoryId: "y", ids: ["x"] }),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(move.status).toBe(401);
    expect(await readJson(move)).toEqual({ error: "unauthorized" });
  });
});

describe("setup flow", () => {
  let env: Env;
  let app: Hono;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
  });

  it("setup/status reports enabled before the owner exists", async () => {
    const full = new Hono();
    full.get("/api/setup/status", async (c) => {
      const db = (env.DB as unknown as SqliteD1).db;
      const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as {
        n: number;
      };
      return c.json({ enabled: row.n === 0 });
    });
    void app;
    const res = await full.request("/api/setup/status", {}, env);
    expect(await readJson(res)).toEqual({ enabled: true });
  });

  it("creates the single owner with the setup secret and closes afterwards", async () => {
    // wrong secret → 403
    const denied = await app.request(
      "/api/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({ username: "owner", password: "password123" }),
        headers: {
          "content-type": "application/json",
          "X-Setup-Secret": "nope",
        },
      },
      env,
    );
    expect(denied.status).toBe(403);

    const ok = await app.request(
      "/api/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({ username: "owner", password: "password123" }),
        headers: {
          "content-type": "application/json",
          "X-Setup-Secret": "test-setup-secret",
        },
      },
      env,
    );
    expect(ok.status).toBe(201);
    const body = await readJson(ok);
    expect(body.user.username).toBe("owner");
    expect(body.user.passwordHash).toBeUndefined();

    // setup closes
    const again = await app.request(
      "/api/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({ username: "owner2", password: "password123" }),
        headers: {
          "content-type": "application/json",
          "X-Setup-Secret": "test-setup-secret",
        },
      },
      env,
    );
    expect(again.status).toBe(403);

    const state = await app.request("/api/auth/setup", {}, env);
    expect(await readJson(state)).toEqual({ enabled: false });
  });

  it("deleting a category removes its links (no orphans)", async () => {
    const setupRes = await setupRequest(app, env);
    const cookie = setupRes.headers.get("set-cookie") ?? "";

    const cat = await app.request(
      "/api/admin/categories",
      {
        method: "POST",
        body: JSON.stringify({ name: "temp" }),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );
    const { id: catId } = await readJson(cat);
    await app.request(
      "/api/admin/links",
      {
        method: "POST",
        body: JSON.stringify({
          title: "t",
          url: "https://x.example.com",
          categoryId: catId,
        }),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );

    const del = await app.request(
      `/api/admin/categories/${catId}`,
      { method: "DELETE", headers: { cookie } },
      env,
    );
    expect(del.status).toBe(200);

    const links = await app.request(
      "/api/admin/links",
      { headers: { cookie } },
      env,
    );
    const body = await readJson(links);
    expect(body.links).toHaveLength(0);
  });

  it("admin link DTO includes visibility and timestamps (frozen contract)", async () => {
    const setupRes = await setupRequest(app, env);
    const cookie = setupRes.headers.get("set-cookie") ?? "";

    const cat = await app.request(
      "/api/admin/categories",
      {
        method: "POST",
        body: JSON.stringify({ name: "c" }),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );
    const { id: catId } = await readJson(cat);
    const link = await app.request(
      "/api/admin/links",
      {
        method: "POST",
        body: JSON.stringify({
          title: "t",
          url: "https://x.example.com",
          categoryId: catId,
          visibility: "private",
        }),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );
    const { id: linkId } = await readJson(link);

    const updated = await app.request(
      `/api/admin/links/${linkId}`,
      {
        method: "PUT",
        body: JSON.stringify({ title: "t2" }),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );
    expect(updated.status).toBe(200);
    const body = await readJson(updated);
    expect(body.visibility).toBe("private");
    expect(body.createdAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });

  it("reserved SPEC §5 columns exist on links", async () => {
    const db = (env.DB as unknown as SqliteD1).db;
    const cols = db
      .prepare("PRAGMA table_info(links)")
      .all()
      .map((r: any) => r.name);
    expect(cols).toContain("click_count");
    expect(cols).toContain("status");
    expect(cols).toContain("last_checked_at");
  });

  it("has no registration endpoint", async () => {
    const res = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("link edit: moving a link to another category (nav #17 move rule)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;
  let devCat: string;
  let readCat: string;

  const adminFetch = (path: string, init: RequestInit = {}) =>
    app.request(
      path,
      {
        ...init,
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );

  async function createCategory(name: string): Promise<string> {
    const res = await adminFetch("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return (await readJson(res)).id;
  }

  async function createLink(body: Record<string, unknown>): Promise<string> {
    const res = await adminFetch("/api/admin/links", {
      method: "POST",
      body: JSON.stringify({
        url: `https://example.com/${String(body.title)}`,
        ...body,
      }),
    });
    return (await readJson(res)).id;
  }

  /** 全量链接（后端按 sort_order, created_at 排序）。 */
  async function listLinks(): Promise<
    { id: string; categoryId: string; title: string; sortOrder: number }[]
  > {
    return (await readJson(await adminFetch("/api/admin/links"))).links;
  }

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = (await setupRequest(app, env)).headers.get("set-cookie") ?? "";
    devCat = await createCategory("开发");
    readCat = await createCategory("阅读");
  });

  it("appends the moved link to the end of the target category (global MAX+1)", async () => {
    const github = await createLink({
      title: "GitHub",
      categoryId: devCat,
      sortOrder: 0,
    });
    const mdn = await createLink({
      title: "MDN",
      categoryId: devCat,
      sortOrder: 1,
    });
    await createLink({ title: "少数派", categoryId: readCat, sortOrder: 2 });

    const res = await adminFetch(`/api/admin/links/${mdn}`, {
      method: "PUT",
      body: JSON.stringify({ categoryId: readCat }),
    });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      id: mdn,
      categoryId: readCat,
      sortOrder: 3,
    });

    const links = await listLinks();
    // 原分类里只剩没搬走的那个
    expect(
      links.filter((l) => l.categoryId === devCat).map((l) => l.title),
    ).toEqual(["GitHub"]);
    expect(links.find((l) => l.id === github)?.sortOrder).toBe(0);
    // 目标分类：搬到末尾，原有顺序不变
    expect(
      links.filter((l) => l.categoryId === readCat).map((l) => l.title),
    ).toEqual(["少数派", "MDN"]);
  });

  it("keeps the position untouched when categoryId is unchanged", async () => {
    const first = await createLink({
      title: "GitHub",
      categoryId: devCat,
      sortOrder: 0,
    });
    const second = await createLink({
      title: "MDN",
      categoryId: devCat,
      sortOrder: 1,
    });
    const third = await createLink({
      title: "少数派",
      categoryId: readCat,
      sortOrder: 2,
    });

    // 每次保存都原样带上当前 categoryId（前端如此），顺序不得被打乱
    const res = await adminFetch(`/api/admin/links/${first}`, {
      method: "PUT",
      body: JSON.stringify({ categoryId: devCat, title: "GitHub 改名" }),
    });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      id: first,
      categoryId: devCat,
      sortOrder: 0,
      title: "GitHub 改名",
    });

    const links = await listLinks();
    expect(links.map((l) => l.id)).toEqual([first, second, third]);
    expect(links.map((l) => l.sortOrder)).toEqual([0, 1, 2]);
  });

  it("keeps an explicit sortOrder verbatim instead of appending", async () => {
    await createLink({ title: "GitHub", categoryId: devCat, sortOrder: 0 });
    const mdn = await createLink({
      title: "MDN",
      categoryId: devCat,
      sortOrder: 4,
    });

    const res = await adminFetch(`/api/admin/links/${mdn}`, {
      method: "PUT",
      body: JSON.stringify({ categoryId: readCat, sortOrder: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      categoryId: readCat,
      sortOrder: 1,
    });
  });

  it("rejects an unknown categoryId with 400 and writes nothing", async () => {
    const github = await createLink({
      title: "GitHub",
      categoryId: devCat,
      sortOrder: 0,
    });

    const res = await adminFetch(`/api/admin/links/${github}`, {
      method: "PUT",
      body: JSON.stringify({ categoryId: "ghost", title: "改不动的标题" }),
    });
    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({
      error: "categoryId does not exist",
    });

    const links = await listLinks();
    expect(links.find((l) => l.id === github)).toMatchObject({
      title: "GitHub",
      categoryId: devCat,
      sortOrder: 0,
    });
  });
});

describe("link move: cross-category atomic save (nav #28 frozen contract)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;
  let devCat: string;
  let readCat: string;

  const adminFetch = (path: string, init: RequestInit = {}) =>
    app.request(
      path,
      {
        ...init,
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );

  async function createCategory(name: string): Promise<string> {
    const res = await adminFetch("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return (await readJson(res)).id;
  }

  async function createLink(body: Record<string, unknown>): Promise<string> {
    const res = await adminFetch("/api/admin/links", {
      method: "POST",
      body: JSON.stringify({
        url: `https://example.com/${String(body.title)}`,
        ...body,
      }),
    });
    return (await readJson(res)).id;
  }

  /** 全量链接（后端按 sort_order, created_at 排序）。 */
  async function listLinks(): Promise<
    { id: string; categoryId: string; title: string; sortOrder: number }[]
  > {
    return (await readJson(await adminFetch("/api/admin/links"))).links;
  }

  function sqlite(): SqliteD1["db"] {
    return (env.DB as unknown as SqliteD1).db;
  }

  /** 绕过接口直接读库：断言「什么都没写」时用。 */
  function rawLinks(): { id: string; categoryId: string; sortOrder: number }[] {
    return sqlite()
      .prepare(
        "SELECT id, category_id AS categoryId, sort_order AS sortOrder FROM links ORDER BY sort_order, created_at",
      )
      .all() as { id: string; categoryId: string; sortOrder: number }[];
  }

  const move = (body: unknown) =>
    adminFetch("/api/admin/links/move", {
      method: "POST",
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = (await setupRequest(app, env)).headers.get("set-cookie") ?? "";
    devCat = await createCategory("开发");
    readCat = await createCategory("阅读");
  });

  it("writes category and global order together, landing on the drop index", async () => {
    const a = await createLink({
      title: "A",
      categoryId: devCat,
      sortOrder: 0,
    });
    const b = await createLink({
      title: "B",
      categoryId: devCat,
      sortOrder: 1,
    });
    const c = await createLink({
      title: "C",
      categoryId: devCat,
      sortOrder: 2,
    });
    const d = await createLink({
      title: "D",
      categoryId: readCat,
      sortOrder: 3,
    });
    const e = await createLink({
      title: "E",
      categoryId: readCat,
      sortOrder: 4,
    });

    // 把 B 拖进「阅读」并落在 D 之后（下标 3），不是目标分类末尾。
    const ids = [a, c, d, b, e];
    const res = await move({ linkId: b, categoryId: readCat, ids });

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ success: true });

    const links = await listLinks();
    expect(links.map((l) => l.id)).toEqual(ids);
    expect(links.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(links.find((l) => l.id === b)?.categoryId).toBe(readCat);
    // 目标分类内次序来自 ids（落点即下标）：[D, B, E]，而非追加到末尾的 [D, E, B]
    expect(
      links.filter((l) => l.categoryId === readCat).map((l) => l.title),
    ).toEqual(["D", "B", "E"]);
    expect(
      links.filter((l) => l.categoryId === devCat).map((l) => l.title),
    ).toEqual(["A", "C"]);
  });

  it("also saves a pure reorder when categoryId is unchanged", async () => {
    const a = await createLink({
      title: "A",
      categoryId: devCat,
      sortOrder: 0,
    });
    const b = await createLink({
      title: "B",
      categoryId: devCat,
      sortOrder: 1,
    });
    const c = await createLink({
      title: "C",
      categoryId: devCat,
      sortOrder: 2,
    });

    const res = await move({ linkId: c, categoryId: devCat, ids: [c, a, b] });
    expect(res.status).toBe(200);

    const links = await listLinks();
    expect(links.map((l) => l.id)).toEqual([c, a, b]);
    expect(links.map((l) => l.sortOrder)).toEqual([0, 1, 2]);
    expect(links.every((l) => l.categoryId === devCat)).toBe(true);
  });

  it("rolls the whole batch back when any statement fails (no half save)", async () => {
    const a = await createLink({
      title: "A",
      categoryId: devCat,
      sortOrder: 0,
    });
    const b = await createLink({
      title: "B",
      categoryId: devCat,
      sortOrder: 1,
    });
    const c = await createLink({
      title: "C",
      categoryId: devCat,
      sortOrder: 2,
    });
    const d = await createLink({
      title: "D",
      categoryId: readCat,
      sortOrder: 3,
    });

    const before = rawLinks();
    // 让 C 的 sort_order 写入失败：分组那一句先跑过，也必须跟着回滚。
    sqlite().exec(
      `CREATE TRIGGER abort_link_order BEFORE UPDATE ON links
         WHEN NEW.id = '${c}' AND OLD.sort_order <> NEW.sort_order
       BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );

    const res = await move({
      linkId: b,
      categoryId: readCat,
      ids: [a, c, d, b],
    });
    expect(res.status).toBe(500);
    expect(await readJson(res)).toEqual({ error: "move failed" });

    expect(rawLinks()).toEqual(before);
  });

  it("rejects malformed payloads in the frozen order and writes nothing", async () => {
    const a = await createLink({
      title: "A",
      categoryId: devCat,
      sortOrder: 0,
    });
    const b = await createLink({
      title: "B",
      categoryId: devCat,
      sortOrder: 1,
    });
    const before = rawLinks();

    const cases: [unknown, number, string][] = [
      [{ categoryId: readCat, ids: [a] }, 400, "linkId is required"],
      [
        { linkId: "  ", categoryId: readCat, ids: [a] },
        400,
        "linkId is required",
      ],
      [{ linkId: a }, 400, "ids must be an array of link ids"],
      [{ linkId: a, ids: "nope" }, 400, "ids must be an array of link ids"],
      [{ linkId: a, ids: [a, 7] }, 400, "ids must be an array of link ids"],
      [{ linkId: a, ids: [b] }, 400, "ids must contain linkId exactly once"],
      [
        { linkId: a, ids: [a, b, a] },
        400,
        "ids must contain linkId exactly once",
      ],
      [
        { linkId: "ghost", categoryId: readCat, ids: ["ghost", a] },
        404,
        "not found",
      ],
      [
        { linkId: a, categoryId: "ghost", ids: [a, b] },
        400,
        "categoryId does not exist",
      ],
      [{ linkId: a, ids: [a, b] }, 400, "categoryId does not exist"],
    ];

    for (const [payload, status, error] of cases) {
      const res = await move(payload);
      expect(res.status, JSON.stringify(payload)).toBe(status);
      expect(await readJson(res)).toEqual({ error });
      expect(rawLinks()).toEqual(before);
    }
  });
});
