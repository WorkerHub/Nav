import { Hono } from "hono";
import { getTablePrefix, type HonoEnv, type SiteDataDto } from "../types";
import {
  listCategories,
  listLinks,
  listScenes,
  listSearchEngines,
} from "../db/queries/content";
import { getAllSettings } from "../db/queries/settings";
import { buildSiteData } from "../services/site-data";
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

  // 两层取与（场景公开 AND 分类公开）全部由 buildSiteData 收敛：它拿到全量行，
  // 在输出前把私有场景整个空间（场景/分类/链接）裁掉。这里不预先过滤场景，
  // 否则「属于私有场景」与「属于默认场景」就分不清了。
  const data: SiteDataDto = buildSiteData(
    categories,
    links,
    engines,
    settings,
    scenes,
    { includePrivate: false },
  );

  c.header("cache-control", "public, max-age=60");
  return c.json(data);
});
