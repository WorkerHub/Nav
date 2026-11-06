import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  applyMigrationList,
  runMigrations,
} from "../src/lib/migrations-runner";
import { getMigrations } from "../src/lib/migrations";
import { publicRoutes } from "../src/routes/public";
import { privateRoutes } from "../src/routes/private";
import { adminRoutes } from "../src/routes/admin";
import { authRoutes } from "../src/routes/auth";
import type { Env } from "../src/types";
import { makeEnv, readJson, type SqliteD1 } from "./helpers";

const SETUP_SECRET = "test-setup-secret";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  app.route("/api/public", publicRoutes);
  app.route("/api/private", privateRoutes);
  app.route("/api/admin", adminRoutes);
  return app;
}

async function ownerCookie(app: Hono, env: Env): Promise<string> {
  const res = await app.request(
    "/api/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({ username: "owner", password: "password123" }),
      headers: {
        "content-type": "application/json",
        "X-Setup-Secret": SETUP_SECRET,
      },
    },
    env,
  );
  expect(res.status).toBe(201);
  return res.headers.get("set-cookie") ?? "";
}

function adminRequest(
  app: Hono,
  env: Env,
  cookie: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return app.request(
    path,
    {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", cookie },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
  );
}

function sqliteOf(env: Env): SqliteD1["db"] {
  return (env.DB as unknown as SqliteD1).db;
}

function count(env: Env, sql: string, ...args: unknown[]): number {
  return (
    sqliteOf(env)
      .prepare(sql)
      .get(...(args as never[])) as { n: number }
  ).n;
}

const NOW = "2026-11-06T00:00:00.000Z";

function insertSceneRow(
  env: Env,
  scene: {
    id: string;
    name: string;
    sortOrder: number;
    isDefault?: boolean;
  },
): void {
  sqliteOf(env)
    .prepare(
      "INSERT INTO scenes (id, name, icon, sort_order, is_default, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
    )
    .run(
      scene.id,
      scene.name,
      scene.sortOrder,
      scene.isDefault ? 1 : 0,
      NOW,
      NOW,
    );
}

function insertCategoryRow(
  env: Env,
  category: {
    id: string;
    name: string;
    sortOrder: number;
    sceneId?: string | null;
    visibility?: "public" | "private";
  },
): void {
  sqliteOf(env)
    .prepare(
      "INSERT INTO categories (id, name, icon, sort_order, visibility, scene_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
    )
    .run(
      category.id,
      category.name,
      category.sortOrder,
      category.visibility ?? "public",
      category.sceneId === undefined ? "scene_default" : category.sceneId,
      NOW,
      NOW,
    );
}

/** nav v1 row: the pre-schema_v2 categories table has no scene_id column. */
function insertLegacyCategoryRow(env: Env, id: string, name: string): void {
  sqliteOf(env)
    .prepare(
      "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES (?, ?, NULL, 0, 'public', ?, ?)",
    )
    .run(id, name, NOW, NOW);
}

function insertLinkRow(
  env: Env,
  link: { id: string; categoryId: string; visibility?: "public" | "private" },
): void {
  sqliteOf(env)
    .prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?)",
    )
    .run(
      link.id,
      link.categoryId,
      link.id,
      `https://${link.id}.example.com`,
      link.visibility ?? "public",
      NOW,
      NOW,
    );
}

describe("schema_v2 migration (scenes)", () => {
  it("creates scenes, seeds the single default and backfills legacy categories", async () => {
    const env = makeEnv();
    // Simulate a nav v1 database: schema_v1 applied, one category, no scenes.
    const v1 = getMigrations("")[0];
    if (!v1) throw new Error("schema_v1 missing");
    await applyMigrationList(env.DB, "", [v1]);
    insertLegacyCategoryRow(env, "legacy", "Legacy");

    const result = await runMigrations(env);
    expect(result.migrations).toEqual([
      { name: "schema_v1", status: "skipped" },
      { name: "schema_v2", status: "applied" },
    ]);

    const scenes = sqliteOf(env).prepare("SELECT * FROM scenes").all() as Array<
      Record<string, unknown>
    >;
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      id: "scene_default",
      name: "通用",
      icon: null,
      sort_order: 0,
      is_default: 1,
    });
    expect(scenes[0]?.created_at).toBeTruthy();

    const category = sqliteOf(env)
      .prepare("SELECT scene_id FROM categories WHERE id = 'legacy'")
      .get() as { scene_id: string };
    expect(category.scene_id).toBe("scene_default");

    const indexes = sqliteOf(env)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row: { name: string }) => row.name);
    expect(indexes).toContain("idx_scenes_single_default");
    expect(indexes).toContain("idx_categories_scene_id");
  });

  it("prefixes the scenes table, indexes and seed id like every other table", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await runMigrations(env);

    const tables = sqliteOf(env)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row: { name: string }) => row.name);
    expect(tables).toContain("nav_scenes");

    const indexes = sqliteOf(env)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row: { name: string }) => row.name);
    expect(indexes).toContain("idx_nav_scenes_single_default");
    expect(indexes).toContain("idx_nav_categories_scene_id");

    expect(
      count(
        env,
        "SELECT COUNT(*) AS n FROM nav_scenes WHERE id = 'scene_default' AND is_default = 1",
      ),
    ).toBe(1);
  });

  it("rejects a second default scene at the database level", async () => {
    const env = makeEnv();
    await runMigrations(env);

    expect(() =>
      sqliteOf(env)
        .prepare(
          "INSERT INTO scenes (id, name, icon, sort_order, is_default, created_at, updated_at) VALUES ('second', 'x', NULL, 1, 1, ?, ?)",
        )
        .run(NOW, NOW),
    ).toThrow();
  });
});

describe("site data DTOs carry scenes + category sceneId", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await ownerCookie(app, env);

    insertSceneRow(env, { id: "scene_work", name: "工作", sortOrder: 1 });
    insertSceneRow(env, {
      id: "scene_private",
      name: "私密场景",
      sortOrder: 2,
    });

    insertCategoryRow(env, {
      id: "cat-default",
      name: "通用分类",
      sortOrder: 0,
    });
    insertCategoryRow(env, {
      id: "cat-work",
      name: "工作分类",
      sortOrder: 0,
      sceneId: "scene_work",
    });
    insertCategoryRow(env, {
      id: "cat-legacy",
      name: "存量空场景",
      sortOrder: 1,
      sceneId: null,
    });
    // D1 does not enforce foreign keys, so a dangling scene_id can exist in
    // production; node:sqlite does enforce them, so turn the check off for this
    // one defensive-path row.
    sqliteOf(env).exec("PRAGMA foreign_keys = OFF");
    insertCategoryRow(env, {
      id: "cat-dangling",
      name: "悬空场景",
      sortOrder: 2,
      sceneId: "ghost",
    });
    sqliteOf(env).exec("PRAGMA foreign_keys = ON");
    insertCategoryRow(env, {
      id: "cat-private",
      name: "私密分类",
      sortOrder: 0,
      sceneId: "scene_private",
      visibility: "private",
    });

    insertLinkRow(env, { id: "link-default", categoryId: "cat-default" });
    insertLinkRow(env, { id: "link-work", categoryId: "cat-work" });
    insertLinkRow(env, {
      id: "link-private",
      categoryId: "cat-private",
      visibility: "private",
    });
  });

  it("GET /api/public returns every scene (incl. private-only ones) in sort order", async () => {
    const res = await app.request("/api/public", {}, env);
    expect(res.status).toBe(200);
    const body = await readJson(res);

    expect(body.scenes).toEqual([
      {
        id: "scene_default",
        name: "通用",
        icon: null,
        sortOrder: 0,
        isDefault: true,
      },
      {
        id: "scene_work",
        name: "工作",
        icon: null,
        sortOrder: 1,
        isDefault: false,
      },
      {
        id: "scene_private",
        name: "私密场景",
        icon: null,
        sortOrder: 2,
        isDefault: false,
      },
    ]);

    // Private data stays hidden, but the scene list itself is complete.
    expect(JSON.stringify(body)).not.toContain("私密分类");
    expect(body.categories.map((cat: { id: string }) => cat.id)).toEqual([
      "cat-default",
      "cat-work",
      "cat-legacy",
      "cat-dangling",
    ]);

    const byId = Object.fromEntries(
      body.categories.map((cat: { id: string; sceneId: string }) => [
        cat.id,
        cat.sceneId,
      ]),
    );
    expect(byId["cat-default"]).toBe("scene_default");
    expect(byId["cat-work"]).toBe("scene_work");
    // NULL / dangling scene ids normalise to the default scene.
    expect(byId["cat-legacy"]).toBe("scene_default");
    expect(byId["cat-dangling"]).toBe("scene_default");
  });

  it("GET /api/private carries full data with sceneId, no-store unchanged", async () => {
    const res = await app.request("/api/private", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await readJson(res);

    expect(body.scenes).toHaveLength(3);
    const privateCat = body.categories.find(
      (cat: { id: string }) => cat.id === "cat-private",
    );
    expect(privateCat.sceneId).toBe("scene_private");
    expect(privateCat.links).toHaveLength(1);
  });

  it("admin GET /api/admin/categories returns the normalised sceneId", async () => {
    const res = await adminRequest(app, env, cookie, "/api/admin/categories");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const byId = Object.fromEntries(
      body.categories.map((cat: { id: string; sceneId: string }) => [
        cat.id,
        cat.sceneId,
      ]),
    );
    expect(byId["cat-work"]).toBe("scene_work");
    expect(byId["cat-legacy"]).toBe("scene_default");
    expect(byId["cat-dangling"]).toBe("scene_default");
  });
});

describe("admin scenes CRUD", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await ownerCookie(app, env);
  });

  it("requires a session on every scene endpoint", async () => {
    for (const [path, init] of [
      ["/api/admin/scenes", {}],
      ["/api/admin/scenes", { method: "POST" }],
      ["/api/admin/scenes/x", { method: "PUT" }],
      ["/api/admin/scenes/x", { method: "DELETE" }],
      ["/api/admin/scenes/reorder", { method: "POST" }],
    ] as Array<[string, RequestInit]>) {
      const res = await app.request(path, init, env);
      expect(res.status).toBe(401);
      expect(await readJson(res)).toEqual({ error: "unauthorized" });
    }
  });

  it("GET returns the seeded default scene with timestamps", async () => {
    const res = await adminRequest(app, env, cookie, "/api/admin/scenes");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.scenes).toHaveLength(1);
    expect(body.scenes[0]).toMatchObject({
      id: "scene_default",
      name: "通用",
      icon: null,
      sortOrder: 0,
      isDefault: true,
    });
    expect(body.scenes[0].createdAt).toBeTruthy();
    expect(body.scenes[0].updatedAt).toBeTruthy();
  });

  it("POST validates the name and appends to the end by default", async () => {
    const missing = await adminRequest(app, env, cookie, "/api/admin/scenes", {
      method: "POST",
      body: { icon: "icon" },
    });
    expect(missing.status).toBe(400);
    expect(await readJson(missing)).toEqual({ error: "name is required" });

    const blank = await adminRequest(app, env, cookie, "/api/admin/scenes", {
      method: "POST",
      body: { name: "   " },
    });
    expect(blank.status).toBe(400);
    expect(await readJson(blank)).toEqual({ error: "name is required" });

    const created = await adminRequest(app, env, cookie, "/api/admin/scenes", {
      method: "POST",
      body: { name: "  工作  ", icon: 42, isDefault: true },
    });
    expect(created.status).toBe(201);
    const body = await readJson(created);
    expect(body).toMatchObject({
      name: "工作",
      icon: null,
      sortOrder: 1,
      isDefault: false,
    });
    expect(body.id).toBeTruthy();
    expect(body.createdAt).toBeTruthy();

    // isDefault in the payload is read-only and never creates a second default.
    expect(
      count(env, "SELECT COUNT(*) AS n FROM scenes WHERE is_default = 1"),
    ).toBe(1);
  });

  it("POST honours an explicit sortOrder and requires string icon only", async () => {
    const res = await adminRequest(app, env, cookie, "/api/admin/scenes", {
      method: "POST",
      body: { name: "阅读", icon: "book", sortOrder: 7 },
    });
    expect(res.status).toBe(201);
    expect(await readJson(res)).toMatchObject({
      name: "阅读",
      icon: "book",
      sortOrder: 7,
      isDefault: false,
    });
  });

  it("PUT renames/re-icons/sorts and silently ignores isDefault", async () => {
    const created = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/scenes", {
        method: "POST",
        body: { name: "工作" },
      }),
    );

    const updated = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/scenes/${created.id}`,
      {
        method: "PUT",
        body: {
          name: "  办公  ",
          icon: 7,
          sortOrder: 3,
          isDefault: true,
        },
      },
    );
    expect(updated.status).toBe(200);
    expect(await readJson(updated)).toMatchObject({
      id: created.id,
      name: "办公",
      icon: null,
      sortOrder: 3,
      isDefault: false,
    });
    expect(
      count(env, "SELECT COUNT(*) AS n FROM scenes WHERE is_default = 1"),
    ).toBe(1);

    const empty = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/scenes/${created.id}`,
      { method: "PUT", body: { name: "  " } },
    );
    expect(empty.status).toBe(400);
    expect(await readJson(empty)).toEqual({ error: "name must not be empty" });

    const missing = await adminRequest(
      app,
      env,
      cookie,
      "/api/admin/scenes/nope",
      { method: "PUT", body: { name: "x" } },
    );
    expect(missing.status).toBe(404);
    expect(await readJson(missing)).toEqual({ error: "not found" });
  });

  it("the default scene can be renamed/sorted but not deleted", async () => {
    const renamed = await adminRequest(
      app,
      env,
      cookie,
      "/api/admin/scenes/scene_default",
      { method: "PUT", body: { name: "首页" } },
    );
    expect(renamed.status).toBe(200);
    expect(await readJson(renamed)).toMatchObject({
      id: "scene_default",
      name: "首页",
      isDefault: true,
    });

    // Default detection is by is_default, never by the name or id.
    const del = await adminRequest(
      app,
      env,
      cookie,
      "/api/admin/scenes/scene_default",
      { method: "DELETE" },
    );
    expect(del.status).toBe(400);
    expect(await readJson(del)).toEqual({
      error: "default scene cannot be deleted",
    });

    const missing = await adminRequest(
      app,
      env,
      cookie,
      "/api/admin/scenes/nope",
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);
    expect(await readJson(missing)).toEqual({ error: "not found" });
  });

  it("reorder rewrites sort_order in payload order", async () => {
    const work = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/scenes", {
        method: "POST",
        body: { name: "工作" },
      }),
    );
    const life = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/scenes", {
        method: "POST",
        body: { name: "生活" },
      }),
    );

    const res = await adminRequest(
      app,
      env,
      cookie,
      "/api/admin/scenes/reorder",
      { method: "POST", body: { ids: [life.id, "scene_default", work.id] } },
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ success: true });

    const list = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/scenes"),
    );
    expect(list.scenes.map((scene: { name: string }) => scene.name)).toEqual([
      "生活",
      "通用",
      "工作",
    ]);

    const bad = await adminRequest(
      app,
      env,
      cookie,
      "/api/admin/scenes/reorder",
      { method: "POST", body: { ids: "x" } },
    );
    expect(bad.status).toBe(400);
    expect(await readJson(bad)).toEqual({
      error: "ids must be an array of scene ids",
    });
  });

  it("DELETE moves categories (and their links) into the default scene", async () => {
    const work = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/scenes", {
        method: "POST",
        body: { name: "工作" },
      }),
    );

    // Default scene already has a category at sort_order 5 → move target starts at 6.
    insertCategoryRow(env, {
      id: "cat-default",
      name: "通用分类",
      sortOrder: 5,
    });
    insertCategoryRow(env, {
      id: "cat-work-a",
      name: "工作 A",
      sortOrder: 0,
      sceneId: work.id,
    });
    insertCategoryRow(env, {
      id: "cat-work-b",
      name: "工作 B",
      sortOrder: 3,
      sceneId: work.id,
    });
    insertLinkRow(env, { id: "link-a", categoryId: "cat-work-a" });

    const res = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/scenes/${work.id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ success: true });

    expect(
      count(env, "SELECT COUNT(*) AS n FROM scenes WHERE id = ?", work.id),
    ).toBe(0);
    expect(
      sqliteOf(env)
        .prepare(
          "SELECT id, scene_id, sort_order FROM categories WHERE id IN ('cat-work-a', 'cat-work-b') ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "cat-work-a", scene_id: "scene_default", sort_order: 6 },
      { id: "cat-work-b", scene_id: "scene_default", sort_order: 9 },
    ]);
    // Links are untouched — they follow their category.
    expect(
      count(
        env,
        "SELECT COUNT(*) AS n FROM links WHERE id = 'link-a' AND category_id = 'cat-work-a'",
      ),
    ).toBe(1);
  });

  it("DELETE works for an empty scene even when the default scene is empty", async () => {
    // No category in the default scene → COALESCE(MAX, -1) + 1 = 0 base.
    const work = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/scenes", {
        method: "POST",
        body: { name: "工作" },
      }),
    );
    const res = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/scenes/${work.id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(
      count(env, "SELECT COUNT(*) AS n FROM scenes WHERE id = ?", work.id),
    ).toBe(0);
  });
});

describe("admin categories accept sceneId (incl. moving a category)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;
  let workId: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await ownerCookie(app, env);
    const work = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/scenes", {
        method: "POST",
        body: { name: "工作" },
      }),
    );
    workId = work.id;
  });

  it("POST without sceneId assigns the default scene", async () => {
    const res = await adminRequest(app, env, cookie, "/api/admin/categories", {
      method: "POST",
      body: { name: "默认分类" },
    });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.sceneId).toBe("scene_default");

    const list = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/categories"),
    );
    expect(list.categories[0].sceneId).toBe("scene_default");
  });

  it("POST with a valid sceneId assigns it, unknown sceneId is a 400", async () => {
    const ok = await adminRequest(app, env, cookie, "/api/admin/categories", {
      method: "POST",
      body: { name: "工作分类", sceneId: workId },
    });
    expect(ok.status).toBe(201);
    expect(await readJson(ok)).toMatchObject({
      name: "工作分类",
      sceneId: workId,
    });

    for (const sceneId of ["ghost", "", 7, null]) {
      const bad = await adminRequest(
        app,
        env,
        cookie,
        "/api/admin/categories",
        { method: "POST", body: { name: "x", sceneId } },
      );
      expect(bad.status).toBe(400);
      expect(await readJson(bad)).toEqual({
        error: "sceneId does not exist",
      });
    }
  });

  it("PUT sceneId moves the whole category and leaves its links alone", async () => {
    const cat = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/categories", {
        method: "POST",
        body: { name: "要搬的分类" },
      }),
    );
    insertLinkRow(env, { id: "moved-link", categoryId: cat.id });

    const moved = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/categories/${cat.id}`,
      { method: "PUT", body: { sceneId: workId } },
    );
    expect(moved.status).toBe(200);
    expect(await readJson(moved)).toMatchObject({
      id: cat.id,
      sceneId: workId,
    });

    expect(
      count(
        env,
        "SELECT COUNT(*) AS n FROM links WHERE id = 'moved-link' AND category_id = ?",
        cat.id,
      ),
    ).toBe(1);

    const publicBody = await readJson(
      await app.request("/api/public", {}, env),
    );
    expect(
      publicBody.categories.find((row: { id: string }) => row.id === cat.id)
        .sceneId,
    ).toBe(workId);

    const bad = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/categories/${cat.id}`,
      { method: "PUT", body: { sceneId: "ghost" } },
    );
    expect(bad.status).toBe(400);
    expect(await readJson(bad)).toEqual({ error: "sceneId does not exist" });
  });

  it("moving without sortOrder appends to the target scene; explicit sortOrder wins", async () => {
    // Target scene already has sort_order 5 → append at 6.
    insertCategoryRow(env, {
      id: "work-existing",
      name: "工作已有",
      sortOrder: 5,
      sceneId: workId,
    });
    const first = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/categories", {
        method: "POST",
        body: { name: "默认 A", sortOrder: 2 },
      }),
    );
    const moved = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/categories/${first.id}`,
      { method: "PUT", body: { sceneId: workId } },
    );
    expect(moved.status).toBe(200);
    expect(await readJson(moved)).toMatchObject({
      id: first.id,
      sceneId: workId,
      sortOrder: 6,
    });

    // An explicit position is kept verbatim instead of appended.
    const second = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/categories", {
        method: "POST",
        body: { name: "默认 B", sortOrder: 1 },
      }),
    );
    const placed = await adminRequest(
      app,
      env,
      cookie,
      `/api/admin/categories/${second.id}`,
      { method: "PUT", body: { sceneId: workId, sortOrder: 2 } },
    );
    expect(placed.status).toBe(200);
    expect(await readJson(placed)).toMatchObject({
      id: second.id,
      sceneId: workId,
      sortOrder: 2,
    });
  });

  it("category reorder only touches the submitted ids (scene-local by client contract)", async () => {
    const a = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/categories", {
        method: "POST",
        body: { name: "A", sceneId: workId },
      }),
    );
    const b = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/categories", {
        method: "POST",
        body: { name: "B", sceneId: workId },
      }),
    );
    const other = await readJson(
      await adminRequest(app, env, cookie, "/api/admin/categories", {
        method: "POST",
        body: { name: "Other" },
      }),
    );

    const res = await adminRequest(
      app,
      env,
      cookie,
      "/api/admin/categories/reorder",
      { method: "POST", body: { ids: [b.id, a.id] } },
    );
    expect(res.status).toBe(200);

    const rows = sqliteOf(env)
      .prepare(
        "SELECT id, sort_order FROM categories WHERE id IN (?, ?, ?) ORDER BY id",
      )
      .all(a.id, b.id, other.id) as Array<{ id: string; sort_order: number }>;
    const byId = Object.fromEntries(
      rows.map((row) => [row.id, row.sort_order]),
    );
    expect(byId[b.id]).toBe(0);
    expect(byId[a.id]).toBe(1);
    expect(byId[other.id]).toBe(0);
  });
});

describe("SqliteD1.batch transaction semantics", () => {
  it("commits all statements and rolls the whole batch back on error", async () => {
    const env = makeEnv();
    await runMigrations(env);
    const db = env.DB as unknown as SqliteD1;

    await db.batch([
      db
        .prepare(
          "INSERT INTO scenes (id, name, icon, sort_order, is_default, created_at, updated_at) VALUES ('batch-a', 'a', NULL, 1, 0, ?, ?)",
        )
        .bind(NOW, NOW),
      db
        .prepare(
          "INSERT INTO scenes (id, name, icon, sort_order, is_default, created_at, updated_at) VALUES ('batch-b', 'b', NULL, 2, 0, ?, ?)",
        )
        .bind(NOW, NOW),
    ]);
    expect(count(env, "SELECT COUNT(*) AS n FROM scenes")).toBe(3);

    await expect(
      db.batch([
        db
          .prepare(
            "INSERT INTO scenes (id, name, icon, sort_order, is_default, created_at, updated_at) VALUES ('batch-c', 'c', NULL, 3, 0, ?, ?)",
          )
          .bind(NOW, NOW),
        db
          .prepare(
            "INSERT INTO scenes (id, name, icon, sort_order, is_default, created_at, updated_at) VALUES ('batch-a', 'dup', NULL, 4, 0, ?, ?)",
          )
          .bind(NOW, NOW),
      ]),
    ).rejects.toThrow();

    // The first insert of the failed batch was rolled back.
    expect(count(env, "SELECT COUNT(*) AS n FROM scenes")).toBe(3);
    expect(
      count(env, "SELECT COUNT(*) AS n FROM scenes WHERE id = 'batch-c'"),
    ).toBe(0);
  });
});
