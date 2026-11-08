import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/admin/links/move` 的前端接线（#28 冻结契约）：
 * 路径、body 字段、失败时把后端错误原文收敛成 ApiError。
 */

async function loadApi() {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  return import("@/lib/api");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("adminMoveLink", () => {
  it("POST /api/admin/links/move：body 带 linkId / categoryId / 全局 ids", async () => {
    const fetchMock = vi.fn(async () => json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { adminMoveLink } = await loadApi();

    await adminMoveLink({
      linkId: "l1",
      categoryId: "c2",
      ids: ["l2", "l1", "l3"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/admin/links/move");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      linkId: "l1",
      categoryId: "c2",
      ids: ["l2", "l1", "l3"],
    });
  });

  it("整批失败：后端错误原文（move failed / 500）透出给调用方回滚", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "move failed" }, 500)),
    );
    const { adminMoveLink } = await loadApi();

    await expect(
      adminMoveLink({ linkId: "l1", categoryId: "c2", ids: ["l1"] }),
    ).rejects.toMatchObject({ message: "move failed", status: 500 });
  });
});
