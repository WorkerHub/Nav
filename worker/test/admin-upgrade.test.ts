import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { applyMigrationList } from "../src/lib/migrations-runner";
import { getMigrations, migrationsTable } from "../src/lib/migrations";
import { adminRoutes } from "../src/routes/admin";
import { generateId, signJWT } from "../src/core/auth";
import { insertSession } from "../src/db/queries/users";
import { makeEnv, readJson, type SqliteD1 } from "./helpers";

/**
 * A Worker-only deploy leaves an existing database at schema_v1: the ledger
 * records only schema_v1 and `{prefix}scenes` does not exist yet. The admin SPA
 * can mount before /api/private has triggered the lazy upgrade, so scene-aware
 * admin handlers must run the same guard instead of 500ing on `no such table`.
 */
describe("admin upgrade path (schema_v1-only database)", () => {
  it("migrates before serving GET /api/admin/categories", async () => {
    const env = makeEnv();
    const v1 = getMigrations("")[0];
    if (!v1) throw new Error("schema_v1 missing");
    await applyMigrationList(env.DB, "", [v1]);

    const db = (env.DB as unknown as SqliteD1).db;
    const now = new Date().toISOString();
    const userId = "legacy-owner";
    db.prepare(
      "INSERT INTO users (id, username, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).run(userId, "owner", "hash", now, now);
    db.prepare(
      "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES (?, ?, NULL, 0, 'public', ?, ?)",
    ).run("legacy-cat", "Legacy Cat", now, now);

    // A valid session without going through /api/auth/setup (which would run
    // the migrations and hide the bug).
    const sid = generateId();
    const iat = Math.floor(Date.now() / 1000);
    await insertSession(env.DB, "", {
      id: sid,
      user_id: userId,
      expires_at: new Date((iat + 3600) * 1000).toISOString(),
      ip: null,
      user_agent: null,
    });
    const token = await signJWT(
      {
        typ: "access",
        sub: userId,
        jti: generateId(),
        sid,
        iat,
        exp: iat + 3600,
      },
      env.SESSION_SECRET,
    );
    const cookie = `nav_session=${token}`;

    const app = new Hono();
    app.route("/api/admin", adminRoutes);

    const res = await app.request(
      "/api/admin/categories",
      { headers: { cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.categories).toEqual([
      expect.objectContaining({ id: "legacy-cat", sceneId: "scene_default" }),
    ]);

    // The guard applied schema_v2 and backfilled the legacy row.
    expect(
      db
        .prepare(`SELECT name FROM ${migrationsTable("")} ORDER BY rowid`)
        .all()
        .map((row: { name: string }) => row.name),
    ).toEqual(["schema_v1", "schema_v2"]);
    expect(
      db
        .prepare("SELECT scene_id FROM categories WHERE id = 'legacy-cat'")
        .get(),
    ).toEqual({ scene_id: "scene_default" });

    const scenesRes = await app.request(
      "/api/admin/scenes",
      { headers: { cookie } },
      env,
    );
    expect(scenesRes.status).toBe(200);
    expect((await readJson(scenesRes)).scenes).toHaveLength(1);
  });
});
