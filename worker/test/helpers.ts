import { DatabaseSync } from "node:sqlite";
import type { Env } from "../src/types";

/**
 * Minimal D1 stand-in backed by a real in-memory SQLite database (node:sqlite).
 * Keeps real column defaults/constraints so schema + query behaviour can be
 * verified against actual SQL semantics.
 */
export class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");
  queries: string[] = [];

  prepare(sql: string): any {
    const db = this.db;
    this.queries.push(sql);
    const statement = () => db.prepare(sql);

    const execute = (args: unknown[]) => {
      statement().run(...(args as any[]));
    };

    const withArgs = (args: unknown[]) => {
      const stub: any = {
        first: async <T>() =>
          (statement().get(...(args as any[])) ?? null) as T | null,
        all: async <T>() => ({
          results: statement().all(...(args as any[])) as T[],
        }),
        run: async () => {
          execute(args);
          return { success: true };
        },
      };
      // Internal hook used by batch(): D1 statements are executed by their
      // prepared form, not by re-parsing the bound stub.
      stub._execute = () => execute(args);
      return stub;
    };

    const stub: any = {
      bind: (...args: unknown[]) => withArgs(args),
      first: async <T>() => (statement().get() ?? null) as T | null,
      all: async <T>() => ({ results: statement().all() as T[] }),
      run: async () => {
        execute([]);
        return { success: true };
      },
    };
    stub._execute = () => execute([]);
    return stub;
  }

  /**
   * Minimal D1 batch(): one BEGIN, every statement in order, COMMIT; any error
   * rolls the whole batch back and is rethrown (matching D1's all-or-nothing
   * transaction semantics for scene deletion).
   */
  async batch(statements: any[]): Promise<Array<{ success: boolean }>> {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        if (typeof statement?._execute !== "function") {
          throw new Error(
            "SqliteD1.batch only supports statements created by prepare()",
          );
        }
        statement._execute();
        return { success: true };
      });
      this.db.exec("COMMIT");
      return results;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // D1Database.exec(): runs one or more semicolon-separated statements. Backed
  // by node:sqlite's native exec, which accepts multi-statement SQL.
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.queries.push(sql);
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: new SqliteD1() as unknown as D1Database,
    SESSION_SECRET: "test-jwt-secret-0123456789abcdef",
    SETUP_SECRET: "test-setup-secret",
    TABLE_PREFIX: "",
    ASSETS: {
      fetch: async () => new Response("not found", { status: 404 }),
    } as unknown as Fetcher,
    // No R2 binding by default: that mirrors local/preview environments, and
    // asset tests opt in with `{ R2: new MemoryR2() }`.
    R2: undefined as unknown as R2Bucket,
    ...overrides,
  };
}

/**
 * In-memory `R2Bucket` stand-in for unit tests (same spirit as the ASSETS stub
 * above). Only the surface the Worker uses is implemented: put / get / delete
 * plus stored `httpMetadata`, with a `deleted` log for assertions.
 */
export class MemoryR2 {
  readonly objects = new Map<
    string,
    {
      bytes: Uint8Array;
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
      uploaded?: Date;
    }
  >();
  readonly deleted: string[] = [];

  async put(
    key: string,
    value: Uint8Array | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown> {
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    // Copy so later mutation of the source buffer cannot affect the stored body.
    this.objects.set(key, {
      bytes: new Uint8Array(bytes),
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      uploaded: new Date(),
    });
    return { key };
  }

  /** R2ObjectBody 的最小替身：图标缓存读 customMetadata / uploaded / bytes()。 */
  async get(key: string): Promise<unknown | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key,
      size: object.bytes.byteLength,
      etag: "etag",
      uploaded: object.uploaded ?? new Date(0),
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      body: new Response(object.bytes).body,
      bytes: async () => new Uint8Array(object.bytes),
      arrayBuffer: async () => object.bytes.slice().buffer,
      text: async () => new TextDecoder().decode(object.bytes),
    };
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }

  async head(key: string): Promise<unknown | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return { key, size: object.bytes.byteLength };
  }
}

export function setTablePrefix(env: Env, prefix: string): Env {
  return { ...env, TABLE_PREFIX: prefix };
}

export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export function jsonRequest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
