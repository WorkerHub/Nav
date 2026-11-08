import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import {
  adminCreateLink,
  adminListAll,
  adminListLinks,
  type AdminData,
} from "@/lib/api";
import {
  resetAdminOrderState,
  resetHomeEditState,
  useNavStore,
} from "@/lib/nav-store";
import { useScenePreferenceStore } from "@/lib/scene-preference";
import type {
  AdminCategory,
  AdminLink,
  AdminScene,
  PrivateData,
  PublicData,
  Scene,
  SiteCategory,
  SiteSettings,
} from "@/lib/types";

/**
 * 首页编辑模式的端到端行为（组件层）：入口三态、进入/退出、Esc、场景切换、
 * 搜索门槛、空投放位、单击编辑弹窗、✕ 删除与撤销。
 * 真正的拖拽手势在 jsdom 里不做（顺序重建与保存逻辑由 store / 纯函数用例覆盖）。
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
    adminCreateLink: vi.fn(),
    adminListLinks: vi.fn(),
  };
});

const listAllMock = vi.mocked(adminListAll);
const createLinkMock = vi.mocked(adminCreateLink);
const listLinksMock = vi.mocked(adminListLinks);
const toastMock = vi.mocked(toast);
const toastErrorMock = vi.mocked(toast.error);

const stamp = "2026-11-08T00:00:00.000Z";

const settings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

const common: Scene = {
  id: "s_default",
  name: "通用",
  icon: null,
  sortOrder: 0,
  isDefault: true,
  visibility: "public",
};
const work: Scene = {
  id: "s_work",
  name: "工作",
  icon: null,
  sortOrder: 1,
  isDefault: false,
  visibility: "public",
};

function siteCategory(
  id: string,
  name: string,
  sceneId: string,
  sortOrder: number,
  links: SiteCategory["links"],
): SiteCategory {
  return { id, name, icon: null, sceneId, sortOrder, links };
}

const categories: SiteCategory[] = [
  siteCategory("c-dev", "开发", "s_default", 0, [
    {
      id: "l1",
      categoryId: "c-dev",
      title: "GitHub",
      url: "https://github.com/",
      iconUrl: null,
      description: null,
      sortOrder: 0,
    },
    {
      id: "l2",
      categoryId: "c-dev",
      title: "MDN",
      url: "https://developer.mozilla.org/",
      iconUrl: null,
      description: null,
      sortOrder: 1,
    },
  ]),
  siteCategory("c-empty", "空", "s_default", 1, []),
  siteCategory("c-work", "工作收藏", "s_work", 2, [
    {
      id: "l3",
      categoryId: "c-work",
      title: "Gmail",
      url: "https://mail.google.com/",
      iconUrl: null,
      description: null,
      sortOrder: 2,
    },
  ]),
];

const publicData: PublicData = {
  categories,
  scenes: [common, work],
  searchEngines: [],
  settings,
};
const privateData: PrivateData = { ...publicData };

function adminScene(scene: Scene): AdminScene {
  return { ...scene, createdAt: stamp, updatedAt: stamp };
}

function adminCategory(category: SiteCategory): AdminCategory {
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    sceneId: category.sceneId,
    sortOrder: category.sortOrder,
    visibility: "public",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function adminLink(link: SiteCategory["links"][number]): AdminLink {
  return { ...link, visibility: "public", createdAt: stamp, updatedAt: stamp };
}

function makeAdminData(): AdminData {
  return {
    scenes: [adminScene(common), adminScene(work)],
    categories: categories.map(adminCategory),
    links: categories.flatMap((c) => c.links.map(adminLink)),
    searchEngines: [],
    settings,
  };
}

function seed(
  overrides: Partial<ReturnType<typeof useNavStore.getState>> = {},
) {
  const adminData = makeAdminData();
  listAllMock.mockResolvedValue(adminData);
  useNavStore.setState({
    publicData,
    privateData,
    adminData,
    authStatus: "authenticated",
    editMode: false,
    loginPromptOpen: false,
    error: null,
    loadPublic: async () => {},
    loadPrivate: async () => {},
    ...overrides,
  });
}

function renderPage() {
  return render(<PublicPage onOpenAdmin={vi.fn()} />);
}

async function enterEdit(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "编辑" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "完成编辑" }),
    ).toBeInTheDocument(),
  );
}

beforeEach(() => {
  resetAdminOrderState();
  resetHomeEditState();
  listAllMock.mockReset();
  createLinkMock.mockReset();
  listLinksMock.mockReset();
  toastMock.mockClear();
  toastErrorMock.mockClear();
  useScenePreferenceStore.setState({ raw: "s_default" });
  seed();
});

describe("首页编辑模式：入口三态", () => {
  it("已登录：坞里出现铅笔「编辑」按钮", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("未登录：不渲染编辑入口（服务端鉴权仍是唯一防线）", () => {
    seed({ authStatus: "anonymous" });
    renderPage();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("探活未回：不渲染编辑入口（不闪一排登录态按钮）", () => {
    seed({ authStatus: "pending" });
    renderPage();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });
});

describe("进入 / 退出编辑模式", () => {
  it("点铅笔进入：砖不再跳转、变成可点击编辑的按钮并出现 ✕ 角标；再点退出", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole("link", { name: /GitHub/ })).toBeInTheDocument();

    await enterEdit(user);

    expect(screen.queryByRole("link", { name: /GitHub/ })).toBeNull();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "删除 GitHub" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "完成编辑" }));

    expect(screen.getByRole("link", { name: /GitHub/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除 GitHub" })).toBeNull();
  });

  it("Esc 退出编辑模式", async () => {
    const user = userEvent.setup();
    renderPage();
    await enterEdit(user);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /GitHub/ })).toBeInTheDocument(),
    );
  });

  it("编辑弹窗打开时 Esc 不退出编辑模式（Esc 先归弹窗）", async () => {
    const user = userEvent.setup();
    renderPage();
    await enterEdit(user);
    await user.click(screen.getByRole("button", { name: "MDN" }));
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "Escape" });

    // 弹窗会把背景设为 aria-hidden：用 store 状态判断（编辑模式还在）
    expect(useNavStore.getState().editMode).toBe(true);
  });

  it("重新挂载（等价于刷新）：回到正常模式", async () => {
    const user = userEvent.setup();
    const view = renderPage();
    await enterEdit(user);

    view.unmount();

    expect(useNavStore.getState().editMode).toBe(false);
  });

  it("每个分类网格末尾都有「+」砖，空分类那块兼作落点（不再是空白虚线框）", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await enterEdit(user);

    // 默认场景只有「开发」「空」两个分类
    expect(
      screen.getByRole("button", { name: "向「开发」新增链接" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "向「空」新增链接" }),
    ).toBeInTheDocument();
    // 虚线砖就是这两块「+」砖：没有额外的无文字占位
    expect(container.querySelectorAll(".border-dashed")).toHaveLength(2);
  });

  it("排布与普通模式同源：columns=5 时编辑模式的行组上限与普通模式一致", async () => {
    const user = userEvent.setup();
    const fiveColumns: SiteSettings = { ...settings, columns: 5 };
    seed({
      publicData: { ...publicData, settings: fiveColumns },
      privateData: { ...privateData, settings: fiveColumns },
    });
    const { container } = renderPage();
    const grid = () =>
      container.querySelector<HTMLElement>("#cat-c-dev [data-link-grid]");

    expect(grid()).toHaveStyle({ maxWidth: "899.5px" });

    await enterEdit(user);

    expect(grid()).toHaveStyle({ maxWidth: "899.5px" });
  });

  it("tileSize=medium：普通/编辑同档（行组 1240px），砖与「+」砖都是 113px", async () => {
    const user = userEvent.setup();
    const medium: SiteSettings = {
      ...settings,
      columns: 8,
      tileSize: "medium",
    };
    seed({
      publicData: { ...publicData, settings: medium },
      privateData: { ...privateData, settings: medium },
    });
    const { container } = renderPage();
    const grid = () =>
      container.querySelector<HTMLElement>("#cat-c-dev [data-link-grid]");

    expect(grid()).toHaveStyle({ maxWidth: "1240px" });
    expect(screen.getByRole("link", { name: /MDN/ })).toHaveClass(
      "size-[113px]",
    );

    await enterEdit(user);

    expect(grid()).toHaveStyle({ maxWidth: "1240px" });
    expect(screen.getByRole("button", { name: "MDN" })).toHaveClass(
      "size-[113px]",
    );
    expect(
      screen.getByRole("button", { name: "向「开发」新增链接" }),
    ).toHaveClass("size-[113px]");
  });
});

describe("编辑模式：单击砖复用后台编辑弹窗", () => {
  it("单击打开「编辑链接」弹窗，字段与分类预填", async () => {
    const user = userEvent.setup();
    renderPage();
    await enterEdit(user);

    await user.click(screen.getByRole("button", { name: "MDN" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("编辑链接")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("标题")).toHaveValue("MDN");
    expect(within(dialog).getByLabelText("URL")).toHaveValue(
      "https://developer.mozilla.org/",
    );
    expect(within(dialog).getByLabelText("选择所属分类")).toHaveTextContent(
      "开发",
    );
  });
});

describe("编辑模式：分类末尾「+」砖新建链接", () => {
  it("新建弹窗打开时 Esc 只关弹窗，不退出编辑模式", async () => {
    const user = userEvent.setup();
    renderPage();
    await enterEdit(user);

    await user.click(
      screen.getByRole("button", { name: "向「开发」新增链接" }),
    );
    const dialog = await screen.findByRole("dialog");

    // 真实浏览器里 Esc 发在弹窗内的焦点元素上（冒泡到 window 时弹窗已被 Radix 关掉）
    fireEvent.keyDown(within(dialog).getByLabelText("选择所属分类"), {
      key: "Escape",
    });

    expect(useNavStore.getState().editMode).toBe(true);
  });

  it("没有弹窗时 Esc 仍正常退出编辑模式", async () => {
    const user = userEvent.setup();
    renderPage();
    await enterEdit(user);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useNavStore.getState().editMode).toBe(false);
  });

  it("点「+」打开「新建链接」且分类已预选；保存后新砖出现在该分类末尾", async () => {
    const user = userEvent.setup();
    createLinkMock.mockResolvedValue({ id: "l9" });
    listLinksMock.mockResolvedValue([
      ...makeAdminData().links,
      {
        ...adminLink({
          id: "l9",
          categoryId: "c-empty",
          title: "新链接",
          url: "https://example.com/new",
          iconUrl: null,
          description: null,
          sortOrder: 3,
        }),
      },
    ]);
    renderPage();
    await enterEdit(user);

    await user.click(screen.getByRole("button", { name: "向「空」新增链接" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("新建链接")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("选择所属分类")).toHaveTextContent(
      "空",
    );

    await user.type(within(dialog).getByLabelText("标题"), "新链接");
    await user.type(
      within(dialog).getByLabelText("URL"),
      "https://example.com/new",
    );
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createLinkMock).toHaveBeenCalledTimes(1));
    // 契约省略 sortOrder 会兜底 0（插到分类最前）：新建一律显式送全局 MAX+1
    expect(createLinkMock.mock.calls[0][0]).toMatchObject({
      categoryId: "c-empty",
      title: "新链接",
      url: "https://example.com/new",
      sortOrder: 3,
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "新链接" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("编辑模式：✕ 延迟删除 + 撤销", () => {
  it("点 ✕ 立即移除并弹带撤销的 toast；撤销恢复原位，且不误开编辑弹窗", async () => {
    const user = userEvent.setup();
    renderPage();
    await enterEdit(user);

    await user.click(screen.getByRole("button", { name: "删除 GitHub" }));

    expect(screen.queryByRole("button", { name: "GitHub" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    const call = toastMock.mock.calls.find(
      (entry) => entry[0] === "已删除「GitHub」",
    );
    const options = call?.[1] as
      | { action?: { label: string; onClick: () => void } }
      | undefined;
    expect(options?.action?.label).toBe("撤销");

    act(() => options?.action?.onClick());

    expect(screen.getByRole("button", { name: "GitHub" })).toBeInTheDocument();
  });
});

describe("编辑模式：场景与搜索的自动退出", () => {
  it("编辑中切场景：退出编辑模式并切到目标场景", async () => {
    const user = userEvent.setup();
    renderPage();
    await enterEdit(user);

    await user.click(screen.getByRole("radio", { name: "工作" }));

    expect(screen.getByRole("link", { name: /Gmail/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成编辑" })).toBeNull();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("搜索有内容时进不了编辑模式；编辑中输入搜索立即退出", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("搜索关键词");

    await user.type(input, "nav");
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(listAllMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /GitHub/ })).toBeInTheDocument();

    await user.clear(input);
    await enterEdit(user);
    await user.type(input, "x");

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /GitHub/ })).toBeInTheDocument(),
    );
  });
});

describe("进入编辑模式失败：不出现半编辑态", () => {
  it("拉取失败：留在正常模式并提示", async () => {
    listAllMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "编辑" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "进入编辑模式失败，请稍后重试",
      ),
    );
    expect(screen.getByRole("link", { name: /GitHub/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成编辑" })).toBeNull();
  });
});

describe("编辑模式：显示网址开关不影响编辑", () => {
  it("站点设置关闭显示网址：普通模式无域名，编辑模式仍有", async () => {
    const user = userEvent.setup();
    const noUrl = { ...settings, showUrl: false };
    seed({
      publicData: { ...publicData, settings: noUrl },
      privateData: { ...privateData, settings: noUrl },
    });
    renderPage();

    expect(screen.getByRole("link", { name: /GitHub/ })).not.toHaveTextContent(
      "github.com",
    );

    await enterEdit(user);

    expect(screen.getByRole("button", { name: /^GitHub/ })).toHaveTextContent(
      "github.com",
    );
  });
});
