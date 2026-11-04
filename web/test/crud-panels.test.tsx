import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryPanel, LinkPanel } from "@/components/admin/crud-panels";
import { SearchEnginePanel } from "@/components/admin/settings-panels";
import {
  adminCreateCategory,
  adminDeleteAsset,
  adminDeleteCategory,
  adminDeleteEngine,
  adminDeleteLink,
  adminUpdateCategory,
  adminUpdateEngine,
  adminUpdateLink,
  adminUploadAsset,
} from "@/lib/api";
import type { AdminCategory, AdminLink, SearchEngine } from "@/lib/types";

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
    adminUpdateCategory: vi.fn(),
    adminDeleteCategory: vi.fn(),
    adminDeleteLink: vi.fn(),
    adminDeleteEngine: vi.fn(),
    adminUpdateLink: vi.fn(),
    adminUpdateEngine: vi.fn(),
  };
});

const uploadMock = vi.mocked(adminUploadAsset);
const deleteMock = vi.mocked(adminDeleteAsset);
const createCategoryMock = vi.mocked(adminCreateCategory);
const updateCategoryMock = vi.mocked(adminUpdateCategory);
const deleteCategoryMock = vi.mocked(adminDeleteCategory);
const deleteLinkMock = vi.mocked(adminDeleteLink);
const deleteEngineMock = vi.mocked(adminDeleteEngine);
const updateLinkMock = vi.mocked(adminUpdateLink);
const updateEngineMock = vi.mocked(adminUpdateEngine);
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
