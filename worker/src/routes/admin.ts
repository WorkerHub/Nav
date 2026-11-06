import { Hono } from "hono";
import {
  getTablePrefix,
  isVisibility,
  type HonoEnv,
  type SiteSettingsDto,
} from "../types";
import { authMiddleware } from "../middleware/auth";
import {
  clearDefaultSearchEngines,
  deleteCategory,
  deleteLinksByCategory,
  deleteLink,
  deleteSceneMovingCategories,
  deleteSearchEngine,
  findCategory,
  findDefaultScene,
  findLink,
  findScene,
  findSearchEngine,
  insertCategory,
  insertLink,
  insertScene,
  insertSearchEngine,
  listCategories,
  listLinks,
  listScenes,
  listSearchEngines,
  nextCategorySortOrder,
  nextSceneSortOrder,
  updateCategory,
  updateLink,
  updateScene,
  updateSearchEngine,
} from "../db/queries/content";
import { getAllSettings, setSetting } from "../db/queries/settings";
import { ensureSchema } from "../lib/migrate";
import { listRecordedMigrations } from "../lib/migrations-runner";
import { generateId } from "../core/auth";
import type { Category, Link, Scene } from "../types";
import {
  normalizeSceneId,
  toAdminSceneDto,
  toSearchEngineDto,
  toSiteSettingsDto,
} from "../services/site-data";
import { deleteAssetByPublicPath } from "../services/assets";
import { deleteAsset, uploadAsset } from "./assets";
import {
  getSetupPageEnabled,
  runSetupMigrations,
  setSetupPageEnabled,
} from "../services/setup";

export const adminRoutes = new Hono<HonoEnv>();

// Contract ONE-168: all /api/admin/* writes require a session; 401 JSON otherwise.
adminRoutes.use("*", authMiddleware);

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

type Visibility = "public" | "private";

function readVisibility(value: unknown): Visibility | undefined {
  if (value === undefined) return undefined;
  return isVisibility(value) ? value : undefined;
}

function parseSortOrder(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 「请求把该场景设为默认」的既有载荷口径（`true` 或 `1`；其余一律忽略）。 */
function wantsDefault(value: unknown): boolean {
  return value === true || value === 1;
}

// ─── Categories ──────────────────────────────────────────────────────────────

/** Admin category DTO: full row plus the normalised `sceneId`. */
function adminCategoryDto(category: Category, scenes: Scene[]) {
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    sortOrder: category.sort_order,
    visibility: category.visibility,
    sceneId: normalizeSceneId(category.scene_id, scenes),
    createdAt: category.created_at,
    updatedAt: category.updated_at,
  };
}

adminRoutes.get("/categories", async (c) => {
  const prefix = getTablePrefix(c.env);
  // Scene-aware handlers need schema_v2. A Worker-only deploy upgrades the
  // database on the first read path, and the admin SPA can mount before
  // /api/private finishes — run the same guard here so it never reads `scenes`
  // before the migration has been applied.
  await ensureSchema(c.env);
  const [categories, scenes] = await Promise.all([
    listCategories(c.env.DB, prefix),
    listScenes(c.env.DB, prefix),
  ]);
  return c.json({
    categories: categories.map((cat) => adminCategoryDto(cat, scenes)),
  });
});

adminRoutes.post("/categories", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const body = await c.req
    .json<{
      name?: unknown;
      icon?: unknown;
      sortOrder?: unknown;
      visibility?: unknown;
      sceneId?: unknown;
    }>()
    .catch(
      (): {
        name?: unknown;
        icon?: unknown;
        sortOrder?: unknown;
        visibility?: unknown;
        sceneId?: unknown;
      } => ({}),
    );

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("name is required");
  const visibility = readVisibility(body.visibility) ?? "public";
  if (body.visibility !== undefined && !isVisibility(body.visibility))
    return badRequest("visibility must be 'public' or 'private'");

  const id = generateId();
  const icon = typeof body.icon === "string" ? body.icon : null;
  const sortOrder = parseSortOrder(body.sortOrder, 0);

  // sceneId omitted → the category belongs to the default scene (the seeded
  // 通用 scene); an explicit but unknown scene is a client error.
  let sceneId: string;
  if (body.sceneId !== undefined) {
    const requested =
      typeof body.sceneId === "string" ? body.sceneId.trim() : "";
    const scene = requested
      ? await findScene(c.env.DB, prefix, requested)
      : null;
    if (!scene) return badRequest("sceneId does not exist");
    sceneId = scene.id;
  } else {
    sceneId = (await findDefaultScene(c.env.DB, prefix))?.id ?? "";
  }

  await insertCategory(c.env.DB, prefix, {
    id,
    name,
    icon,
    sort_order: sortOrder,
    visibility,
    scene_id: sceneId === "" ? null : sceneId,
  });

  return c.json(
    {
      id,
      name,
      icon,
      sortOrder,
      visibility,
      sceneId,
    },
    201,
  );
});

adminRoutes.put("/categories/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const id = c.req.param("id");
  const existing = await findCategory(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("name must not be empty");
    data.name = name;
  }
  if (body.icon !== undefined)
    data.icon = typeof body.icon === "string" ? body.icon : null;
  if (body.sortOrder !== undefined)
    data.sort_order = parseSortOrder(body.sortOrder, existing.sort_order);
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility))
      return badRequest("visibility must be 'public' or 'private'");
    data.visibility = body.visibility;
  }

  if (body.sceneId !== undefined) {
    const requested =
      typeof body.sceneId === "string" ? body.sceneId.trim() : "";
    const scene = requested
      ? await findScene(c.env.DB, prefix, requested)
      : null;
    if (!scene) return badRequest("sceneId does not exist");
    // When a category changes scene and no explicit position was sent, append
    // it after the target scene's existing categories (MAX+1, the same rule as
    // deleting a scene) so sort_order cannot collide with target rows. An
    // explicit sortOrder above wins and is kept verbatim.
    if (scene.id !== existing.scene_id && body.sortOrder === undefined) {
      data.sort_order = await nextCategorySortOrder(c.env.DB, prefix, scene.id);
    }
    // Links follow their category, so nothing else has to move.
    data.scene_id = scene.id;
  }

  await updateCategory(c.env.DB, prefix, id, data);
  const updated = await findCategory(c.env.DB, prefix, id);
  const scenes = await listScenes(c.env.DB, prefix);
  return c.json({
    id: updated?.id,
    name: updated?.name,
    icon: updated?.icon,
    sortOrder: updated?.sort_order,
    visibility: updated?.visibility,
    sceneId: normalizeSceneId(updated?.scene_id, scenes),
  });
});

adminRoutes.delete("/categories/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findCategory(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  await deleteLinksByCategory(c.env.DB, prefix, id);
  await deleteCategory(c.env.DB, prefix, id);
  return c.json({ success: true });
});

// ─── Scenes ──────────────────────────────────────────────────────────────────

adminRoutes.get("/scenes", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const scenes = await listScenes(c.env.DB, prefix);
  return c.json({ scenes: scenes.map(toAdminSceneDto) });
});

adminRoutes.post("/scenes", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("name is required");

  // 场景可见性（nav #19 B3）：创建接收 `visibility`，缺省 public，非法值 400。
  if (body.visibility !== undefined && !isVisibility(body.visibility))
    return badRequest("visibility must be 'public' or 'private'");
  const visibility: Visibility = isVisibility(body.visibility)
    ? body.visibility
    : "public";

  // B2 ①：私有场景不得被设为默认。`isDefault` 本身仍只读（#17 冻结：公开场景
  // 传了照旧静默忽略），但「把私有场景设成默认」这个请求直接 400。
  if (wantsDefault(body.isDefault) && visibility === "private")
    return badRequest("private scene cannot be set as default");

  const id = generateId();
  const sortOrder = parseSortOrder(
    body.sortOrder,
    await nextSceneSortOrder(c.env.DB, prefix),
  );
  // `isDefault` is read-only: the seeded 通用 scene stays the only default, so
  // any isDefault in the payload is ignored (same rule as PUT).
  await insertScene(c.env.DB, prefix, {
    id,
    name,
    icon: typeof body.icon === "string" ? body.icon : null,
    sort_order: sortOrder,
    is_default: 0,
    visibility,
  });

  const created = await findScene(c.env.DB, prefix, id);
  if (!created) return c.json({ error: "not found" }, 404);
  return c.json(toAdminSceneDto(created), 201);
});

adminRoutes.put("/scenes/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const id = c.req.param("id");
  const existing = await findScene(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("name must not be empty");
    data.name = name;
  }
  if (body.icon !== undefined)
    data.icon = typeof body.icon === "string" ? body.icon : null;
  if (body.sortOrder !== undefined)
    data.sort_order = parseSortOrder(body.sortOrder, existing.sort_order);
  // `isDefault` is read-only — silently ignored, exactly as frozen in #16.

  // 场景可见性（nav #19 B2/B3）：非法值 400，缺省保持原值。
  let visibility: Visibility = existing.visibility;
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility))
      return badRequest("visibility must be 'public' or 'private'");
    visibility = body.visibility;
  }
  // B2 ②：默认场景不得改为私有 —— 须先把默认移走（#17 契约不提供转移默认的
  // 接口，所以现有 API 上就是「默认场景只能是公开的」）。
  if (existing.is_default === 1 && visibility === "private")
    return badRequest("default scene cannot be private");
  // B2 ①：私有场景不得被设为默认。
  if (wantsDefault(body.isDefault) && visibility === "private")
    return badRequest("private scene cannot be set as default");
  if (body.visibility !== undefined) data.visibility = visibility;

  await updateScene(c.env.DB, prefix, id, data);
  const updated = await findScene(c.env.DB, prefix, id);
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json(toAdminSceneDto(updated));
});

adminRoutes.delete("/scenes/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const id = c.req.param("id");
  const existing = await findScene(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.is_default === 1)
    return badRequest("default scene cannot be deleted");

  const defaultScene = await findDefaultScene(c.env.DB, prefix);
  if (!defaultScene) return c.json({ error: "default scene not found" }, 500);

  // One transaction: move categories (links follow by reference) into the
  // default scene, then delete the scene with an `is_default = 0` guard.
  await deleteSceneMovingCategories(c.env.DB, prefix, id, defaultScene.id);
  return c.json({ success: true });
});

// ─── Links ───────────────────────────────────────────────────────────────────

/** Admin link DTO: full row incl. visibility + timestamps (contract: docs/api-contract.md). */
function adminLinkDto(link: Link) {
  return {
    id: link.id,
    categoryId: link.category_id,
    title: link.title,
    url: link.url,
    iconUrl: link.icon_url,
    description: link.description,
    sortOrder: link.sort_order,
    visibility: link.visibility,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
  };
}

adminRoutes.get("/links", async (c) => {
  const prefix = getTablePrefix(c.env);
  const links = await listLinks(c.env.DB, prefix);
  return c.json({ links: links.map(adminLinkDto) });
});

adminRoutes.post("/links", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  if (!title) return badRequest("title is required");
  if (!url) return badRequest("url is required");
  if (!categoryId) return badRequest("categoryId is required");

  const category = await findCategory(c.env.DB, prefix, categoryId);
  if (!category) return badRequest("categoryId does not exist");
  if (body.visibility !== undefined && !isVisibility(body.visibility))
    return badRequest("visibility must be 'public' or 'private'");

  const id = generateId();
  const visibility = readVisibility(body.visibility) ?? "public";
  await insertLink(c.env.DB, prefix, {
    id,
    category_id: categoryId,
    title,
    url,
    icon_url:
      typeof body.iconUrl === "string" && body.iconUrl ? body.iconUrl : null,
    description: typeof body.description === "string" ? body.description : null,
    sort_order: parseSortOrder(body.sortOrder, 0),
    visibility,
  });

  return c.json({ id }, 201);
});

adminRoutes.put("/links/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findLink(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return badRequest("title must not be empty");
    data.title = title;
  }
  if (body.url !== undefined) {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return badRequest("url must not be empty");
    data.url = url;
  }
  if (body.categoryId !== undefined) {
    const category = await findCategory(
      c.env.DB,
      prefix,
      String(body.categoryId),
    );
    if (!category) return badRequest("categoryId does not exist");
    data.category_id = body.categoryId;
  }
  if (body.iconUrl !== undefined)
    data.icon_url =
      typeof body.iconUrl === "string" && body.iconUrl ? body.iconUrl : null;
  if (body.description !== undefined)
    data.description =
      typeof body.description === "string" ? body.description : null;
  if (body.sortOrder !== undefined)
    data.sort_order = parseSortOrder(body.sortOrder, existing.sort_order);
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility))
      return badRequest("visibility must be 'public' or 'private'");
    data.visibility = body.visibility;
  }

  await updateLink(c.env.DB, prefix, id, data);
  const updated = await findLink(c.env.DB, prefix, id);
  return c.json(updated ? adminLinkDto(updated) : { id });
});

adminRoutes.delete("/links/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findLink(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  await deleteLink(c.env.DB, prefix, id);
  return c.json({ success: true });
});

// ─── Search engines ──────────────────────────────────────────────────────────

adminRoutes.get("/search-engines", async (c) => {
  const prefix = getTablePrefix(c.env);
  const engines = await listSearchEngines(c.env.DB, prefix);
  return c.json({ searchEngines: engines.map(toSearchEngineDto) });
});

adminRoutes.post("/search-engines", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const urlTemplate =
    typeof body.urlTemplate === "string" ? body.urlTemplate.trim() : "";
  if (!name) return badRequest("name is required");
  if (!urlTemplate) return badRequest("urlTemplate is required");
  if (!urlTemplate.includes("{q}"))
    return badRequest("urlTemplate must contain {q}");

  const id = generateId();
  const isDefault = body.isDefault === true || body.isDefault === 1;
  if (isDefault) await clearDefaultSearchEngines(c.env.DB, prefix);

  await insertSearchEngine(c.env.DB, prefix, {
    id,
    name,
    url_template: urlTemplate,
    icon: typeof body.icon === "string" ? body.icon : null,
    sort_order: parseSortOrder(body.sortOrder, 0),
    is_default: isDefault ? 1 : 0,
  });

  return c.json({ id }, 201);
});

adminRoutes.put("/search-engines/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findSearchEngine(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("name must not be empty");
    data.name = name;
  }
  if (body.urlTemplate !== undefined) {
    const urlTemplate =
      typeof body.urlTemplate === "string" ? body.urlTemplate.trim() : "";
    if (!urlTemplate.includes("{q}"))
      return badRequest("urlTemplate must contain {q}");
    data.url_template = urlTemplate;
  }
  if (body.icon !== undefined)
    data.icon = typeof body.icon === "string" ? body.icon : null;
  if (body.sortOrder !== undefined)
    data.sort_order = parseSortOrder(body.sortOrder, existing.sort_order);
  if (body.isDefault !== undefined) {
    const isDefault = body.isDefault === true || body.isDefault === 1;
    if (isDefault) await clearDefaultSearchEngines(c.env.DB, prefix);
    data.is_default = isDefault ? 1 : 0;
  }

  await updateSearchEngine(c.env.DB, prefix, id, data);
  return c.json({ id });
});

adminRoutes.delete("/search-engines/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findSearchEngine(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  await deleteSearchEngine(c.env.DB, prefix, id);
  return c.json({ success: true });
});

// ─── Sort order (batch) ──────────────────────────────────────────────────────

adminRoutes.post("/categories/reorder", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids))
    return badRequest("ids must be an array of category ids");
  for (const [index, id] of body.ids.entries()) {
    if (typeof id !== "string")
      return badRequest("ids must be an array of category ids");
    await updateCategory(c.env.DB, prefix, id, { sort_order: index });
  }
  return c.json({ success: true });
});

adminRoutes.post("/scenes/reorder", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids))
    return badRequest("ids must be an array of scene ids");
  for (const [index, id] of body.ids.entries()) {
    if (typeof id !== "string")
      return badRequest("ids must be an array of scene ids");
    await updateScene(c.env.DB, prefix, id, { sort_order: index });
  }
  return c.json({ success: true });
});

adminRoutes.post("/links/reorder", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids))
    return badRequest("ids must be an array of link ids");
  for (const [index, id] of body.ids.entries()) {
    if (typeof id !== "string")
      return badRequest("ids must be an array of link ids");
    await updateLink(c.env.DB, prefix, id, { sort_order: index });
  }
  return c.json({ success: true });
});

adminRoutes.post("/search-engines/reorder", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids))
    return badRequest("ids must be an array of search engine ids");
  for (const [index, id] of body.ids.entries()) {
    if (typeof id !== "string")
      return badRequest("ids must be an array of search engine ids");
    await updateSearchEngine(c.env.DB, prefix, id, { sort_order: index });
  }
  return c.json({ success: true });
});

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTING_KEYS = [
  "site_title",
  "background_url",
  "logo_url",
  "columns",
  "search_new_tab",
  "wallpaper_source",
] as const;

adminRoutes.get("/settings", async (c) => {
  const prefix = getTablePrefix(c.env);
  const settings = await getAllSettings(c.env.DB, prefix);
  const dto: SiteSettingsDto = toSiteSettingsDto(settings);
  return c.json(dto);
});

adminRoutes.put("/settings", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  const previous = await getAllSettings(c.env.DB, prefix);

  const updates: Record<string, string> = {};
  /** Local `/assets/…` values orphaned by this write (owner of the binding). */
  const replacedAssets: string[] = [];

  if (body.siteTitle !== undefined) updates.site_title = String(body.siteTitle);
  if (body.backgroundUrl !== undefined) {
    updates.background_url = String(body.backgroundUrl);
    collectReplacedAsset(
      previous.background_url,
      updates.background_url,
      replacedAssets,
    );
  }
  if (body.logoUrl !== undefined) {
    updates.logo_url = String(body.logoUrl);
    collectReplacedAsset(previous.logo_url, updates.logo_url, replacedAssets);
  }
  if (body.columns !== undefined) {
    const columns = Number.parseInt(String(body.columns), 10);
    // 0 is a valid value: it means "unconfigured" (the GET DTO reports it
    // since a fresh database has no columns row), so it must round-trip and is
    // stored verbatim rather than coerced to a default.
    if (!Number.isFinite(columns) || columns < 0 || columns > 12)
      return badRequest("columns must be between 0 and 12");
    updates.columns = String(columns);
  }
  if (body.searchNewTab !== undefined) {
    // Stored as the KV boolean convention ("1"/"0"), like totp_enabled.
    if (typeof body.searchNewTab !== "boolean")
      return badRequest("searchNewTab must be a boolean");
    updates.search_new_tab = body.searchNewTab ? "1" : "0";
  }
  if (body.wallpaperSource !== undefined) {
    const wallpaperSource = String(body.wallpaperSource);
    if (!["bing", "custom"].includes(wallpaperSource))
      return badRequest("wallpaperSource must be 'bing' or 'custom'");
    updates.wallpaper_source = wallpaperSource;
  }

  for (const [key, value] of Object.entries(updates)) {
    await setSetting(c.env.DB, prefix, key, value);
  }

  // Auto-clean: a local upload that was just replaced is deleted from R2.
  // External URLs never reach this list, and a missing binding is a no-op.
  for (const publicPath of replacedAssets) {
    await deleteAssetByPublicPath(c.env.R2, publicPath);
  }

  const settings = await getAllSettings(c.env.DB, prefix);
  return c.json(toSiteSettingsDto(settings));
});

/** Queue the old value for deletion when a local upload is replaced by anything else. */
function collectReplacedAsset(
  previousValue: string | undefined,
  nextValue: string,
  into: string[],
): void {
  if (!previousValue || previousValue === nextValue) return;
  if (previousValue.startsWith("/assets/")) into.push(previousValue);
}

adminRoutes.get("/settings/keys", (c) => c.json({ keys: SETTING_KEYS }));

// ─── Assets (uploaded images in R2, SPEC ONE-444) ────────────────────────────

// Both handlers sit inside adminRoutes, so authMiddleware already requires a
// session. Must stay above the strict admin 404 fallback below.
adminRoutes.post("/assets", uploadAsset);
adminRoutes.delete("/assets", deleteAsset);

// ─── System: database maintenance + setup page switch (SPEC §3.5) ────────────

/**
 * POST /api/admin/setup — session-authenticated (no setup secret) upgrade.
 * Payload and 409 conflict shape are identical to POST /api/setup.
 */
adminRoutes.post("/setup", async (c) => {
  const outcome = await runSetupMigrations(c.env);
  if (!outcome.ok) return c.json(outcome.body, outcome.status);
  return c.json(outcome.body);
});

/** GET /api/admin/system — effective prefix, page switch, recorded ledger. */
adminRoutes.get("/system", async (c) => {
  const prefix = getTablePrefix(c.env);
  const [ledger, setupPageEnabled] = await Promise.all([
    listRecordedMigrations(c.env.DB, prefix),
    getSetupPageEnabled(c.env, prefix),
  ]);
  return c.json({ tablePrefix: prefix, setupPageEnabled, ledger });
});

/** PUT /api/admin/system/setup-page — body `{enabled: boolean}` (strict). */
adminRoutes.put("/system/setup-page", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body?.enabled !== "boolean")
    return badRequest("enabled must be a boolean");

  await setSetupPageEnabled(c.env, body.enabled);
  return c.json({ setupPageEnabled: body.enabled });
});

// Fallbacks kept intentionally strict: unknown admin routes are 404 JSON.
adminRoutes.all("*", (c) => c.json({ error: "not found" }, 404));
