import type * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkEditDialog } from "@/components/admin/link-edit-dialog";
import {
  adminDeleteAsset,
  adminListAll,
  adminReorderLinks,
  adminUpdateLink,
  adminUploadAsset,
  type AdminData,
  type CreateLinkInput,
} from "@/lib/api";
import { resetAdminOrderState, useNavStore } from "@/lib/nav-store";
import type { AdminCategory, AdminLink } from "@/lib/types";
import { deferred } from "./deferred";

/**
 * 链接编辑弹窗（后台「链接」面板删除后由首页编辑模式复用）：编辑态的图标上传与清旧、
 * 分类搬家（含「排序在飞时先 settle」的交错）、新建态走 `onCreateLink` 并把完整 DTO
 * 回传给 `onSaved`、以及两条路径共用的失败口径（错误 toast、弹窗不关）。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminUploadAsset: vi.fn(),
    adminDeleteAsset: vi.fn(),
    adminUpdateLink: vi.fn(),
    adminReorderLinks: vi.fn(),
    adminListAll: vi.fn(),
  };
});

const uploadMock = vi.mocked(adminUploadAsset);
const deleteMock = vi.mocked(adminDeleteAsset);
const updateLinkMock = vi.mocked(adminUpdateLink);
const reorderLinksMock = vi.mocked(adminReorderLinks);
const listAllMock = vi.mocked(adminListAll);
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

const file = new File([new Uint8Array([1, 2, 3])], "icon.png", {
  type: "image/png",
});

const stamp = "2026-11-08T00:00:00.000Z";

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

const reading: AdminCategory = {
  ...category,
  id: "c2",
  name: "阅读",
  sortOrder: 1,
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

const adminBase: AdminData = {
  scenes: [],
  categories: [category, reading],
  links: [link],
  searchEngines: [],
  settings: {
    siteTitle: "我的导航",
    backgroundUrl: "",
    wallpaperSource: "bing",
    logoUrl: "",
    columns: 6,
    searchNewTab: true,
  },
};

function pickFile(input: HTMLElement) {
  fireEvent.change(input, { target: { files: [file] } });
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof LinkEditDialog>> = {},
) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onCreateLink = vi.fn(async (input: CreateLinkInput) => ({
    ...link,
    id: "l9",
    ...input,
  }));
  render(
    <LinkEditDialog
      open
      link={link}
      categories={[category, reading]}
      onCreateLink={onCreateLink}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onClose, onSaved, onCreateLink };
}

beforeEach(() => {
  uploadMock.mockReset();
  deleteMock.mockReset();
  updateLinkMock.mockReset();
  reorderLinksMock.mockReset();
  listAllMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  deleteMock.mockResolvedValue(undefined);
  reorderLinksMock.mockResolvedValue(undefined);
  listAllMock.mockResolvedValue(adminBase);
  resetAdminOrderState();
  useNavStore.setState({ adminData: adminBase, authStatus: "authenticated" });
  updateLinkMock.mockImplementation(async (id, input) => ({
    ...link,
    id,
    ...input,
  }));
});

describe("LinkEditDialog：链接图标上传 / 回填 / 清旧", () => {
  it("上传图标后回填 iconUrl 并随更新提交，同时清掉旧图标", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/link-new.png" });
    renderDialog({
      link: { ...link, iconUrl: "/assets/assets/icon/link-old.png" },
    });

    pickFile(screen.getByLabelText("上传链接图标"));
    await waitFor(() =>
      expect(screen.getByLabelText("链接图标")).toHaveValue(
        "/assets/assets/icon/link-new.png",
      ),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateLinkMock).toHaveBeenCalledWith("l1", {
        categoryId: "c1",
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
    renderDialog({
      link: { ...link, iconUrl: "/assets/assets/icon/link-old.png" },
    });

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

describe("LinkEditDialog：分类下拉与搬家", () => {
  it("只列传入的分类，并预选链接实际所属分类", async () => {
    const user = userEvent.setup();
    renderDialog({ link: { ...link, categoryId: "c2" } });

    const trigger = screen.getByRole("combobox", { name: "选择所属分类" });
    expect(trigger).toHaveTextContent("阅读");

    await user.click(trigger);
    expect(screen.getAllByRole("option").map((el) => el.textContent)).toEqual([
      "开发",
      "阅读",
    ]);
  });

  it("改分类保存：payload 带新 categoryId，并提示已移到目标分类末尾", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("combobox", { name: "选择所属分类" }));
    await user.click(screen.getByRole("option", { name: "阅读" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateLinkMock).toHaveBeenCalledWith("l1", {
        categoryId: "c2",
        title: "GitHub",
        url: "https://github.com",
        iconUrl: null,
        description: null,
        visibility: "public",
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("链接已移到「阅读」末尾");
  });

  it("分类未改：照旧带上当前 categoryId，不提示搬家", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateLinkMock).toHaveBeenCalledWith(
        "l1",
        expect.objectContaining({ categoryId: "c1" }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("链接已更新");
  });

  it("排序请求还在飞时改分类保存：先等排序落库再发 PUT（保证 PUT 是最后一次写）", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    reorderLinksMock.mockReturnValue(pending.promise);
    // 后台链接面板（或上一次拖动）留下的排序请求在飞：settleLinkOrder 必须等它落库
    void useNavStore.getState().reorderLinks(["l1"]);
    renderDialog();

    await user.click(screen.getByRole("combobox", { name: "选择所属分类" }));
    await user.click(screen.getByRole("option", { name: "阅读" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await new Promise((r) => setTimeout(r, 0));
    // 排序未落库前不得发 PUT：否则 /links/reorder 可能晚于 PUT 落库，把链接改回旧槽位
    expect(updateLinkMock).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() => expect(updateLinkMock).toHaveBeenCalledTimes(1));
    expect(updateLinkMock).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ categoryId: "c2" }),
    );
  });
});

describe("LinkEditDialog：新建走 onCreateLink", () => {
  it("预选默认分类、可改分类后创建，成功后把完整 DTO 回传给 onSaved", async () => {
    const user = userEvent.setup();
    const { onCreateLink, onSaved } = renderDialog({
      link: null,
      defaultCategoryId: "c1",
    });

    expect(
      screen.getByRole("heading", { name: "新建链接" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "选择所属分类" }),
    ).toHaveTextContent("开发");

    await user.click(screen.getByRole("combobox", { name: "选择所属分类" }));
    await user.click(screen.getByRole("option", { name: "阅读" }));
    await user.type(screen.getByLabelText("标题"), "新链接");
    await user.type(screen.getByLabelText("URL"), "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onCreateLink).toHaveBeenCalledTimes(1));
    expect(onCreateLink.mock.calls[0][0]).toEqual({
      categoryId: "c2",
      title: "新链接",
      url: "https://example.com/new",
      iconUrl: null,
      description: null,
      visibility: "public",
    });
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ id: "l9", categoryId: "c2" }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("链接已创建");
  });

  it("新建失败：错误 toast、弹窗不关、不回调 onSaved", async () => {
    const user = userEvent.setup();
    const { onCreateLink, onSaved } = renderDialog({
      link: null,
      defaultCategoryId: "c1",
    });
    onCreateLink.mockRejectedValueOnce(new Error("boom"));

    await user.type(screen.getByLabelText("标题"), "新链接");
    await user.type(screen.getByLabelText("URL"), "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("保存失败：boom"),
    );
    expect(onCreateLink).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("编辑失败同样有错误 toast、弹窗不关", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog();
    updateLinkMock.mockRejectedValueOnce(new Error("boom"));

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("保存失败：boom"),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
