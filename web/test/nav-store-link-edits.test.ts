import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  adminCreateLink,
  adminDeleteLink,
  adminListAll,
  adminListLinks,
  adminMoveLink,
  type AdminData,
} from "@/lib/api";
import {
  resetAdminOrderState,
  resetHomeEditState,
  useNavStore,
} from "@/lib/nav-store";
import type {
  AdminCategory,
  AdminLink,
  AdminScene,
  PrivateData,
  SiteSettings,
} from "@/lib/types";
import { deferred } from "./deferred";

/**
 * 首页编辑模式（store 层）：乐观写入 / 串行发送 / 失败整体回滚 / 延迟删除。
 * 只 mock 三个会发请求的 api，其余实现保留真实逻辑；sonner 的 toast 全程打桩。
 */

vi.mock("sonner", () => {
  const toastFn = vi.fn(() => "toast-id");
  return {
    toast: Object.assign(toastFn, {
      success: vi.fn(),
      error: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminListAll: vi.fn(),
    adminListLinks: vi.fn(),
    adminCreateLink: vi.fn(),
    adminMoveLink: vi.fn(),
    adminDeleteLink: vi.fn(),
  };
});

const listAllMock = vi.mocked(adminListAll);
const listLinksMock = vi.mocked(adminListLinks);
const createMock = vi.mocked(adminCreateLink);
const moveMock = vi.mocked(adminMoveLink);
const deleteMock = vi.mocked(adminDeleteLink);
const toastMock = vi.mocked(toast);
const toastErrorMock = vi.mocked(toast.error);
const toastDismissMock = vi.mocked(toast.dismiss);

const stamp = "2026-11-08T00:00:00.000Z";

const settings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

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

/** 两个有链接的分类 + 一个空分类；sortOrder 0..3 的全局序列。 */
function makeAdminData(): AdminData {
  return {
    scenes: [scene("scene_default", "通用", 0, true)],
    categories: [
      category("c1", "开发", 0),
      category("c2", "阅读", 1),
      category("c3", "空", 2),
    ],
    links: [
      link("l1", "c1", "GitHub", 0),
      link("l2", "c2", "少数派", 1),
      link("l3", "c1", "MDN", 2),
      link("l4", "c2", "V2EX", 3),
    ],
    searchEngines: [],
    settings,
  };
}

function toPrivate(data: AdminData): PrivateData {
  return {
    categories: data.categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      sceneId: c.sceneId,
      sortOrder: c.sortOrder,
      links: data.links
        .filter((l) => l.categoryId === c.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => ({
          id: l.id,
          categoryId: l.categoryId,
          title: l.title,
          url: l.url,
          iconUrl: l.iconUrl,
          description: l.description,
          sortOrder: l.sortOrder,
        })),
    })),
    scenes: data.scenes,
    searchEngines: data.searchEngines,
    settings: data.settings,
  };
}

function seed(data: AdminData = makeAdminData()) {
  useNavStore.setState({
    adminData: data,
    privateData: toPrivate(data),
    publicData: null,
    authStatus: "authenticated",
    editMode: false,
    loginPromptOpen: false,
    error: null,
  });
}

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);
const adminData = () => {
  const data = useNavStore.getState().adminData;
  if (!data) throw new Error("adminData 未就绪");
  return data;
};
const privateLinks = (categoryId: string) =>
  ids(
    useNavStore
      .getState()
      .privateData!.categories.find((c) => c.id === categoryId)!.links,
  );
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

interface ToastAction {
  duration?: number;
  action?: { label: string; onClick: () => void };
}

function lastToastOptions(): ToastAction {
  const call = toastMock.mock.calls.at(-1);
  return (call?.[1] ?? {}) as ToastAction;
}

beforeEach(() => {
  resetAdminOrderState();
  resetHomeEditState();
  listAllMock.mockReset();
  listLinksMock.mockReset();
  createMock.mockReset();
  moveMock.mockReset();
  deleteMock.mockReset();
  toastMock.mockClear();
  toastErrorMock.mockClear();
  toastDismissMock.mockClear();
  moveMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  resetHomeEditState();
});

describe("moveLinkOnHome：乐观写入 + 串行保存", () => {
  it("跨分类拖动：请求还在飞就已改分组 + 重写顺序，公开页投影同步、不整表重拉", async () => {
    const pending = deferred();
    moveMock.mockReturnValue(pending.promise);

    const done = useNavStore.getState().moveLinkOnHome({
      linkId: "l1",
      categoryId: "c2",
      afterId: "l2",
    });

    expect(ids(adminData().links)).toEqual(["l2", "l1", "l3", "l4"]);
    expect(adminData().links.find((l) => l.id === "l1")?.categoryId).toBe("c2");
    expect(adminData().links.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3]);
    // 公开页读 privateData：分类内顺序已经跟上
    expect(privateLinks("c1")).toEqual(["l3"]);
    expect(privateLinks("c2")).toEqual(["l2", "l1", "l4"]);
    expect(moveMock).toHaveBeenCalledWith({
      linkId: "l1",
      categoryId: "c2",
      ids: ["l2", "l1", "l3", "l4"],
    });

    pending.resolve();
    await done;

    expect(listAllMock).not.toHaveBeenCalled();
    expect(ids(adminData().links)).toEqual(["l2", "l1", "l3", "l4"]);
  });

  it("连续两次拖动：同一时刻只有一个请求在飞，第二次用最新顺序补发", async () => {
    const first = deferred();
    const second = deferred();
    moveMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useNavStore.getState().moveLinkOnHome({
      linkId: "l1",
      categoryId: "c2",
      afterId: "l2",
    });
    const p2 = useNavStore.getState().moveLinkOnHome({
      linkId: "l4",
      categoryId: "c1",
      afterId: null,
    });
    expect(moveMock).toHaveBeenCalledTimes(1);

    first.resolve();
    await p1;
    await flushAsync();
    expect(moveMock).toHaveBeenCalledTimes(2);
    expect(moveMock).toHaveBeenNthCalledWith(2, {
      linkId: "l4",
      categoryId: "c1",
      ids: ["l2", "l1", "l4", "l3"],
    });

    second.resolve();
    await p2;
    expect(privateLinks("c1")).toEqual(["l4", "l3"]);
    expect(privateLinks("c2")).toEqual(["l2", "l1"]);
  });

  it("保存失败：顺序 + 分组整体回滚到拖动前，并抛错给调用方（不重拉整表）", async () => {
    const pending = deferred();
    moveMock.mockReturnValue(pending.promise);

    const done = useNavStore.getState().moveLinkOnHome({
      linkId: "l1",
      categoryId: "c2",
      afterId: "l2",
    });
    pending.reject(new Error("move failed"));
    await expect(done).rejects.toThrow("move failed");

    expect(ids(adminData().links)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(adminData().links.find((l) => l.id === "l1")?.categoryId).toBe("c1");
    expect(adminData().links.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(privateLinks("c1")).toEqual(["l1", "l3"]);
    expect(privateLinks("c2")).toEqual(["l2", "l4"]);
    expect(listAllMock).not.toHaveBeenCalled();
  });

  it("连续两次拖动中第二次失败：本轮两次乐观写入一起回到快照", async () => {
    const first = deferred();
    const second = deferred();
    moveMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useNavStore.getState().moveLinkOnHome({
      linkId: "l1",
      categoryId: "c2",
      afterId: "l2",
    });
    const p2 = useNavStore.getState().moveLinkOnHome({
      linkId: "l4",
      categoryId: "c1",
      afterId: null,
    });

    first.resolve();
    await p1;
    await flushAsync();
    second.reject(new Error("boom"));
    await expect(p2).rejects.toThrow("boom");

    expect(ids(adminData().links)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(adminData().links.find((l) => l.id === "l1")?.categoryId).toBe("c1");
    expect(adminData().links.find((l) => l.id === "l4")?.categoryId).toBe("c2");
    expect(privateLinks("c1")).toEqual(["l1", "l3"]);
    expect(privateLinks("c2")).toEqual(["l2", "l4"]);
  });

  it("拖动失败时，期间点 ✕ 的链接不会被回滚复活（待删定时器照常落库）", async () => {
    const pending = deferred();
    moveMock.mockReturnValue(pending.promise);

    const done = useNavStore.getState().moveLinkOnHome({
      linkId: "l1",
      categoryId: "c2",
      afterId: "l2",
    });
    useNavStore.getState().removeLinkOnHome("l3");
    expect(ids(adminData().links)).toEqual(["l2", "l1", "l4"]);

    pending.reject(new Error("move failed"));
    await expect(done).rejects.toThrow("move failed");

    // 成员以当前为准：l3 是用户刚删的，不回到界面上；回滚只恢复顺序与归属
    expect(ids(adminData().links)).toEqual(["l1", "l2", "l4"]);
    expect(adminData().links.find((l) => l.id === "l1")?.categoryId).toBe("c1");
    expect(privateLinks("c1")).toEqual(["l1"]);
    expect(privateLinks("c2")).toEqual(["l2", "l4"]);
  });

  it("拖动失败时，期间撤销恢复的链接不会被回滚抹掉", async () => {
    const pending = deferred();
    moveMock.mockReturnValue(pending.promise);

    const done = useNavStore.getState().moveLinkOnHome({
      linkId: "l1",
      categoryId: "c2",
      afterId: "l2",
    });
    useNavStore.getState().removeLinkOnHome("l2");
    lastToastOptions().action?.onClick(); // 撤销窗口内点「撤销」：只恢复本地
    expect(ids(adminData().links)).toContain("l2");

    pending.reject(new Error("move failed"));
    await expect(done).rejects.toThrow("move failed");

    expect(ids(adminData().links)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(adminData().links.find((l) => l.id === "l2")?.categoryId).toBe("c2");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("settleLinkOrder 等首页拖动落库后才返回（换分类保存前调用）", async () => {
    const pending = deferred();
    moveMock.mockReturnValue(pending.promise);

    const done = useNavStore.getState().moveLinkOnHome({
      linkId: "l1",
      categoryId: "c2",
      afterId: "l2",
    });
    let settled = false;
    const settle = useNavStore
      .getState()
      .settleLinkOrder()
      .then(() => {
        settled = true;
      });

    await flushAsync();
    expect(settled).toBe(false);

    pending.resolve();
    await settle;
    await done;
    expect(settled).toBe(true);
  });
});

describe("removeLinkOnHome：延迟删除 + 撤销", () => {
  it("点 ✕ 立即移除并弹带撤销的 toast；窗口内不发请求，撤销恢复原位", async () => {
    vi.useFakeTimers();
    useNavStore.getState().removeLinkOnHome("l2");

    expect(ids(adminData().links)).toEqual(["l1", "l3", "l4"]);
    expect(privateLinks("c2")).toEqual(["l4"]);
    const options = lastToastOptions();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(options.duration).toBe(5000);
    expect(options.action?.label).toBe("撤销");

    await vi.advanceTimersByTimeAsync(3000);
    options.action?.onClick();

    expect(ids(adminData().links)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(adminData().links.find((l) => l.id === "l2")?.sortOrder).toBe(1);
    expect(privateLinks("c2")).toEqual(["l2", "l4"]);
    expect(toastDismissMock).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(6000);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("窗口结束时才调删除接口（窗口内不发）", async () => {
    vi.useFakeTimers();
    useNavStore.getState().removeLinkOnHome("l2");

    await vi.advanceTimersByTimeAsync(4999);
    expect(deleteMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deleteMock).toHaveBeenCalledWith("l2");
    expect(toastDismissMock).toHaveBeenCalled();
  });

  it("退出编辑模式：待删除立即落库（撤销窗口结束）", () => {
    useNavStore.setState({ editMode: true });
    useNavStore.getState().removeLinkOnHome("l3");
    expect(deleteMock).not.toHaveBeenCalled();

    useNavStore.getState().exitEditMode();

    expect(useNavStore.getState().editMode).toBe(false);
    expect(deleteMock).toHaveBeenCalledWith("l3");
    expect(toastDismissMock).toHaveBeenCalled();
  });

  it("落库失败：把链接插回原位并报错", async () => {
    vi.useFakeTimers();
    deleteMock.mockRejectedValue(new Error("offline"));

    useNavStore.getState().removeLinkOnHome("l2");
    expect(ids(adminData().links)).toEqual(["l1", "l3", "l4"]);

    await vi.advanceTimersByTimeAsync(5000);

    expect(ids(adminData().links)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(adminData().links.find((l) => l.id === "l2")?.sortOrder).toBe(1);
    expect(privateLinks("c2")).toEqual(["l2", "l4"]);
    expect(toastErrorMock).toHaveBeenCalledWith("删除失败：offline");
  });
});

describe("applySavedLink：弹窗保存后就地生效", () => {
  it("替换链接字段并同步公开页投影，改分类后落到目标分类末尾", () => {
    const original = adminData().links.find((l) => l.id === "l1")!;
    useNavStore.getState().applySavedLink({
      ...original,
      title: "GitHub 新版",
      categoryId: "c2",
      sortOrder: 4,
    });

    expect(adminData().links.find((l) => l.id === "l1")?.title).toBe(
      "GitHub 新版",
    );
    expect(privateLinks("c1")).toEqual(["l3"]);
    expect(privateLinks("c2")).toEqual(["l2", "l4", "l1"]);
    expect(listAllMock).not.toHaveBeenCalled();
  });

  it("store 里还没有的链接（新建）直接追加并同步投影", () => {
    useNavStore.getState().applySavedLink(link("l5", "c1", "新链接", 4));

    expect(ids(adminData().links)).toEqual(["l1", "l2", "l3", "l4", "l5"]);
    expect(privateLinks("c1")).toEqual(["l1", "l3", "l5"]);
  });
});

describe("createLinkOnHome：新建按「分类末尾」提交并读回完整 DTO", () => {
  it("显式送全局 MAX+1 的 sortOrder，返回读回的 DTO（并入 store 由调用方做）", async () => {
    const created = link("l5", "c1", "新链接", 4);
    createMock.mockResolvedValue({ id: "l5" });
    listLinksMock.mockResolvedValue([...adminData().links, created]);

    const saved = await useNavStore.getState().createLinkOnHome({
      categoryId: "c1",
      title: "新链接",
      url: "https://example.com/l5",
    });

    // 契约省略 sortOrder 会兜底 0（插到分类最前），这里必须显式给全局 MAX+1
    expect(createMock).toHaveBeenCalledWith({
      categoryId: "c1",
      title: "新链接",
      url: "https://example.com/l5",
      sortOrder: 4,
    });
    expect(saved).toEqual(created);
    // 只读回、不整表替换：store 由 applySavedLink 并入
    expect(ids(adminData().links)).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("待删链接占的槽位也算进基数（避免与待删行同号）", async () => {
    useNavStore.getState().removeLinkOnHome("l4");
    createMock.mockResolvedValue({ id: "l5" });
    listLinksMock.mockResolvedValue([
      ...adminData().links,
      link("l5", "c1", "新链接", 4),
    ]);

    await useNavStore.getState().createLinkOnHome({
      categoryId: "c1",
      title: "新链接",
      url: "https://example.com/l5",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 4 }),
    );
  });

  it("读回不到这条链接：报「已创建但读回失败」，不重试创建", async () => {
    createMock.mockResolvedValue({ id: "l5" });
    listLinksMock.mockResolvedValue([...adminData().links]);

    await expect(
      useNavStore.getState().createLinkOnHome({
        categoryId: "c1",
        title: "新链接",
        url: "https://example.com/l5",
      }),
    ).rejects.toThrow("链接已创建，但读回失败，请刷新页面后确认");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("创建失败：错误原样透传，不读列表", async () => {
    createMock.mockRejectedValue(new Error("离线"));

    await expect(
      useNavStore.getState().createLinkOnHome({
        categoryId: "c1",
        title: "新链接",
        url: "https://example.com/l5",
      }),
    ).rejects.toThrow("离线");
    expect(listLinksMock).not.toHaveBeenCalled();
  });
});

describe("enterEditMode：进入前拉一份最新的后台数据", () => {
  it("成功：editMode 打开，adminData / privateData 同步为新数据", async () => {
    const fresh = makeAdminData();
    listAllMock.mockResolvedValue(fresh);

    const ok = await useNavStore.getState().enterEditMode();

    expect(ok).toBe(true);
    expect(useNavStore.getState().editMode).toBe(true);
    expect(useNavStore.getState().adminData).toEqual(fresh);
    expect(privateLinks("c2")).toEqual(["l2", "l4"]);
  });

  it("拉取失败：不进入编辑模式（返回 false，界面留在正常模式）", async () => {
    listAllMock.mockRejectedValue(new Error("boom"));

    const ok = await useNavStore.getState().enterEditMode();

    expect(ok).toBe(false);
    expect(useNavStore.getState().editMode).toBe(false);
  });

  it("未登录：直接返回 false，不发请求", async () => {
    useNavStore.setState({ authStatus: "anonymous" });
    const ok = await useNavStore.getState().enterEditMode();
    expect(ok).toBe(false);
    expect(listAllMock).not.toHaveBeenCalled();
  });

  it("拉数据期间退出（点完铅笔立刻离开页面）：返回后不再点亮编辑模式", async () => {
    const pending = deferred<AdminData>();
    listAllMock.mockReturnValue(pending.promise);

    const entering = useNavStore.getState().enterEditMode();
    useNavStore.getState().exitEditMode();
    pending.resolve(makeAdminData());

    await expect(entering).resolves.toBe(false);
    expect(useNavStore.getState().editMode).toBe(false);
  });
});
