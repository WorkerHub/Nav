import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminListAll,
  adminReorderCategories,
  adminReorderEngines,
  adminReorderLinks,
  adminReorderScenes,
  type AdminData,
} from "@/lib/api";
import { resetAdminOrderState, useNavStore } from "@/lib/nav-store";
import type {
  AdminCategory,
  AdminLink,
  AdminScene,
  SearchEngine,
} from "@/lib/types";
import { deferred } from "./deferred";

// store 层排序：只 mock 重拉与三个 reorder 请求，其余 api 保留真实实现。
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminListAll: vi.fn(),
    adminReorderCategories: vi.fn(),
    adminReorderLinks: vi.fn(),
    adminReorderEngines: vi.fn(),
    adminReorderScenes: vi.fn(),
  };
});

const listAllMock = vi.mocked(adminListAll);
const reorderCategoriesMock = vi.mocked(adminReorderCategories);
const reorderLinksMock = vi.mocked(adminReorderLinks);
const reorderEnginesMock = vi.mocked(adminReorderEngines);
const reorderScenesMock = vi.mocked(adminReorderScenes);

const stamp = "2026-11-06T00:00:00.000Z";

function category(id: string, name: string, sortOrder: number): AdminCategory {
  return {
    id,
    name,
    icon: null,
    sceneId: "scene_default",
    sortOrder,
    visibility: "public",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function link(
  id: string,
  categoryId: string,
  title: string,
  sortOrder: number,
): AdminLink {
  return {
    id,
    categoryId,
    title,
    url: `https://example.com/${id}`,
    iconUrl: null,
    description: null,
    sortOrder,
    visibility: "public",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function scene(
  id: string,
  name: string,
  sortOrder: number,
  isDefault: boolean,
): AdminScene {
  return {
    id,
    name,
    icon: null,
    sortOrder,
    isDefault,
    visibility: "public",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function engine(id: string, name: string, sortOrder: number): SearchEngine {
  return {
    id,
    name,
    urlTemplate: `https://${id}.example.com/search?q={q}`,
    icon: null,
    sortOrder,
    isDefault: sortOrder === 0,
  };
}

/** 三个实体都按 sortOrder 0..n-1 排好的「服务端数据」。 */
function makeAdminData(): AdminData {
  return {
    scenes: [],
    categories: [
      category("c1", "开发", 0),
      category("c2", "阅读", 1),
      category("c3", "日常", 2),
    ],
    links: [
      link("l1", "c1", "GitHub", 0),
      link("l2", "c2", "少数派", 1),
      link("l3", "c1", "MDN", 2),
      link("l4", "c2", "V2EX", 4),
    ],
    searchEngines: [engine("e1", "Google", 0), engine("e2", "Bing", 1)],
    settings: {
      siteTitle: "我的导航",
      backgroundUrl: "",
      wallpaperSource: "bing",
      logoUrl: "",
      columns: 6,
      searchNewTab: true,
    },
  };
}

function seed(data: AdminData = makeAdminData()) {
  useNavStore.setState({ adminData: data, authStatus: "authenticated" });
}

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);
const orders = (list: readonly { sortOrder: number }[]) =>
  list.map((item) => item.sortOrder);

/** 让失败后触发的那次 loadAdmin 落地（真实网络下是异步的）。 */
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

function adminData(): AdminData {
  const data = useNavStore.getState().adminData;
  if (!data) throw new Error("adminData 未就绪");
  return data;
}

beforeEach(() => {
  resetAdminOrderState();
  listAllMock.mockReset();
  reorderCategoriesMock.mockReset();
  reorderLinksMock.mockReset();
  reorderEnginesMock.mockReset();
  reorderScenesMock.mockReset();
  reorderCategoriesMock.mockResolvedValue(undefined);
  reorderLinksMock.mockResolvedValue(undefined);
  reorderEnginesMock.mockResolvedValue(undefined);
  reorderScenesMock.mockResolvedValue(undefined);
  seed();
});

describe("排序乐观写入：请求在飞时界面已经是新顺序", () => {
  it("分类：请求未落地就已重排并重写 sortOrder，且只发一次请求", async () => {
    const pending = deferred();
    reorderCategoriesMock.mockReturnValue(pending.promise);

    const done = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    expect(ids(adminData().categories)).toEqual(["c2", "c1", "c3"]);
    expect(orders(adminData().categories)).toEqual([0, 1, 2]);
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(1);
    expect(reorderCategoriesMock).toHaveBeenCalledWith(["c2", "c1", "c3"]);
    expect(listAllMock).not.toHaveBeenCalled();

    pending.resolve();
    await done;

    // 成功即以本地为准：不再整表回拉
    expect(listAllMock).not.toHaveBeenCalled();
    expect(ids(adminData().categories)).toEqual(["c2", "c1", "c3"]);
  });

  it("链接与搜索引擎：全局 ids 原样应用，sortOrder 连续重写", async () => {
    await useNavStore.getState().reorderLinks(["l3", "l1", "l2", "l4"]);
    expect(ids(adminData().links)).toEqual(["l3", "l1", "l2", "l4"]);
    expect(orders(adminData().links)).toEqual([0, 1, 2, 3]);
    expect(reorderLinksMock).toHaveBeenCalledWith(["l3", "l1", "l2", "l4"]);

    await useNavStore.getState().reorderEngines(["e2", "e1"]);
    expect(ids(adminData().searchEngines)).toEqual(["e2", "e1"]);
    expect(orders(adminData().searchEngines)).toEqual([0, 1]);
    expect(reorderEnginesMock).toHaveBeenCalledWith(["e2", "e1"]);
  });

  it("adminData 未加载时是空转：不发请求也不写状态", async () => {
    useNavStore.setState({ adminData: null });
    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    expect(reorderCategoriesMock).not.toHaveBeenCalled();
    expect(useNavStore.getState().adminData).toBeNull();
  });
});

describe("在飞期间连续拖拽：串行发送，只补发最新一次", () => {
  it("第二个请求要等第一个落地后才发，且携带的是最新顺序", async () => {
    const first = deferred();
    reorderCategoriesMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);

    const done1 = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    const done2 = useNavStore.getState().reorderCategories(["c3", "c1", "c2"]);

    // 界面已经是最后一次拖拽的顺序，而网络上一个请求都还没落地
    expect(ids(adminData().categories)).toEqual(["c3", "c1", "c2"]);
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(1);
    await done2; // 本次调用被合并，立即返回

    first.resolve();
    await done1;

    expect(reorderCategoriesMock).toHaveBeenCalledTimes(2);
    // 旧顺序不会被「再发一次」盖掉新顺序：第二次发的是最新 ids
    expect(reorderCategoriesMock).toHaveBeenLastCalledWith(["c3", "c1", "c2"]);
    expect(ids(adminData().categories)).toEqual(["c3", "c1", "c2"]);
    expect(listAllMock).not.toHaveBeenCalled();
  });

  it("第一次失败但已有更新的顺序待发：不回滚、不抛错，补发后成功", async () => {
    const first = deferred();
    reorderCategoriesMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);

    const done1 = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    const done2 = useNavStore.getState().reorderCategories(["c3", "c2", "c1"]);

    first.reject(new Error("boom"));
    await expect(done1).resolves.toBeUndefined();
    await done2;

    expect(ids(adminData().categories)).toEqual(["c3", "c2", "c1"]);
    expect(reorderCategoriesMock).toHaveBeenLastCalledWith(["c3", "c2", "c1"]);
    expect(listAllMock).not.toHaveBeenCalled();
  });
});

describe("会话切换：旧会话的在飞请求静默退出", () => {
  it("旧请求落地不改新会话的顺序（localIds 不被旧顺序覆盖）", async () => {
    const oldReq = deferred();
    reorderCategoriesMock
      .mockReturnValueOnce(oldReq.promise)
      .mockResolvedValue(undefined);

    const doneOld = useNavStore
      .getState()
      .reorderCategories(["c2", "c1", "c3"]);

    // 会话失效（401 / 登出）：清空簿记，再以新会话的数据重新进入
    resetAdminOrderState();
    seed();

    const doneNew = useNavStore
      .getState()
      .reorderCategories(["c3", "c2", "c1"]);
    // 旧 1 + 新 1：没有因为簿记被清而复活出第二条循环
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(2);

    oldReq.resolve();
    await expect(doneOld).resolves.toBeUndefined();
    await flushAsync();

    // 旧循环必须彻底静默：不得写 localIds，也不得因为「集合看起来变了」而补发请求
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(2);

    // 旧会话的顺序不得写回 localIds：新会话的整表重拉仍保持自己的顺序
    listAllMock.mockResolvedValue(makeAdminData());
    await useNavStore.getState().loadAdmin();
    expect(ids(adminData().categories)).toEqual(["c3", "c2", "c1"]);
    await doneNew;
  });

  it("旧请求失败不回滚新会话，也不触发回拉", async () => {
    const oldReq = deferred();
    reorderCategoriesMock
      .mockReturnValueOnce(oldReq.promise)
      .mockResolvedValue(undefined);

    const doneOld = useNavStore
      .getState()
      .reorderCategories(["c2", "c1", "c3"]);
    resetAdminOrderState();
    seed();
    const doneNew = useNavStore
      .getState()
      .reorderCategories(["c3", "c2", "c1"]);

    oldReq.reject(new Error("boom"));
    await expect(doneOld).resolves.toBeUndefined(); // 静默退出，不抛错给面板
    await flushAsync();

    expect(ids(adminData().categories)).toEqual(["c3", "c2", "c1"]);
    expect(listAllMock).not.toHaveBeenCalled();
    await doneNew;
  });

  it("旧循环落地不清掉新循环的 running：新会话仍是单飞", async () => {
    const oldReq = deferred();
    const newReq = deferred();
    reorderEnginesMock
      .mockReturnValueOnce(oldReq.promise)
      .mockReturnValueOnce(newReq.promise)
      .mockResolvedValue(undefined);

    const doneOld = useNavStore.getState().reorderEngines(["e2", "e1"]);
    resetAdminOrderState();
    seed();
    const doneNew = useNavStore.getState().reorderEngines(["e2", "e1"]);
    expect(reorderEnginesMock).toHaveBeenCalledTimes(2);

    oldReq.resolve();
    await expect(doneOld).resolves.toBeUndefined();
    await flushAsync();

    // 新会话再点一次：只能登记，不能因为旧循环 finally 清了 running 就并发开新循环
    const doneThird = useNavStore.getState().reorderEngines(["e1", "e2"]);
    expect(reorderEnginesMock).toHaveBeenCalledTimes(2);

    newReq.resolve();
    await doneNew;
    await doneThird;
    expect(reorderEnginesMock).toHaveBeenCalledTimes(3);
    expect(reorderEnginesMock).toHaveBeenLastCalledWith(["e1", "e2"]);
  });
});

describe("排序在飞期间发生增删：落地后补发一次", () => {
  it("新建实体不在本次 ids 里时，用当前全量顺序补发，服务端与界面一致", async () => {
    const first = deferred();
    reorderCategoriesMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);

    const done = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    // 排序在飞时新建了 c4（后端 sort_order 默认 0），onChanged 触发整表重拉
    listAllMock.mockResolvedValue({
      ...makeAdminData(),
      categories: [
        category("c1", "开发", 0),
        category("c4", "新分类", 0),
        category("c2", "阅读", 1),
        category("c3", "日常", 2),
      ],
    });
    await useNavStore.getState().loadAdmin();
    expect(ids(adminData().categories)).toEqual(["c2", "c4", "c1", "c3"]);

    first.resolve();
    await done;

    // 本次提交的 ids 里没有 c4：补发一次当前全量顺序，否则服务端会把它留在 sort_order 0
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(2);
    expect(reorderCategoriesMock).toHaveBeenLastCalledWith([
      "c2",
      "c4",
      "c1",
      "c3",
    ]);
    expect(ids(adminData().categories)).toEqual(["c2", "c4", "c1", "c3"]);
    expect(listAllMock).toHaveBeenCalledTimes(1);
  });
});

describe("连拖 + 期间落一次整表重拉", () => {
  it("界面与最后提交的顺序都等于最后一次拖拽（旧顺序不得被写回）", async () => {
    const first = deferred();
    const second = deferred();
    reorderCategoriesMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(undefined);
    listAllMock.mockResolvedValue(makeAdminData()); // 服务端始终停在旧顺序

    const done1 = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    const done2 = useNavStore.getState().reorderCategories(["c3", "c2", "c1"]);

    first.resolve();
    await flushAsync(); // 第 1 个落地，第 2 个开始飞

    // 这个窗口里落一次整表重拉（例如同时编辑了名称）：不能把界面盖回第 1 次的顺序
    await useNavStore.getState().loadAdmin();
    expect(ids(adminData().categories)).toEqual(["c3", "c2", "c1"]);

    second.resolve();
    await done1;
    await done2;

    // 补发不得把旧顺序真的写进服务端：最后一次提交必须是用户的最后一次拖拽
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(2);
    expect(reorderCategoriesMock).toHaveBeenLastCalledWith(["c3", "c2", "c1"]);
    expect(ids(adminData().categories)).toEqual(["c3", "c2", "c1"]);
  });
});

describe("排序失败：回滚 + 按服务端再刷一次", () => {
  it("终止失败回滚到操作前顺序、抛错给面板 toast，并按服务端刷新一次", async () => {
    const pending = deferred();
    reorderCategoriesMock.mockReturnValue(pending.promise);
    listAllMock.mockResolvedValue(makeAdminData());

    const done = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    expect(ids(adminData().categories)).toEqual(["c2", "c1", "c3"]);

    pending.reject(new Error("boom"));
    await expect(done).rejects.toThrow("boom");
    expect(ids(adminData().categories)).toEqual(["c1", "c2", "c3"]);

    await flushAsync();
    expect(ids(adminData().categories)).toEqual(["c1", "c2", "c3"]);
    expect(orders(adminData().categories)).toEqual([0, 1, 2]);
    // 后端逐条 UPDATE 无事务，失败可能已部分生效：以服务端为准再刷一次
    expect(listAllMock).toHaveBeenCalledTimes(1);
  });

  it("失败后的服务端刷新也失败（断网）时，本地仍回到操作前顺序", async () => {
    const pending = deferred();
    reorderCategoriesMock.mockReturnValue(pending.promise);
    listAllMock.mockRejectedValue(new Error("offline"));

    const done = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    pending.reject(new Error("boom"));
    await expect(done).rejects.toThrow("boom");

    await flushAsync();
    // 重拉拿不到数据，回滚就是唯一保障：不能停在失败的那份乐观顺序上
    expect(ids(adminData().categories)).toEqual(["c1", "c2", "c3"]);
    expect(orders(adminData().categories)).toEqual([0, 1, 2]);
  });
});

describe("loadAdmin 投影：旧响应不覆盖本地顺序", () => {
  it("排序成功后，服务端返回旧顺序也不会把界面盖回去", async () => {
    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    listAllMock.mockResolvedValue(makeAdminData()); // 服务端仍是旧顺序
    await useNavStore.getState().loadAdmin();

    expect(ids(adminData().categories)).toEqual(["c2", "c1", "c3"]);
    expect(orders(adminData().categories)).toEqual([0, 1, 2]);
  });

  it("排序后新增的实体（不在本地顺序里）保持服务端位置，不挪到末尾", async () => {
    reorderCategoriesMock.mockResolvedValue(undefined);
    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    // 新建实体的 sort_order 默认 0，服务端按 (sort_order, created_at) 会把它排在中间
    listAllMock.mockResolvedValue({
      ...makeAdminData(),
      categories: [
        category("c1", "开发", 0),
        category("c4", "新分类", 0),
        category("c2", "阅读", 1),
        category("c3", "日常", 2),
      ],
    });
    await useNavStore.getState().loadAdmin();

    expect(ids(adminData().categories)).toEqual(["c2", "c4", "c1", "c3"]);
    // 只重写本次 ids 覆盖的项（分类的 sort_order 是场景内序号）：c4 不在 ids 里，
    // 保留它服务端的 0；被排序的三项按 ids 顺序重写为 0..2。
    expect(orders(adminData().categories)).toEqual([0, 0, 1, 2]);
  });

  it("会话结束时清空簿记：重新加载回到服务端顺序", async () => {
    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    resetAdminOrderState();

    listAllMock.mockResolvedValue(makeAdminData());
    await useNavStore.getState().loadAdmin();

    expect(ids(adminData().categories)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("场景维度：分类排序按场景作用域提交", () => {
  it("只排当前场景：成功后不补发整表，别场景的分类原地不动", async () => {
    seed({
      ...makeAdminData(),
      categories: [
        { ...category("c1", "开发", 0), sceneId: "s_a" },
        { ...category("c2", "阅读", 1), sceneId: "s_b" },
        { ...category("c3", "日常", 2), sceneId: "s_a" },
      ],
    });

    await useNavStore.getState().reorderCategories(["c3", "c1"]);

    // 只发一次（若拿全量分类做补发比较，这里会多出一次全量 ids 请求）
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(1);
    expect(reorderCategoriesMock).toHaveBeenCalledWith(["c3", "c1"]);
    // 场景内顺序已换；场景 B 的「阅读」保持原位
    expect(ids(adminData().categories)).toEqual(["c3", "c2", "c1"]);
  });

  it("场景排序：全局顺序乐观应用并发送", async () => {
    seed({
      ...makeAdminData(),
      scenes: [scene("s_a", "工作", 0, false), scene("s_b", "通用", 1, true)],
    });

    const done = useNavStore.getState().reorderScenes(["s_b", "s_a"]);
    expect(ids(adminData().scenes)).toEqual(["s_b", "s_a"]);
    expect(orders(adminData().scenes)).toEqual([0, 1]);
    expect(reorderScenesMock).toHaveBeenCalledWith(["s_b", "s_a"]);

    await done;
    expect(listAllMock).not.toHaveBeenCalled();
  });
});
describe("场景内排序不污染其他场景的 sortOrder", () => {
  it("只排一个场景时，另一场景的 sortOrder 保持服务端值（新建分类才能正确算末尾）", async () => {
    seed({
      ...makeAdminData(),
      categories: [
        { ...category("a1", "A-1", 0), sceneId: "s_a" },
        { ...category("b1", "B-1", 5), sceneId: "s_b" },
        { ...category("a2", "A-2", 9), sceneId: "s_a" },
        { ...category("b2", "B-2", 10), sceneId: "s_b" },
      ],
    });

    // 只拖场景 B 的下一项：B 重写为 0/1，A 的 0/9 不被按全局位置重编号
    await useNavStore.getState().reorderCategories(["b2", "b1"]);

    const byId = new Map(adminData().categories.map((c) => [c.id, c]));
    expect(byId.get("b2")?.sortOrder).toBe(0);
    expect(byId.get("b1")?.sortOrder).toBe(1);
    expect(byId.get("a1")?.sortOrder).toBe(0);
    expect(byId.get("a2")?.sortOrder).toBe(9);
    // 场景 B 顺序已换、A 的相对顺序不变
    expect(
      adminData()
        .categories.filter((c) => c.sceneId === "s_b")
        .sort((x, y) => x.sortOrder - y.sortOrder)
        .map((c) => c.id),
    ).toEqual(["b2", "b1"]);
    expect(
      adminData()
        .categories.filter((c) => c.sceneId === "s_a")
        .sort((x, y) => x.sortOrder - y.sortOrder)
        .map((c) => c.id),
    ).toEqual(["a1", "a2"]);
  });
});
