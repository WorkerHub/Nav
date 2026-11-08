import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { runMigrations } from "../src/lib/migrations-runner";
import { authRoutes } from "../src/routes/auth";
import { adminRoutes } from "../src/routes/admin";
import { publicRoutes } from "../src/routes/public";
import type { Env } from "../src/types";
import { makeEnv, readJson, type SqliteD1 } from "./helpers";

/**
 * `PUT /api/admin/settings` columns validation (contract: 0–12).
 *
 * `0` means "unconfigured": `GET /api/admin/settings` reports it on a fresh
 * database, so it has to be writable verbatim — otherwise reading a fresh
 * setting and saving it back fails with a 400.
 */

const OWNER_PASSWORD = "correct horse battery";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api/public", publicRoutes);
  return app;
}

async function signIn(app: Hono, env: Env): Promise<string> {
  const res = await app.request(
    "/api/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({ username: "owner", password: OWNER_PASSWORD }),
      headers: {
        "content-type": "application/json",
        "x-setup-secret": "test-setup-secret",
      },
    },
    env,
  );
  expect(res.status).toBe(201);
  return res.headers.get("set-cookie") ?? "";
}

function getSettings(app: Hono, env: Env, cookie: string): Promise<Response> {
  return app.request("/api/admin/settings", { headers: { cookie } }, env);
}

function putSettings(
  app: Hono,
  env: Env,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return app.request(
    "/api/admin/settings",
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie },
    },
    env,
  );
}

/** Raw stored value of the `columns` setting row, or `null` when absent. */
function storedColumns(env: Env): string | null {
  return storedSetting(env, "columns");
}

/** Raw stored value of an arbitrary settings row, or `null` when absent. */
function storedSetting(env: Env, key: string): string | null {
  const row = (env.DB as unknown as SqliteD1).db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

describe("PUT /api/admin/settings columns", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("round-trips columns=0 on a fresh database (GET 0 → PUT 0 → GET 0)", async () => {
    // Fresh D1: no columns row yet, so the contract-visible value is 0.
    const before = await readJson(await getSettings(app, env, cookie));
    expect(before.columns).toBe(0);

    const res = await putSettings(app, env, cookie, {
      columns: before.columns,
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).columns).toBe(0);

    // Stored verbatim — not coerced to a default column count.
    expect(storedColumns(env)).toBe("0");

    const after = await readJson(await getSettings(app, env, cookie));
    expect(after.columns).toBe(0);
  });

  it("keeps 0 when it is written together with other settings", async () => {
    const res = await putSettings(app, env, cookie, {
      siteTitle: "nav",
      backgroundUrl: "",
      logoUrl: "",
      columns: 0,
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toMatchObject({ siteTitle: "nav", columns: 0 });
    expect(storedColumns(env)).toBe("0");
  });

  it("accepts every value in 1–12 (existing range unchanged)", async () => {
    for (let columns = 1; columns <= 12; columns++) {
      const res = await putSettings(app, env, cookie, { columns });
      expect(res.status).toBe(200);
      expect((await readJson(res)).columns).toBe(columns);
      expect(storedColumns(env)).toBe(String(columns));
    }
  });

  it("still rejects values outside 0–12", async () => {
    await putSettings(app, env, cookie, { columns: 5 });

    for (const columns of [-1, 13, 100]) {
      const res = await putSettings(app, env, cookie, { columns });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "columns must be between 0 and 12",
      });
    }
    // A rejected write must not touch the stored value.
    expect(storedColumns(env)).toBe("5");
  });

  it("rejects non-numeric columns with the same 400", async () => {
    for (const columns of ["abc", "", null, true]) {
      const res = await putSettings(app, env, cookie, { columns });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "columns must be between 0 and 12",
      });
    }
  });
});

/**
 * `searchNewTab`（搜索在新标签页打开）：KV 键 `search_new_tab`，值 `"1"`/`"0"`。
 * 存量库无此键时 DTO 按 `true`（默认开）返回；公开端点同样带出该字段给前端。
 */
describe("settings searchNewTab (search_new_tab)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("defaults to true when the key is absent (admin + public DTO)", async () => {
    expect(storedSetting(env, "search_new_tab")).toBeNull();

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.searchNewTab).toBe(true);

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.searchNewTab).toBe(true);
  });

  it('round-trips false/true as "0"/"1" and mirrors into /api/public', async () => {
    let res = await putSettings(app, env, cookie, { searchNewTab: false });
    expect(res.status).toBe(200);
    expect((await readJson(res)).searchNewTab).toBe(false);
    expect(storedSetting(env, "search_new_tab")).toBe("0");
    expect(
      (await readJson(await app.request("/api/public", {}, env))).settings
        .searchNewTab,
    ).toBe(false);

    res = await putSettings(app, env, cookie, { searchNewTab: true });
    expect((await readJson(res)).searchNewTab).toBe(true);
    expect(storedSetting(env, "search_new_tab")).toBe("1");
  });

  it("keeps the stored value when other settings are written", async () => {
    await putSettings(app, env, cookie, { searchNewTab: false });
    const res = await putSettings(app, env, cookie, { siteTitle: "nav2" });
    const body = await readJson(res);
    expect(body.siteTitle).toBe("nav2");
    expect(body.searchNewTab).toBe(false);
  });

  it("rejects non-boolean values with 400 and keeps the stored value", async () => {
    await putSettings(app, env, cookie, { searchNewTab: true });
    for (const searchNewTab of ["0", 1, 0, null, "true"]) {
      const res = await putSettings(app, env, cookie, { searchNewTab });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "searchNewTab must be a boolean",
      });
    }
    expect(storedSetting(env, "search_new_tab")).toBe("1");
  });

  it("lists search_new_tab in the settings whitelist", async () => {
    const res = await app.request(
      "/api/admin/settings/keys",
      { headers: { cookie } },
      env,
    );
    expect((await readJson(res)).keys).toContain("search_new_tab");
  });
});

/**
 * `showUrl`（显示网址）：KV 键 `show_url`，值 `"1"`/`"0"`。存量库无此键时 DTO
 * 按 `true`（默认开，即改动前的呈现）返回；公开端点同样带出该字段给前端。
 */
describe("settings showUrl (show_url)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("defaults to true when the key is absent (admin + public DTO)", async () => {
    expect(storedSetting(env, "show_url")).toBeNull();

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.showUrl).toBe(true);

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.showUrl).toBe(true);

    // Reading the default never writes a row.
    expect(storedSetting(env, "show_url")).toBeNull();
  });

  it('round-trips false/true as "0"/"1" and mirrors into /api/public', async () => {
    let res = await putSettings(app, env, cookie, { showUrl: false });
    expect(res.status).toBe(200);
    expect((await readJson(res)).showUrl).toBe(false);
    expect(storedSetting(env, "show_url")).toBe("0");
    expect(
      (await readJson(await app.request("/api/public", {}, env))).settings
        .showUrl,
    ).toBe(false);

    res = await putSettings(app, env, cookie, { showUrl: true });
    expect((await readJson(res)).showUrl).toBe(true);
    expect(storedSetting(env, "show_url")).toBe("1");
  });

  it("keeps the stored value when other settings are written", async () => {
    await putSettings(app, env, cookie, { showUrl: false });
    const res = await putSettings(app, env, cookie, { siteTitle: "nav2" });
    const body = await readJson(res);
    expect(body.siteTitle).toBe("nav2");
    expect(body.showUrl).toBe(false);
  });

  it("rejects non-boolean values with 400 and keeps the stored value", async () => {
    await putSettings(app, env, cookie, { showUrl: false });
    for (const showUrl of ["0", 1, 0, null, "true"]) {
      const res = await putSettings(app, env, cookie, { showUrl });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "showUrl must be a boolean",
      });
    }
    expect(storedSetting(env, "show_url")).toBe("0");
  });

  it("rejects the whole write when showUrl is invalid (no partial update)", async () => {
    const res = await putSettings(app, env, cookie, {
      siteTitle: "nav2",
      showUrl: "false",
    });
    expect(res.status).toBe(400);
    expect(storedSetting(env, "site_title")).toBeNull();
    expect(storedSetting(env, "show_url")).toBeNull();
  });

  it("lists show_url in the settings whitelist", async () => {
    const res = await app.request(
      "/api/admin/settings/keys",
      { headers: { cookie } },
      env,
    );
    expect((await readJson(res)).keys).toContain("show_url");
  });
});

/**
 * `wallpaperSource`（壁纸来源）：KV 键 `wallpaper_source`，值 `bing`/`custom`。
 * 存量库无此键时 DTO 按 `bing` 返回；公开端点同样带出该字段给前端。
 */
describe("settings wallpaperSource (wallpaper_source)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("defaults to bing when the key is absent (admin + public DTO)", async () => {
    expect(storedSetting(env, "wallpaper_source")).toBeNull();

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.wallpaperSource).toBe("bing");

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.wallpaperSource).toBe("bing");
  });

  it("round-trips custom/bing and mirrors into /api/public", async () => {
    let res = await putSettings(app, env, cookie, {
      wallpaperSource: "custom",
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).wallpaperSource).toBe("custom");
    expect(storedSetting(env, "wallpaper_source")).toBe("custom");
    expect(
      (await readJson(await app.request("/api/public", {}, env))).settings
        .wallpaperSource,
    ).toBe("custom");

    res = await putSettings(app, env, cookie, { wallpaperSource: "bing" });
    expect((await readJson(res)).wallpaperSource).toBe("bing");
    expect(storedSetting(env, "wallpaper_source")).toBe("bing");
  });

  it("keeps the stored value when other settings are written", async () => {
    await putSettings(app, env, cookie, { wallpaperSource: "custom" });
    const res = await putSettings(app, env, cookie, { siteTitle: "nav2" });
    expect((await readJson(res)).wallpaperSource).toBe("custom");
  });

  it("rejects invalid values with 400 and keeps the stored value", async () => {
    await putSettings(app, env, cookie, { wallpaperSource: "bing" });
    for (const wallpaperSource of ["custom2", "Bing", "", null, 1]) {
      const res = await putSettings(app, env, cookie, { wallpaperSource });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "wallpaperSource must be 'bing' or 'custom'",
      });
    }
    expect(storedSetting(env, "wallpaper_source")).toBe("bing");
  });

  it("lists wallpaper_source in the settings whitelist", async () => {
    const res = await app.request(
      "/api/admin/settings/keys",
      { headers: { cookie } },
      env,
    );
    expect((await readJson(res)).keys).toContain("wallpaper_source");
  });
});

/**
 * `linkStyle`（链接样式）：KV 键 `link_style`，值 `classic`/`compact`/`wide`。
 * 存量库无此键时 DTO 按 `classic` 返回；公开端点同样带出该字段给前端。
 */
describe("settings linkStyle (link_style)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("defaults to classic when the key is absent (admin + public DTO)", async () => {
    expect(storedSetting(env, "link_style")).toBeNull();

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.linkStyle).toBe("classic");

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.linkStyle).toBe("classic");

    // Reading the default never writes a row.
    expect(storedSetting(env, "link_style")).toBeNull();
  });

  it("round-trips classic/compact/wide and mirrors into /api/public", async () => {
    for (const linkStyle of ["compact", "wide", "classic"] as const) {
      const res = await putSettings(app, env, cookie, { linkStyle });
      expect(res.status).toBe(200);
      expect((await readJson(res)).linkStyle).toBe(linkStyle);
      expect(storedSetting(env, "link_style")).toBe(linkStyle);
      expect(
        (await readJson(await app.request("/api/public", {}, env))).settings
          .linkStyle,
      ).toBe(linkStyle);
    }
  });

  it("keeps the stored value when other settings are written", async () => {
    await putSettings(app, env, cookie, { linkStyle: "wide" });
    const res = await putSettings(app, env, cookie, { siteTitle: "nav2" });
    const body = await readJson(res);
    expect(body.siteTitle).toBe("nav2");
    expect(body.linkStyle).toBe("wide");
  });

  it("rejects invalid values with 400 and keeps the stored value", async () => {
    await putSettings(app, env, cookie, { linkStyle: "compact" });
    for (const linkStyle of ["grid", "Classic", "wide ", "", null, 1, true]) {
      const res = await putSettings(app, env, cookie, { linkStyle });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "linkStyle must be 'classic', 'compact' or 'wide'",
      });
    }
    expect(storedSetting(env, "link_style")).toBe("compact");
  });

  it("rejects the whole write when linkStyle is invalid (no partial update)", async () => {
    const res = await putSettings(app, env, cookie, {
      siteTitle: "nav2",
      linkStyle: "grid",
    });
    expect(res.status).toBe(400);
    expect(storedSetting(env, "site_title")).toBeNull();
    expect(storedSetting(env, "link_style")).toBeNull();
  });

  it("normalizes a dirty stored value to classic (admin + public DTO)", async () => {
    (env.DB as unknown as SqliteD1).db
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("link_style", "grid", "2026-11-06T00:00:00.000Z");

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.linkStyle).toBe("classic");

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.linkStyle).toBe("classic");

    // The dirty row itself is left untouched (no migration, no rewrite).
    expect(storedSetting(env, "link_style")).toBe("grid");
  });

  it("lists link_style in the settings whitelist", async () => {
    const res = await app.request(
      "/api/admin/settings/keys",
      { headers: { cookie } },
      env,
    );
    expect((await readJson(res)).keys).toContain("link_style");
  });
});

/**
 * `tileSize`（classic 砖块尺寸）：KV 键 `tile_size`，值 `large`/`medium`/`small`。
 * 存量库无此键时 DTO 按 `large` 返回；公开端点同样带出该字段给前端。
 */
describe("settings tileSize (tile_size)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("defaults to large when the key is absent (admin + public DTO)", async () => {
    expect(storedSetting(env, "tile_size")).toBeNull();

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.tileSize).toBe("large");

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.tileSize).toBe("large");

    // Reading the default never writes a row.
    expect(storedSetting(env, "tile_size")).toBeNull();
  });

  it("round-trips large/medium/small and mirrors into /api/public", async () => {
    for (const tileSize of ["medium", "small", "large"] as const) {
      const res = await putSettings(app, env, cookie, { tileSize });
      expect(res.status).toBe(200);
      expect((await readJson(res)).tileSize).toBe(tileSize);
      expect(storedSetting(env, "tile_size")).toBe(tileSize);
      expect(
        (await readJson(await app.request("/api/public", {}, env))).settings
          .tileSize,
      ).toBe(tileSize);
    }
  });

  it("keeps the stored value when other settings are written", async () => {
    await putSettings(app, env, cookie, { tileSize: "small" });
    const res = await putSettings(app, env, cookie, { siteTitle: "nav2" });
    const body = await readJson(res);
    expect(body.siteTitle).toBe("nav2");
    expect(body.tileSize).toBe("small");
  });

  it("rejects invalid values with 400 and keeps the stored value", async () => {
    await putSettings(app, env, cookie, { tileSize: "medium" });
    for (const tileSize of ["huge", "Large", "medium ", "", null, 1, true]) {
      const res = await putSettings(app, env, cookie, { tileSize });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "tileSize must be 'large', 'medium' or 'small'",
      });
    }
    expect(storedSetting(env, "tile_size")).toBe("medium");
  });

  it("rejects the whole write when tileSize is invalid (no partial update)", async () => {
    const res = await putSettings(app, env, cookie, {
      siteTitle: "nav2",
      tileSize: "huge",
    });
    expect(res.status).toBe(400);
    expect(storedSetting(env, "site_title")).toBeNull();
    expect(storedSetting(env, "tile_size")).toBeNull();
  });

  it("normalizes a dirty stored value to large (admin + public DTO)", async () => {
    (env.DB as unknown as SqliteD1).db
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("tile_size", "huge", "2026-11-08T00:00:00.000Z");

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.tileSize).toBe("large");

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.tileSize).toBe("large");

    // The dirty row itself is left untouched (no migration, no rewrite).
    expect(storedSetting(env, "tile_size")).toBe("huge");
  });

  it("lists tile_size in the settings whitelist", async () => {
    const res = await app.request(
      "/api/admin/settings/keys",
      { headers: { cookie } },
      env,
    );
    expect((await readJson(res)).keys).toContain("tile_size");
  });
});

/**
 * 站点主题已删除（2026-11-05 定版）：`theme` 不再是站点设置 —— 前后台/公开端点
 * 的 settings DTO 都不含它，写入白名单也不再接受它；存量的 `theme` 行不删不迁移
 * （停止读写后即无害残留）。
 */
describe("settings theme removed (site-level theme)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("is absent from the admin and public settings DTOs", async () => {
    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin).not.toHaveProperty("theme");

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings).not.toHaveProperty("theme");
  });

  it("ignores theme on PUT (whitelist) and does not write a row", async () => {
    const res = await putSettings(app, env, cookie, {
      siteTitle: "nav",
      theme: "dark",
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.siteTitle).toBe("nav");
    expect(body).not.toHaveProperty("theme");
    expect(storedSetting(env, "theme")).toBeNull();
  });

  it("leaves a pre-existing theme row untouched (no migration, no cleanup)", async () => {
    (env.DB as unknown as SqliteD1).db
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("theme", "light", "2026-11-05T00:00:00.000Z");

    await putSettings(app, env, cookie, { siteTitle: "nav2" });
    expect(storedSetting(env, "theme")).toBe("light");
  });

  it("does not list theme in the settings whitelist", async () => {
    const res = await app.request(
      "/api/admin/settings/keys",
      { headers: { cookie } },
      env,
    );
    expect((await readJson(res)).keys).not.toContain("theme");
  });
});
