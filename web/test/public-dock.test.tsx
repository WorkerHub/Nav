import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PublicDock } from "@/components/public-dock";
import { PublicPage } from "@/components/public-page";
import type { AuthStatus } from "@/lib/nav-store";
import { useNavStore } from "@/lib/nav-store";
import type { Scene, SiteSettings } from "@/lib/types";

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

function renderDock(
  overrides: {
    scenes?: Scene[];
    activeScene?: string | null;
    authStatus?: AuthStatus;
  } = {},
) {
  const props = {
    scenes: [] as Scene[],
    activeScene: null as string | null,
    onSceneChange: vi.fn(),
    authStatus: "anonymous" as AuthStatus,
    onOpenAdmin: vi.fn(),
    onLogin: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
  render(<PublicDock {...props} />);
  return props;
}

function dock() {
  return screen.getByRole("complementary", { name: "场景与快捷操作" });
}

describe("PublicDock：右下角固定坞", () => {
  it("固定贴右下、层级高于内容；外层不吃点击，面板各自可点", () => {
    renderDock();

    const aside = dock();
    expect(aside).toHaveClass("fixed", "bottom-4", "z-30", "items-end");
    // 坞占的透明区域不挡下面的链接
    expect(aside).toHaveClass("pointer-events-none");
    expect(
      screen.getByRole("button", { name: "登录" }).closest("div"),
    ).toHaveClass("pointer-events-auto");
  });

  it("探活未回（pending）：只有主题按钮，不渲染「登录」（不闪未登录）", () => {
    renderDock({ authStatus: "pending" });

    const scoped = within(dock());
    expect(scoped.queryByRole("button", { name: "登录" })).toBeNull();
    expect(scoped.queryByRole("button", { name: "后台" })).toBeNull();
    expect(scoped.queryByRole("button", { name: "退出" })).toBeNull();
    // 主题是本机偏好，不受登录态影响
    expect(scoped.getByRole("button", { name: /^主题：/ })).toBeInTheDocument();
  });

  it("未登录：只有「登录」，点它回调 onLogin", async () => {
    const user = userEvent.setup();
    const props = renderDock({ authStatus: "anonymous" });

    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(props.onLogin).toHaveBeenCalledTimes(1);
    expect(props.onOpenAdmin).not.toHaveBeenCalled();
  });

  it("已登录：「后台」与「退出」各走各的回调", async () => {
    const user = userEvent.setup();
    const props = renderDock({ authStatus: "authenticated" });

    await user.click(screen.getByRole("button", { name: "后台" }));
    await user.click(screen.getByRole("button", { name: "退出" }));
    expect(props.onOpenAdmin).toHaveBeenCalledTimes(1);
    expect(props.onLogout).toHaveBeenCalledTimes(1);
    expect(props.onLogin).not.toHaveBeenCalled();
  });
});

describe("PublicDock：场景胶囊组", () => {
  it("多个场景：胶囊竖排在坞的上部，点一段写回场景偏好", async () => {
    const user = userEvent.setup();
    const props = renderDock({
      scenes: [common, work],
      activeScene: "s_default",
    });

    const group = within(dock()).getByRole("radiogroup", { name: "切换场景" });
    // 竖排 + 定宽 + 组内滚动（场景多时不会把坞撑高）
    expect(group).toHaveClass(
      "flex-col",
      "w-28",
      "max-h-32",
      "overflow-y-auto",
    );
    expect(group).not.toHaveClass("flex-wrap");
    // 场景胶囊在按钮组之前（坞的「上部」）
    const login = screen.getByRole("button", { name: "登录" });
    expect(
      group.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: "工作" }));
    expect(props.onSceneChange).toHaveBeenCalledWith("s_work");
  });

  it("只有一个场景（仅「通用」）：不渲染胶囊，与场景维度上线前一致", () => {
    renderDock({ scenes: [common], activeScene: "s_default" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("没有场景概念（activeScene 为 null）：不渲染胶囊", () => {
    renderDock({ scenes: [common, work], activeScene: null });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("PublicPage 接入坞：登录仍走 LoginDialog", () => {
  const settings: SiteSettings = {
    siteTitle: "我的导航",
    backgroundUrl: "",
    wallpaperSource: "bing",
    logoUrl: "",
    columns: 6,
    searchNewTab: true,
  };

  it("点坞里的「登录」：置 loginPromptOpen，弹出登录框", async () => {
    const user = userEvent.setup();
    useNavStore.setState({
      publicData: { categories: [], scenes: [], searchEngines: [], settings },
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: async () => {},
      loadPrivate: async () => {},
    });

    render(<PublicPage onOpenAdmin={vi.fn()} />);
    await user.click(within(dock()).getByRole("button", { name: "登录" }));

    expect(useNavStore.getState().loginPromptOpen).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
