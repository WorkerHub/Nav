import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PublicDock } from "@/components/public-dock";
import { PublicPage } from "@/components/public-page";
import { hashColor } from "@/lib/icons";
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
/** 设了图标的场景：坞里直接显示图标，不显示首字圆 */
const study: Scene = {
  id: "s_study",
  name: "学习",
  icon: "/assets/assets/icon/scene-study.png",
  sortOrder: 2,
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

describe("PublicDock：右下角单图标宽竖排轨道", () => {
  it("固定贴右下、整坞只有一个图标宽（w-11）；外层不吃点击，面板各自可点", () => {
    renderDock();

    const aside = dock();
    expect(aside).toHaveClass(
      "fixed",
      "right-4",
      "bottom-4",
      "z-30",
      "w-11",
      "items-center",
    );
    // 改造前是 112px 的横向文字坞，现在不再有那个宽度
    expect(aside).not.toHaveClass("w-28");
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

  it("未登录：只有「登录」，图标按钮无文字、title/aria-label 带功能名", async () => {
    const user = userEvent.setup();
    const props = renderDock({ authStatus: "anonymous" });

    const login = screen.getByRole("button", { name: "登录" });
    expect(login).toHaveAttribute("title", "登录");
    expect(login.textContent).toBe("");
    expect(login).toHaveClass("size-11", "rounded-full");

    await user.click(login);
    expect(props.onLogin).toHaveBeenCalledTimes(1);
    expect(props.onOpenAdmin).not.toHaveBeenCalled();
  });

  it("已登录：「后台」与「退出」各是图标按钮，各走各的回调", async () => {
    const user = userEvent.setup();
    const props = renderDock({ authStatus: "authenticated" });

    const admin = screen.getByRole("button", { name: "后台" });
    const logout = screen.getByRole("button", { name: "退出" });
    expect(admin.textContent).toBe("");
    expect(logout.textContent).toBe("");
    expect(admin).toHaveAttribute("title", "后台");
    expect(logout).toHaveAttribute("title", "退出");

    await user.click(admin);
    await user.click(logout);
    expect(props.onOpenAdmin).toHaveBeenCalledTimes(1);
    expect(props.onLogout).toHaveBeenCalledTimes(1);
    expect(props.onLogin).not.toHaveBeenCalled();
  });

  it("主题按钮也是单图标宽、无文字（功能名在 aria-label/title）", () => {
    renderDock();

    const theme = within(dock()).getByRole("button", { name: /^主题：/ });
    expect(theme).toHaveClass("size-11", "rounded-full");
    expect(theme.textContent).toBe("");
    expect(theme).toHaveAttribute("title", theme.getAttribute("aria-label"));
  });
});

describe("PublicDock：场景图标组", () => {
  it("多个场景：场景图标竖排在坞的上部，点一个写回场景偏好", async () => {
    const user = userEvent.setup();
    const props = renderDock({
      scenes: [common, work],
      activeScene: "s_default",
    });

    const group = within(dock()).getByRole("radiogroup", { name: "切换场景" });
    // 竖排 + 单图标宽 + 组内滚动（场景多时不会把坞撑高），不再是原来的玻璃卡
    expect(group).toHaveClass(
      "flex-col",
      "w-full",
      "max-h-40",
      "overflow-y-auto",
    );
    expect(group).not.toHaveClass("flex-wrap", "glass");
    // 场景图标在按钮组之前（坞的「上部」）
    const login = screen.getByRole("button", { name: "登录" });
    expect(
      group.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const radio = screen.getByRole("radio", { name: "工作" });
    expect(radio).toHaveClass("size-11", "rounded-full");
    await user.click(radio);
    expect(props.onSceneChange).toHaveBeenCalledWith("s_work");
  });

  it("没设图标的场景：圆形底 + 场景名首字，title/aria-label 是场景名", () => {
    renderDock({ scenes: [common, work], activeScene: "s_default" });

    const radio = screen.getByRole("radio", { name: "通用" });
    expect(radio).toHaveAttribute("title", "通用");
    expect(radio.querySelector("img")).toBeNull();
    expect(radio).toHaveTextContent("通");

    const initial = radio.querySelector("span");
    expect(initial).toHaveAttribute("aria-hidden", "true");
    expect(initial).toHaveStyle({ background: hashColor("s_default") });
  });

  it("设了图标的场景：显示图片，不显示首字圆", () => {
    renderDock({ scenes: [common, study], activeScene: "s_study" });

    const radio = screen.getByRole("radio", { name: "学习" });
    expect(radio).toHaveAttribute("title", "学习");
    const img = radio.querySelector("img");
    expect(img).toHaveAttribute("src", "/assets/assets/icon/scene-study.png");
    expect(radio.textContent).toBe("");

    // 选中态沿用 glass-scene-trigger 的底色/描边口径
    expect(radio).toHaveClass("glass-scene-trigger");
    expect(radio).toHaveAttribute("aria-checked", "true");
  });

  it("只有一个场景（仅「通用」）：不渲染场景图标，与场景维度上线前一致", () => {
    renderDock({ scenes: [common], activeScene: "s_default" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("没有场景概念（activeScene 为 null）：不渲染场景图标", () => {
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
