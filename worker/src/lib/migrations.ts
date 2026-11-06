// Schema migrations, parameterised by TABLE_PREFIX (ONE-346 / ONE-357).
//
// Single source of truth for the nav D1 schema: the versioned migration list
// below is the ONLY place the schema is defined. Both the public setup route
// (POST /api/auth/setup) and the read-path guard (lib/migrate.ts →
// ensureSchema) run this list through lib/migrations-runner.ts.
//
// Writing migrations from here on (README §迁移账本):
// - Already-merged migrations are immutable: never edit their name or SQL.
// - Append new migrations at the end as `schema_v2`, `schema_v3`, …
// - Additive only (CREATE TABLE/INDEX IF NOT EXISTS, ALTER TABLE ADD COLUMN,
//   INSERT OR IGNORE). Destructive changes need a separate spec.

/**
 * Table prefix core: the effective prefix without its trailing underscore(s).
 * `nav_` → `nav`, `""` → `""` (no prefix). Case is preserved verbatim.
 *
 * Exported because the conflict probe compares table-derived prefix cores
 * (`nav_passkey_credentials` → `nav`) against the configured prefix.
 */
export function prefixCore(prefix: string): string {
  return prefix.replace(/_+$/, "");
}

/**
 * Name of the migration ledger table for a prefix — the single place that
 * formula is implemented, e.g. `_nav_schema_migrations`.
 *
 * `nav_` → `_nav_schema_migrations`, `app_` → `_app_schema_migrations`,
 * `abc123` → `_abc123_schema_migrations`, `""` → `_schema_migrations`.
 */
export function migrationsTable(prefix: string): string {
  const core = prefixCore(prefix);
  return core === "" ? "_schema_migrations" : `_${core}_schema_migrations`;
}

export function createMigrationsTableSql(prefix: string): string {
  return `CREATE TABLE IF NOT EXISTS ${migrationsTable(prefix)} (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))`;
}

export interface Migration {
  name: string;
  sql: string;
}

/**
 * The migration list for a prefix. `schema_v1` is the whole nav v1 schema
 * (tables, indexes and the `setup_completed` seed): nav v1 shipped without a
 * ledger, so its history is collapsed into one baseline migration. `schema_v2`
 * adds the scene dimension (scenes table + `categories.scene_id`). `schema_v3`
 * adds `scenes.visibility` (scene-level visibility, ANDed with the category's).
 */
export function getMigrations(prefix: string): Migration[] {
  const t = (name: string) => `${prefix}${name}`;
  const idx = (name: string) => `idx_${prefix}${name}`;

  return [
    {
      name: "schema_v1",
      sql: `
CREATE TABLE IF NOT EXISTS ${t("users")} (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${t("passkey_credentials")} (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES ${t("users")}(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ${idx("passkey_credentials_user_id")}
  ON ${t("passkey_credentials")}(user_id);

CREATE TABLE IF NOT EXISTS ${t("sessions")} (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES ${t("users")}(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS ${idx("sessions_user_id")}
  ON ${t("sessions")}(user_id);

CREATE TABLE IF NOT EXISTS ${t("login_attempts")} (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  ip           TEXT NOT NULL,
  success      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  locked_until TEXT
);

CREATE INDEX IF NOT EXISTS ${idx("login_attempts_created_at")}
  ON ${t("login_attempts")}(created_at);

CREATE TABLE IF NOT EXISTS ${t("challenges")} (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  user_id    TEXT,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ${idx("challenges_expires_at")}
  ON ${t("challenges")}(expires_at);

CREATE TABLE IF NOT EXISTS ${t("categories")} (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${t("links")} (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES ${t("categories")}(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  icon_url    TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  click_count     INTEGER NOT NULL DEFAULT 0,
  status          TEXT,
  last_checked_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ${idx("links_category_id")}
  ON ${t("links")}(category_id);

CREATE TABLE IF NOT EXISTS ${t("search_engines")} (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  url_template TEXT NOT NULL,
  icon         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${t("settings")} (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO ${t("settings")} (key, value, updated_at)
VALUES ('setup_completed', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`,
    },
    {
      name: "schema_v2",
      sql: `
CREATE TABLE IF NOT EXISTS ${t("scenes")} (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ${idx("scenes_single_default")}
  ON ${t("scenes")}(is_default) WHERE is_default = 1;

INSERT OR IGNORE INTO ${t("scenes")} (id, name, icon, sort_order, is_default, created_at, updated_at)
VALUES ('scene_default', '通用', NULL, 0, 1,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

ALTER TABLE ${t("categories")} ADD COLUMN scene_id TEXT REFERENCES ${t("scenes")}(id);

CREATE INDEX IF NOT EXISTS ${idx("categories_scene_id")}
  ON ${t("categories")}(scene_id);

UPDATE ${t("categories")}
   SET scene_id = (SELECT id FROM ${t("scenes")} WHERE is_default = 1 ORDER BY sort_order, created_at LIMIT 1)
 WHERE scene_id IS NULL;
`,
    },
    {
      // Scene-level visibility (nav #19 B1/B3): `public` | `private`, the same
      // vocabulary the category uses. Existing rows take the DEFAULT 'public',
      // so the default scene (and every other pre-existing scene) stays public
      // after the upgrade — the「default scene must be public」invariant holds
      // for existing data without a backfill.
      // Same replay rule as schema_v2's `ALTER TABLE categories ADD COLUMN`:
      // SQLite has no `ADD COLUMN IF NOT EXISTS`, so safety comes from the
      // ledger (a recorded migration is skipped, the ALTER never runs twice).
      name: "schema_v3",
      sql: `
ALTER TABLE ${t("scenes")} ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'));
`,
    },
  ];
}
