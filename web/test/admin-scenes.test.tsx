import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "@/components/admin/admin-page";
import { ScenePanel } from "@/components/admin/scene-panel";
import { ThemeProvider } from "@/components/theme-provider";
import {
  adminCreateCategory,
  adminCreateScene,
  adminDeleteAsset,
  adminDeleteScene,
  adminListAll,
  adminReorderScenes,
  adminUpdateCategory,
  adminUpdateScene,
  adminUploadAsset,
  type AdminData,
} from "@/lib/api";
import { resetAdminOrderState, useNavStore } from "@/lib/nav-store";
import {
  SCENE_PREFERENCE_KEY,
  useScenePreferenceStore,
} from "@/lib/scene-preference";
import type {
  AdminCategory,
  AdminLink,
  AdminScene,
  SiteSettings,
} from "@/lib/types";
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
    adminCreateScene: vi.fn(),
    adminUpdateScene: vi.fn(),
    adminDeleteScene: vi.fn(),
    adminReorderScenes: vi.fn(),
    adminCreateCategory: vi.fn(),
    adminUpdateCategory: vi.fn(),
    adminListAll: vi.fn(),
  };
});

const uploadMock = vi.mocked(adminUploadAsset);
const deleteAssetMock = vi.mocked(adminDeleteAsset);
const createSceneMock = vi.mocked(adminCreateScene);
const updateSceneMock = vi.mocked(adminUpdateScene);
const deleteSceneMock = vi.mocked(adminDeleteScene);
const reorderScenesMock = vi.mocked(adminReorderScenes);
const createCategoryMock = vi.mocked(adminCreateCategory);
const updateCategoryMock = vi.mocked(adminUpdateCategory);
const listAllMock = vi.mocked(adminListAll);
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

const stamp = "2026-11-06T00:00:00.000Z";

const common: AdminScene = {
  id: "s_default",
  name: "通用",
  icon: null,
  sortOrder: 1,
  isDefault: true,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};
const work: AdminScene = {
  id: "s_work",
  name: "工作",
  icon: null,
  sortOrder: 0,
  isDefault: false,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};

const settings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

const commonCategory: AdminCategory = {
  id: "c_common",
  name: "开发",
  icon: null,
  sceneId: "s_default",
  sortOrder: 0,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};
const workCategory: AdminCategory = {
  id: "c_work",
  name: "运维",
  icon: null,
  sceneId: "s_work",
  sortOrder: 0,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};

function makeLink(
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

const adminData: AdminData = {
  scenes: [work, common],
  categories: [commonCategory, workCategory],
  links: [
    makeLink("l_common", "c_common", "GitHub", 0),
    makeLink("l_work", "c_work", "服务器面板", 1),
  ],
  searchEngines: [],
  settings,
};

function seedAdmin(data: AdminData = adminData) {
  useNavStore.setState({
    adminData: data,
    publicData: null,
    privateData: null,
    authStatus: "authenticated",
    loginPromptOpen: false,
    loadAdmin: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  });
}

function renderAdmin() {
  render(
    <ThemeProvider>
      <AdminPage onBack={vi.fn()} />
    </ThemeProvider>,
  );
}

/** 场景管理面板从 store 读数据（与 AdminPage 一致），乐观排序才会立刻重渲染 */
function SceneHarness({ onChanged }: { onChanged: () => void }) {
  const scenes = useNavStore((s) => s.adminData?.scenes ?? []);
  return <ScenePanel scenes={scenes} onChanged={onChanged} />;
}

beforeEach(() => {
  localStorage.clear();
  useScenePreferenceStore.setState({ raw: null });
  resetAdminOrderState();
  for (const mock of [
    uploadMock,
    deleteAssetMock,
    createSceneMock,
    updateSceneMock,
    deleteSceneMock,
    reorderScenesMock,
    createCategoryMock,
    updateCategoryMock,
    listAllMock,
    toastErrorMock,
    toastSuccessMock,
  ]) {
    mock.mockReset();
  }
  deleteSceneMock.mockResolvedValue(undefined);
  reorderScenesMock.mockResolvedValue(undefined);
  deleteAssetMock.mockResolvedValue(undefined);
  listAllMock.mockResolvedValue(adminData);
  createSceneMock.mockImplementation(async (input) => ({
    ...work,
    id: "s_new",
    name: input.name,
    icon: input.icon ?? null,
  }));
  updateSceneMock.mockImplementation(async (id, input) => ({
    ...(id === "s_default" ? common : work),
    ...input,
  }));
  createCategoryMock.mockImplementation(async (input) => ({
    ...commonCategory,
    id: "c_new",
    name: input.name,
    sceneId: input.sceneId ?? common.id,
  }));
  updateCategoryMock.mockImplementation(async (id, input) => ({
    ...commonCategory,
    id,
    ...input,
  }));
  seedAdmin();
});

// ─── ScenePanel：场景管理分区 ─────────────────────────────────────────────────

describe("ScenePanel：默认场景不可删、带「默认」徽标", () => {
  it("默认场景行没有删除按钮、带「默认」徽标；普通场景可删", () => {
    render(<ScenePanel scenes={[work, common]} onChanged={vi.fn()} />);

    expect(screen.getByText("通用")).toBeInTheDocument();
    expect(screen.getByText("默认")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除 通用" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "删除 工作" }),
    ).toBeInTheDocument();
    // 默认场景仍可改名/改图标、参与排序
    expect(
      screen.getByRole("button", { name: "编辑 通用" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "上移 工作" }),
    ).toBeInTheDocument();
  });
});

describe("ScenePanel：增删改", () => {
  it("新建场景：提交名称与图标，成功 toast 并刷新", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "新建场景" }));
    await user.type(screen.getByLabelText("名称"), "学习");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(createSceneMock).toHaveBeenCalledWith({
        name: "学习",
        icon: null,
        visibility: "public",
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("场景已创建");
    expect(onChanged).toHaveBeenCalled();
  });

  it("名称为空被拦：不发请求，弹窗保持打开", async () => {
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建场景" }));
    await user.type(screen.getByLabelText("名称"), "   ");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(createSceneMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("场景名称不能为空");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("改名：提交新名称，成功 toast 并刷新", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "编辑 工作" }));
    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "工作台");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateSceneMock).toHaveBeenCalledWith("s_work", {
        name: "工作台",
        icon: null,
        visibility: "public",
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("场景已更新");
    expect(onChanged).toHaveBeenCalled();
  });

  it("替换场景图标：保存后删掉旧的 R2 对象", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/scene-new.png" });
    const scenes = [
      { ...work, icon: "/assets/assets/icon/scene-old.png" },
      common,
    ];
    render(<ScenePanel scenes={scenes} onChanged={vi.fn()} />);

    // 列表预览已有图标
    expect(
      document.querySelector('img[src="/assets/assets/icon/scene-old.png"]'),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "编辑 工作" }));
    const file = new File([new Uint8Array([1, 2, 3])], "scene.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText("上传场景图标"), file);
    await waitFor(() =>
      expect(screen.getByLabelText("场景图标")).toHaveValue(
        "/assets/assets/icon/scene-new.png",
      ),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateSceneMock).toHaveBeenCalledWith("s_work", {
        name: "工作",
        icon: "/assets/assets/icon/scene-new.png",
        visibility: "public",
      }),
    );
    await waitFor(() =>
      expect(deleteAssetMock).toHaveBeenCalledWith(
        "/assets/assets/icon/scene-old.png",
      ),
    );
  });

  it("新建失败：错误原文 toast，弹窗保持打开（不静默吞掉）", async () => {
    createSceneMock.mockRejectedValueOnce(new Error("name is required"));
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建场景" }));
    await user.type(screen.getByLabelText("名称"), "学习");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("保存失败：name is required"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("删除失败：错误原文 toast，不触发刷新", async () => {
    deleteSceneMock.mockRejectedValueOnce(new Error("boom"));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "删除 工作" }));
    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("删除失败：boom"),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("删除非默认场景：确认文案写明分类与链接移入默认场景，确认后才调接口", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "删除 工作" }));
    expect(deleteSceneMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText("删除场景后无法恢复，其分类与链接会移入「通用」。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(deleteSceneMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除 工作" }));
    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteSceneMock).toHaveBeenCalledWith("s_work"));
    expect(toastSuccessMock).toHaveBeenCalledWith("场景已删除");
    expect(onChanged).toHaveBeenCalled();
  });

  it("删除文案里的场景名跟随默认场景当前名称（默认场景可改名）", async () => {
    const user = userEvent.setup();
    render(
      <ScenePanel
        scenes={[work, { ...common, name: "我的通用" }]}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除 工作" }));
    expect(
      screen.getByText("删除场景后无法恢复，其分类与链接会移入「我的通用」。"),
    ).toBeInTheDocument();
  });
});

describe("ScenePanel：场景可见性（两层取与）", () => {
  const secret: AdminScene = {
    ...work,
    id: "s_secret",
    name: "秘密",
    visibility: "private",
  };

  it("列表行显示公开 / 私有徽标（与分类列表同款）", () => {
    render(<ScenePanel scenes={[common, secret]} onChanged={vi.fn()} />);

    expect(screen.getAllByText("公开")).toHaveLength(1);
    expect(screen.getAllByText("私有")).toHaveLength(1);
  });

  it("新建场景可切换为私有，并随创建提交 visibility", async () => {
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建场景" }));
    await user.type(screen.getByLabelText("名称"), "秘密");
    await user.click(screen.getByRole("switch", { name: "私有场景" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(createSceneMock).toHaveBeenCalledWith({
        name: "秘密",
        icon: null,
        visibility: "private",
      }),
    );
  });

  it("编辑私有场景：开关已开，保存提交 private", async () => {
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, secret]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "编辑 秘密" }));
    expect(screen.getByRole("switch", { name: "私有场景" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateSceneMock).toHaveBeenCalledWith("s_secret", {
        name: "秘密",
        icon: null,
        visibility: "private",
      }),
    );
  });

  it("默认场景：私有开关禁用并说明原因，保存仍提交 public", async () => {
    const user = userEvent.setup();
    render(<ScenePanel scenes={[work, common]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "编辑 通用" }));
    expect(screen.getByRole("switch", { name: "私有场景" })).toBeDisabled();
    expect(
      screen.getByText("默认场景必须公开，不能设为私有。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateSceneMock).toHaveBeenCalledWith("s_default", {
        name: "通用",
        icon: null,
        visibility: "public",
      }),
    );
  });
});

describe("ScenePanel：拖拽排序（乐观）", () => {
  it("下移后顺序立刻变化（请求仍在飞），成功后不再整表重拉", async () => {
    const pending = deferred();
    reorderScenesMock.mockReturnValue(pending.promise);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<SceneHarness onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "下移 工作" }));

    expect(reorderScenesMock).toHaveBeenCalledWith(["s_default", "s_work"]);
    expect(useNavStore.getState().adminData?.scenes.map((s) => s.id)).toEqual([
      "s_default",
      "s_work",
    ]);
    expect(onChanged).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() => expect(reorderScenesMock.mock.calls.length).toBe(1));
    expect(listAllMock).not.toHaveBeenCalled();
  });
});

// ─── AdminPage：前后台收口 ────────────────────────────────────────────────────

describe("AdminPage：后台场景胶囊（只有场景、无「全部」）", () => {
  it("分类分区顶部渲染场景胶囊：只有场景、默认场景选中（回落不写盘）", () => {
    renderAdmin();

    const group = screen.getByRole("radiogroup", { name: "选择场景" });
    expect(within(group).queryByText("全部")).toBeNull();
    expect(
      within(group)
        .getAllByRole("radio")
        .map((el) => el.textContent),
    ).toEqual(["工作", "通用"]);
    expect(screen.getByRole("radio", { name: "通用" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // 回落结果不写回 localStorage（偏好里原本没有值）
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBeNull();
  });

  it("分类面板按当前场景过滤；切场景后只显示该场景分类并写回偏好", async () => {
    const user = userEvent.setup();
    renderAdmin();

    expect(screen.getByText("开发")).toBeInTheDocument();
    expect(screen.queryByText("运维")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "工作" }));

    expect(screen.getByText("运维")).toBeInTheDocument();
    expect(screen.queryByText("开发")).toBeNull();
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_work");
  });

  it("已存偏好指向工作：后台一进来就停在「工作」", () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "s_work");
    useScenePreferenceStore.setState({ raw: "s_work" });
    renderAdmin();

    expect(screen.getByRole("radio", { name: "工作" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("运维")).toBeInTheDocument();
    expect(screen.queryByText("开发")).toBeNull();
  });

  it("偏好指向已删除场景：回落默认场景，不写回 localStorage", () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "s_gone");
    useScenePreferenceStore.setState({ raw: "s_gone" });
    renderAdmin();

    expect(screen.getByRole("radio", { name: "通用" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_gone");
  });

  it("新建分类带当前场景 sceneId（切到「工作」后新建）", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(screen.getByRole("radio", { name: "工作" }));
    await user.click(screen.getByRole("button", { name: "新建分类" }));
    await user.type(screen.getByLabelText("名称"), "发布");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith({
        name: "发布",
        icon: null,
        visibility: "public",
        // 「工作」场景已有一个分类（sortOrder 0）→ 新分类追加到 1
        sortOrder: 1,
        sceneId: "s_work",
      }),
    );
  });

  it("「场景管理」分区可达，渲染场景面板", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(screen.getByRole("tab", { name: "场景管理" }));
    expect(
      screen.getByRole("heading", { name: "场景", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新建场景" }),
    ).toBeInTheDocument();
    // 分类面板已卸载
    expect(
      screen.queryByRole("heading", { name: "分类", level: 2 }),
    ).toBeNull();
  });

  it("没有场景（旧后端 / 无场景概念）：不渲染胶囊，分类保持现状平铺", () => {
    seedAdmin({
      ...adminData,
      scenes: [],
      categories: [
        { ...commonCategory, sceneId: "" },
        { ...workCategory, sceneId: "" },
      ],
    });
    renderAdmin();

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("开发")).toBeInTheDocument();
    expect(screen.getByText("运维")).toBeInTheDocument();
  });
});
