import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryPanel, LinkPanel } from "@/components/admin/crud-panels";
import { SearchEnginePanel } from "@/components/admin/settings-panels";
import {
  adminCreateCategory,
  adminCreateLink,
  adminDeleteAsset,
  adminDeleteCategory,
  adminDeleteEngine,
  adminDeleteLink,
  adminListAll,
  adminReorderCategories,
  adminReorderEngines,
  adminReorderLinks,
  adminUpdateCategory,
  adminUpdateEngine,
  adminUpdateLink,
  adminUploadAsset,
  type AdminData,
} from "@/lib/api";
import { resetAdminOrderState, useNavStore } from "@/lib/nav-store";
import type { AdminCategory, AdminLink, SearchEngine } from "@/lib/types";
import { deferred } from "./deferred";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminUploadAsset: vi.fn(),
    adminDeleteAsset: vi.fn(),
    adminCreateCategory: vi.fn(),
    adminCreateLink: vi.fn(),
    adminUpdateCategory: vi.fn(),
    adminDeleteCategory: vi.fn(),
    adminDeleteLink: vi.fn(),
    adminDeleteEngine: vi.fn(),
    adminUpdateLink: vi.fn(),
    adminUpdateEngine: vi.fn(),
    adminListAll: vi.fn(),
    adminReorderCategories: vi.fn(),
    adminReorderLinks: vi.fn(),
    adminReorderEngines: vi.fn(),
  };
});

const uploadMock = vi.mocked(adminUploadAsset);
const deleteMock = vi.mocked(adminDeleteAsset);
const createCategoryMock = vi.mocked(adminCreateCategory);
const createLinkMock = vi.mocked(adminCreateLink);
const updateCategoryMock = vi.mocked(adminUpdateCategory);
const deleteCategoryMock = vi.mocked(adminDeleteCategory);
const deleteLinkMock = vi.mocked(adminDeleteLink);
const deleteEngineMock = vi.mocked(adminDeleteEngine);
const updateLinkMock = vi.mocked(adminUpdateLink);
const updateEngineMock = vi.mocked(adminUpdateEngine);
const listAllMock = vi.mocked(adminListAll);
const reorderCategoriesMock = vi.mocked(adminReorderCategories);
const reorderLinksMock = vi.mocked(adminReorderLinks);
const reorderEnginesMock = vi.mocked(adminReorderEngines);
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

const file = new File([new Uint8Array([1, 2, 3])], "icon.png", {
  type: "image/png",
});

const stamp = "2026-10-26T00:00:00.000Z";

const category: AdminCategory = {
  id: "c1",
  name: "开发",
  icon: null,
  sceneId: "scene_default",
  sortOrder: 0,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};

const link: AdminLink = {
  id: "l1",
  categoryId: "c1",
  title: "GitHub",
  url: "https://github.com",
  iconUrl: null,
  description: null,
  sortOrder: 0,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};

const engine: SearchEngine = {
  id: "e1",
  name: "Google",
  urlTemplate: "https://www.google.com/search?q={q}",
  icon: null,
  sortOrder: 0,
  isDefault: true,
};

function pickFile(input: HTMLElement) {
  fireEvent.change(input, { target: { files: [file] } });
}

/** 点行尾「编辑」图标进入编辑（行内容自本次起只做展示，不再可点）。 */
async function openRow(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByRole("button", { name: `编辑 ${label}` }));
}

// ─── 排序：面板从 store 取数据（与 AdminPage 一致），乐观写入才会立刻重渲染 ─────────

function CategoryHarness({ onChanged }: { onChanged: () => void }) {
  const categories = useNavStore((s) => s.adminData?.categories ?? []);
  return <CategoryPanel categories={categories} onChanged={onChanged} />;
}

function LinkHarness({ onChanged }: { onChanged: () => void }) {
  const categories = useNavStore((s) => s.adminData?.categories ?? []);
  const links = useNavStore((s) => s.adminData?.links ?? []);
  return (
    <LinkPanel categories={categories} links={links} onChanged={onChanged} />
  );
}

function EngineHarness({ onChanged }: { onChanged: () => void }) {
  const engines = useNavStore((s) => s.adminData?.searchEngines ?? []);
  return <SearchEnginePanel engines={engines} onChanged={onChanged} />;
}

const adminBase: AdminData = {
  scenes: [],
  categories: [category, { ...category, id: "c2", name: "阅读", sortOrder: 1 }],
  links: [
    link,
    {
      ...link,
      id: "l2",
      categoryId: "c2",
      title: "少数派",
      url: "https://sspai.com",
      sortOrder: 1,
    },
    {
      ...link,
      id: "l3",
      categoryId: "c1",
      title: "MDN",
      url: "https://developer.mozilla.org",
      sortOrder: 2,
    },
  ],
  searchEngines: [
    engine,
    {
      ...engine,
      id: "e2",
      name: "Bing",
      urlTemplate: "https://www.bing.com/search?q={q}",
      sortOrder: 1,
      isDefault: false,
    },
  ],
  settings: {
    siteTitle: "我的导航",
    backgroundUrl: "",
    wallpaperSource: "bing",
    logoUrl: "",
    columns: 6,
    searchNewTab: true,
  },
};

/** 列表当前顺序（以行尾编辑按钮的 aria-label 为准）。 */
function editLabels(): (string | null)[] {
  return screen
    .getAllByRole("button", { name: /^编辑 / })
    .map((el) => el.getAttribute("aria-label"));
}

beforeEach(() => {
  uploadMock.mockReset();
  deleteMock.mockReset();
  createCategoryMock.mockReset();
  updateCategoryMock.mockReset();
  deleteCategoryMock.mockReset();
  deleteLinkMock.mockReset();
  deleteEngineMock.mockReset();
  updateLinkMock.mockReset();
  updateEngineMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  deleteCategoryMock.mockResolvedValue(undefined);
  deleteLinkMock.mockResolvedValue(undefined);
  deleteEngineMock.mockResolvedValue(undefined);
  resetAdminOrderState();
  listAllMock.mockReset();
  reorderCategoriesMock.mockReset();
  reorderLinksMock.mockReset();
  reorderEnginesMock.mockReset();
  listAllMock.mockResolvedValue(adminBase);
  reorderCategoriesMock.mockResolvedValue(undefined);
  reorderLinksMock.mockResolvedValue(undefined);
  reorderEnginesMock.mockResolvedValue(undefined);
  useNavStore.setState({ adminData: adminBase, authStatus: "authenticated" });
  createCategoryMock.mockImplementation(async (input) => ({
    ...category,
    id: "c2",
    name: input.name,
    icon: input.icon ?? null,
  }));
  updateCategoryMock.mockImplementation(async (id, input) => ({
    ...category,
    id,
    ...input,
  }));
  updateLinkMock.mockImplementation(async (id, input) => ({
    ...link,
    id,
    ...input,
  }));
  updateEngineMock.mockImplementation(async (id, input) => ({
    ...engine,
    id,
    ...input,
  }));
});

describe("CategoryPanel：分类图标上传 / 回填 / 清旧 / 列表预览", () => {
  it("新建分类：上传图标后回填并随创建提交", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/cat-1.png" });

    render(<CategoryPanel categories={[category]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建分类" }));
    await user.type(screen.getByLabelText("名称"), "阅读");
    pickFile(screen.getByLabelText("上传分类图标"));

    await waitFor(() =>
      expect(screen.getByLabelText("分类图标")).toHaveValue(
        "/assets/assets/icon/cat-1.png",
      ),
    );
    expect(screen.getByAltText("分类图标预览")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalledTimes(1));
    expect(createCategoryMock.mock.calls[0][0]).toEqual({
      name: "阅读",
      icon: "/assets/assets/icon/cat-1.png",
      visibility: "public",
      sortOrder: 1,
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("替换已有图标：保存后删掉旧 R2 对象", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/cat-new.png" });

    render(
      <CategoryPanel
        categories={[{ ...category, icon: "/assets/assets/icon/cat-old.png" }]}
        onChanged={vi.fn()}
      />,
    );

    // 列表预览已有图标
    expect(
      document.querySelector('img[src="/assets/assets/icon/cat-old.png"]'),
    ).not.toBeNull();

    await openRow(user, "开发");
    pickFile(screen.getByLabelText("上传分类图标"));
    await waitFor(() =>
      expect(screen.getByLabelText("分类图标")).toHaveValue(
        "/assets/assets/icon/cat-new.png",
      ),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateCategoryMock).toHaveBeenCalledWith("c1", {
        name: "开发",
        icon: "/assets/assets/icon/cat-new.png",
        visibility: "public",
      }),
    );
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        "/assets/assets/icon/cat-old.png",
      ),
    );
  });
});

describe("LinkPanel：链接图标上传 / 回填 / 清旧", () => {
  it("上传图标后回填 iconUrl 并随更新提交，同时清掉旧图标", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/link-new.png" });

    render(
      <LinkPanel
        categories={[category]}
        links={[{ ...link, iconUrl: "/assets/assets/icon/link-old.png" }]}
        onChanged={vi.fn()}
      />,
    );

    await openRow(user, "GitHub");
    pickFile(screen.getByLabelText("上传链接图标"));
    await waitFor(() =>
      expect(screen.getByLabelText("链接图标")).toHaveValue(
        "/assets/assets/icon/link-new.png",
      ),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateLinkMock).toHaveBeenCalledWith("l1", {
        title: "GitHub",
        url: "https://github.com",
        iconUrl: "/assets/assets/icon/link-new.png",
        description: null,
        visibility: "public",
      }),
    );
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        "/assets/assets/icon/link-old.png",
      ),
    );
  });

  it("移除图标：保存后 iconUrl 为 null，旧图标被删", async () => {
    const user = userEvent.setup();

    render(
      <LinkPanel
        categories={[category]}
        links={[{ ...link, iconUrl: "/assets/assets/icon/link-old.png" }]}
        onChanged={vi.fn()}
      />,
    );

    await openRow(user, "GitHub");
    await user.click(screen.getByRole("button", { name: /移除/ }));
    expect(screen.getByLabelText("链接图标")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateLinkMock).toHaveBeenCalledWith(
        "l1",
        expect.objectContaining({ iconUrl: null }),
      ),
    );
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        "/assets/assets/icon/link-old.png",
      ),
    );
  });
});

describe("SearchEnginePanel：搜索引擎图标上传 / 回填 / 列表预览", () => {
  it("上传图标后回填并随更新提交", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/eng-1.svg" });

    render(<SearchEnginePanel engines={[engine]} onChanged={vi.fn()} />);

    await openRow(user, "Google");
    pickFile(screen.getByLabelText("上传图标"));
    await waitFor(() =>
      expect(screen.getByLabelText("图标")).toHaveValue(
        "/assets/assets/icon/eng-1.svg",
      ),
    );
    expect(screen.getByAltText("图标预览")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateEngineMock).toHaveBeenCalledWith("e1", {
        name: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
        icon: "/assets/assets/icon/eng-1.svg",
        isDefault: true,
      }),
    );
  });

  it("列表里渲染已存图标（后台预览）", () => {
    render(
      <SearchEnginePanel
        engines={[{ ...engine, icon: "/assets/assets/icon/eng-stored.png" }]}
        onChanged={vi.fn()}
      />,
    );

    expect(
      document.querySelector('img[src="/assets/assets/icon/eng-stored.png"]'),
    ).not.toBeNull();
  });
});

describe("列表行交互：编辑图标 / 点行不再进入编辑", () => {
  it("分类：点行内容不弹编辑框，点行尾编辑图标才进入编辑", async () => {
    const user = userEvent.setup();
    render(<CategoryPanel categories={[category]} onChanged={vi.fn()} />);

    await user.click(screen.getByText("开发"));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "编辑 开发" }));
    expect(
      screen.getByRole("heading", { name: "编辑分类" }),
    ).toBeInTheDocument();
  });

  it("链接与搜索引擎列表都带行尾编辑图标", () => {
    render(
      <>
        <LinkPanel categories={[category]} links={[link]} onChanged={vi.fn()} />
        <SearchEnginePanel engines={[engine]} onChanged={vi.fn()} />
      </>,
    );

    expect(
      screen.getByRole("button", { name: "编辑 GitHub" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "编辑 Google" }),
    ).toBeInTheDocument();
  });
});

describe("CategoryPanel：删除二次确认", () => {
  it("点删除先弹确认框；取消不删，确认后才调删除接口", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<CategoryPanel categories={[category]} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "删除 开发" }));
    expect(deleteCategoryMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/该分类下的链接也会一并删除/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteCategoryMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除 开发" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleteCategoryMock).toHaveBeenCalledWith("c1"));
    expect(onChanged).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("分类已删除");
  });
});

describe("CategoryPanel：同名分类前端拦截", () => {
  it("新建重名（前后空格 + 大小写差异）被拦，不发创建请求", async () => {
    const user = userEvent.setup();
    render(
      <CategoryPanel
        categories={[{ ...category, name: "Nav" }]}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新建分类" }));
    await user.type(screen.getByLabelText("名称"), "  nav ");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "分类「nav」已存在，请换一个名称",
    );
    // 弹窗保持打开，用户可改名重试
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("编辑成另一个已存在的分类名被拦，不发更新请求", async () => {
    const user = userEvent.setup();
    const other = { ...category, id: "c2", name: "阅读", sortOrder: 1 };
    render(
      <CategoryPanel categories={[category, other]} onChanged={vi.fn()} />,
    );

    await openRow(user, "开发");
    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "阅读");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(updateCategoryMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "分类「阅读」已存在，请换一个名称",
    );
  });

  it("编辑时排除自身：名称不变可直接保存", async () => {
    const user = userEvent.setup();
    render(<CategoryPanel categories={[category]} onChanged={vi.fn()} />);

    await openRow(user, "开发");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateCategoryMock).toHaveBeenCalledWith("c1", {
        name: "开发",
        icon: null,
        visibility: "public",
      }),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("名称 trim 后为空被拦，不发请求", async () => {
    const user = userEvent.setup();
    render(<CategoryPanel categories={[category]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建分类" }));
    await user.type(screen.getByLabelText("名称"), "   ");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("分类名称不能为空");
  });
});

describe("LinkPanel：分类筛选「所有」", () => {
  const reading: AdminCategory = {
    ...category,
    id: "c2",
    name: "阅读",
    sortOrder: 1,
  };
  const sspai: AdminLink = {
    ...link,
    id: "l2",
    categoryId: "c2",
    title: "少数派",
    url: "https://sspai.com",
    sortOrder: 1,
  };

  it("默认选中「所有」，显示全部分类的链接（按 sortOrder）", () => {
    render(
      <LinkPanel
        categories={[category, reading]}
        links={[sspai, link]}
        onChanged={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "选择分类" }),
    ).toHaveTextContent("所有");
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("少数派")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: /^编辑 / })
        .map((el) => el.getAttribute("aria-label")),
    ).toEqual(["编辑 GitHub", "编辑 少数派"]);
  });

  it("选中具体分类只显示该分类链接，选回「所有」恢复全量", async () => {
    const user = userEvent.setup();
    render(
      <LinkPanel
        categories={[category, reading]}
        links={[link, sspai]}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "选择分类" }));
    await user.click(screen.getByRole("option", { name: "阅读" }));

    await waitFor(() => expect(screen.queryByText("GitHub")).toBeNull());
    expect(screen.getByText("少数派")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "选择分类" }));
    await user.click(screen.getByRole("option", { name: "所有" }));

    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    expect(screen.getByText("少数派")).toBeInTheDocument();
  });

  it("「所有」下新建链接先要求选分类：只提示、不弹新建框", async () => {
    const user = userEvent.setup();
    render(
      <LinkPanel
        categories={[category, reading]}
        links={[link]}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新建链接" }));
    expect(toastErrorMock).toHaveBeenCalledWith("请先选择一个分类");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("链接 / 搜索引擎：删除同样二次确认", () => {
  it("链接：点删除先弹确认框；取消不删，确认后才调删除接口", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(
      <LinkPanel
        categories={[category]}
        links={[link]}
        onChanged={onChanged}
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除 GitHub" }));
    expect(deleteLinkMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText("删除链接后无法恢复，请确认。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(deleteLinkMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除 GitHub" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleteLinkMock).toHaveBeenCalledWith("l1"));
    expect(onChanged).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("链接已删除");
  });

  it("搜索引擎：点删除先弹确认框；取消不删，确认后才调删除接口", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<SearchEnginePanel engines={[engine]} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "删除 Google" }));
    expect(deleteEngineMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("删除后无法恢复，请确认。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(deleteEngineMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除 Google" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleteEngineMock).toHaveBeenCalledWith("e1"));
    expect(onChanged).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("搜索引擎已删除");
  });
});

describe("排序：乐观即时生效，成功后不再整表重拉", () => {
  it("分类：点下移后顺序立刻变化（请求仍在飞），onChanged 0 次", async () => {
    const pending = deferred();
    reorderCategoriesMock.mockReturnValue(pending.promise);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CategoryHarness onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "下移 开发" }));

    // 请求还没落地，界面已经是新顺序（旧实现这里会等两次往返）
    expect(editLabels()).toEqual(["编辑 阅读", "编辑 开发"]);
    expect(reorderCategoriesMock).toHaveBeenCalledWith(["c2", "c1"]);
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
    });
    // 成功即以本地为准：不再 loadAdmin 对账
    expect(listAllMock).not.toHaveBeenCalled();
    expect(editLabels()).toEqual(["编辑 阅读", "编辑 开发"]);
  });

  it("搜索引擎：点下移后顺序立刻变化，onChanged 0 次", async () => {
    const pending = deferred();
    reorderEnginesMock.mockReturnValue(pending.promise);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<EngineHarness onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "下移 Google" }));

    expect(editLabels()).toEqual(["编辑 Bing", "编辑 Google"]);
    expect(reorderEnginesMock).toHaveBeenCalledWith(["e2", "e1"]);
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
    });
    expect(listAllMock).not.toHaveBeenCalled();
  });

  it("链接（按分类过滤）：提交重建后的全局 ids，跨分类相对顺序不变", async () => {
    const pending = deferred();
    reorderLinksMock.mockReturnValue(pending.promise);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<LinkHarness onChanged={onChanged} />);

    await user.click(screen.getByRole("combobox", { name: "选择分类" }));
    await user.click(screen.getByRole("option", { name: "开发" }));
    await waitFor(() => expect(screen.queryByText("少数派")).toBeNull());

    await user.click(screen.getByRole("button", { name: "下移 GitHub" }));

    expect(editLabels()).toEqual(["编辑 MDN", "编辑 GitHub"]);
    // 全局 ids：本分类内换位，其他分类的「少数派」仍排在后面
    expect(reorderLinksMock).toHaveBeenCalledWith(["l3", "l1", "l2"]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(
      useNavStore.getState().adminData?.links.map((item) => item.id),
    ).toEqual(["l3", "l1", "l2"]);

    await act(async () => {
      pending.resolve();
    });
  });

  it("排序失败：回滚到操作前顺序并 toast，按服务端再刷一次", async () => {
    const pending = deferred();
    reorderCategoriesMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<CategoryHarness onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "下移 开发" }));
    expect(editLabels()).toEqual(["编辑 阅读", "编辑 开发"]);

    await act(async () => {
      pending.reject(new Error("boom"));
    });

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("排序失败，已恢复原顺序"),
    );
    expect(editLabels()).toEqual(["编辑 开发", "编辑 阅读"]);
    // 后端逐条 UPDATE 无事务：失败后以服务端为准再刷一次
    expect(listAllMock).toHaveBeenCalled();
  });
});

describe("新建分类：场景内末尾排序 + 保存失败可见", () => {
  it("按当前场景最大 sortOrder + 1 提交（后端省略 sortOrder 会兜底 0、插到场景首项之后）", async () => {
    const user = userEvent.setup();
    render(
      <CategoryPanel
        categories={[
          { ...category, sortOrder: 0 },
          { ...category, id: "c2", name: "阅读", sortOrder: 4 },
        ]}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新建分类" }));
    await user.type(screen.getByLabelText("名称"), "工具");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalledTimes(1));
    expect(createCategoryMock.mock.calls[0][0]).toMatchObject({
      name: "工具",
      sortOrder: 5,
    });
  });

  it("新建失败（例：场景已被另一标签页删除）：错误 toast、弹窗不关、不刷新", async () => {
    createCategoryMock.mockRejectedValueOnce(
      new Error("sceneId does not exist"),
    );
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CategoryPanel categories={[category]} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "新建分类" }));
    await user.type(screen.getByLabelText("名称"), "工具");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "保存失败：sceneId does not exist",
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("编辑失败同样有错误 toast、弹窗不关", async () => {
    updateCategoryMock.mockRejectedValueOnce(new Error("boom"));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CategoryPanel categories={[category]} onChanged={onChanged} />);

    await openRow(user, "开发");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("保存失败：boom"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("链接保存失败可见（同一错误口径）", () => {
  it("新建链接失败：错误 toast、弹窗不关、不刷新", async () => {
    createLinkMock.mockRejectedValueOnce(new Error("boom"));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <LinkPanel
        categories={[category]}
        links={[link]}
        onChanged={onChanged}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "选择分类" }));
    await user.click(screen.getByRole("option", { name: "开发" }));
    await user.click(screen.getByRole("button", { name: "新建链接" }));
    await user.type(screen.getByLabelText("标题"), "新链接");
    await user.type(screen.getByLabelText("URL"), "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("保存失败：boom"),
    );
    expect(createLinkMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("CategoryPanel：分类所在场景私有时的有效状态提示", () => {
  it("场景私有时每行给「场景私有，对外不可见」提示", () => {
    render(
      <CategoryPanel
        categories={[category]}
        sceneId="scene_default"
        sceneVisibility="private"
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText("场景私有，对外不可见")).toBeInTheDocument();
    // 分类自身的可见性徽标照旧保留
    expect(screen.getByText("公开")).toBeInTheDocument();
  });

  it("场景公开时不显示该提示", () => {
    render(
      <CategoryPanel
        categories={[category]}
        sceneId="scene_default"
        sceneVisibility="public"
        onChanged={vi.fn()}
      />,
    );

    expect(screen.queryByText("场景私有，对外不可见")).toBeNull();
  });
});
