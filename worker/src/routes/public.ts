import { Hono } from "hono";
import { getTablePrefix, type HonoEnv, type SiteDataDto } from "../types";
import {
  listCategories,
  listLinks,
  listScenes,
  listSearchEngines,
} from "../db/queries/content";
import { getAllSettings } from "../db/queries/settings";
import {
  buildSiteData,
  publicCategories,
  publicScenes,
} from "../services/site-data";
import { ensureSchema } from "../lib/migrate";

export const publicRoutes = new Hono<HonoEnv>();

/**
 * GET /api/public — public scenes + public categories + public links, search
 * engines, site settings. Private rows are never delivered, and a private scene
 * makes its whole space (scene, categories, links) disappear for anonymous
 * visitors (nav #19 B1/B3: visibility = scene public AND category public).
 * Publicly cacheable.
 */
publicRoutes.get("/", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const [categories, links, engines, settings, scenes] = await Promise.all([
    listCategories(c.env.DB, prefix),
    listLinks(c.env.DB, prefix),
    listSearchEngines(c.env.DB, prefix),
    getAllSettings(c.env.DB, prefix),
    listScenes(c.env.DB, prefix),
  ]);

  // 两层取与的第一层：私有场景整个空间对外不存在。
  const visibleScenes = publicScenes(scenes);
  // 第二层：公开场景内继续按分类自身 visibility 过滤；私有场景下的分类无论
  // 自身标记都不出现。
  const visibleCategories = publicCategories(categories, scenes);
  const visibleCategoryIds = new Set(
    visibleCategories.map((category) => category.id),
  );
  // 链接没有独立可见性，跟随分类（可见性取更严一方）。
  const publicLinks = links.filter(
    (link) =>
      link.visibility === "public" && visibleCategoryIds.has(link.category_id),
  );

  const data: SiteDataDto = buildSiteData(
    visibleCategories,
    publicLinks,
    engines,
    settings,
    visibleScenes,
    { includePrivate: false },
  );

  c.header("cache-control", "public, max-age=60");
  return c.json(data);
});
