import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "@/components/admin/admin-page";
import { ThemeProvider } from "@/components/theme-provider";
import type { AdminData } from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import {
  readVisitorTheme,
  useThemeStore,
  useVisitorThemeStore,
  VISITOR_THEME_KEY,
} from "@/lib/theme";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const logoutMock = vi.fn(async () => {});
const loadAdminMock = vi.fn(async () => {});

const adminData: AdminData = {
  scenes: [],
  categories: [
    {
      id: "cat-1",
      name: "开发",
      icon: null,
      sceneId: "scene_default",
      sortOrder: 0,
      visibility: "public",
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
    },
  ],
  links: [],
  searchEngines: [
    {
      id: "eng-1",
      name: "Google",
      urlTemplate: "https://www.google.com/search?q={q}",
      icon: null,
      sortOrder: 0,
      isDefault: true,
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

function seedAdmin(settings: Partial<AdminData["settings"]> = {}) {
  useNavStore.setState({
    adminData: {
      ...adminData,
      settings: { ...adminData.settings, ...settings },
    },
    publicData: null,
    privateData: null,
    authStatus: "authenticated",
    loginPromptOpen: false,
    loadAdmin: loadAdminMock,
    logout: logoutMock,
  });
}

function renderAdmin(onBack = vi.fn()) {
  render(
    <ThemeProvider>
      <AdminPage onBack={onBack} />
    </ThemeProvider>,
  );
  return { onBack };
}

/** 背景层：全站共用的那层 aria-hidden + backgroundImage 的 div。 */
function backgroundLayer(): HTMLElement {
  const el = Array.from(
    document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]'),
  ).find((d) => d.style.backgroundImage);
  if (!el) throw new Error("背景层未找到");
  return el;
}

beforeEach(() => {
  logoutMock.mockClear();
  loadAdminMock.mockClear();
  useVisitorThemeStore.setState({ mode: readVisitorTheme() });
  useThemeStore.setState({ systemDark: false });
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("AdminPage 外壳：玻璃顶栏 + 左栏菜单 + 壁纸背景 + 玻璃内容卡", () => {
  it("顶栏是整条毛玻璃：站点标题 + 返回首页 + 主题 + 退出登录", () => {
    seedAdmin();
    renderAdmin();

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    const head = within(header as HTMLElement);
    expect(head.getByRole("heading", { level: 1 })).toHaveTextContent(
      "我的导航",
    );
    expect(head.getByRole("button", { name: "返回首页" })).toBeInTheDocument();
    expect(head.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(head.getByRole("button", { name: /^主题：/ })).toBeInTheDocument();
  });

  it("站点有 logoUrl 时顶栏显示 Logo（与公共页同口径）", () => {
    seedAdmin({ logoUrl: "/assets/assets/logo/site.svg" });
    renderAdmin();

    const heading = screen.getByRole("heading", { level: 1 });
    const logo = within(heading).getByRole("img", { name: "我的导航" });
    expect(logo).toHaveAttribute("src", "/assets/assets/logo/site.svg");
  });

  it("背景层与公共页同款：壁纸来源 bing 时指向 /api/wallpaper/today", () => {
    seedAdmin();
    renderAdmin();
    expect(backgroundLayer().style.backgroundImage).toContain(
      "/api/wallpaper/today",
    );
  });

  it("背景层跟随自定义壁纸设置", () => {
    seedAdmin({
      wallpaperSource: "custom",
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });
    renderAdmin();
    expect(backgroundLayer().style.backgroundImage).toContain(
      "https://cdn.example.com/bg.jpg",
    );
  });

  it("分区菜单是单一 TabsList，八项齐全（含「关于」与图标，链接不在后台管）", () => {
    seedAdmin();
    renderAdmin();

    const tablist = screen.getAllByRole("tablist");
    expect(tablist).toHaveLength(1);
    const tabs = within(tablist[0]).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "分类",
      "场景管理",
      "搜索引擎",
      "站点设置",
      "导入导出",
      "安全 / 两步验证",
      "系统管理",
      "关于",
    ]);
    // 首页编辑模式接管链接的增删改与拖动，后台不再有「链接」入口
    expect(screen.queryByRole("tab", { name: "链接" })).toBeNull();
    for (const tab of tabs) {
      expect(tab.querySelector("svg")).not.toBeNull();
    }
  });

  it("「关于」分区：应用名、构建时注入的版本号、仓库链接、技术栈与版权行", async () => {
    const user = userEvent.setup();
    seedAdmin();
    renderAdmin();

    await user.click(screen.getByRole("tab", { name: "关于" }));

    expect(
      screen.getByRole("heading", { level: 2, name: "关于" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nav")).toBeInTheDocument();
    // 版本号来自 vite define（仓库根 package.json），不是手写常量
    expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /WorkerHub\/nav/ }),
    ).toHaveAttribute("href", "https://github.com/WorkerHub/nav");
    expect(screen.getByText(/React · TypeScript/)).toBeInTheDocument();
    expect(screen.getByText(/^© \d{4} Nav/)).toBeInTheDocument();
  });

  it("宽屏（≥1024px）左栏竖排：Tabs 与 Radix 都按 vertical（aria-orientation 同步）", () => {
    const spy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(min-width: 1024px)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    try {
      seedAdmin();
      renderAdmin();
      expect(document.querySelector('[data-slot="tabs"]')).toHaveAttribute(
        "data-orientation",
        "vertical",
      );
      // 真正的证据：Radix 自己按 context.orientation 写出的 aria-orientation。
      // 只查根节点的 data-orientation 会漏掉「wrapper 没把 orientation 透传给 Radix」。
      expect(screen.getByRole("tablist")).toHaveAttribute(
        "aria-orientation",
        "vertical",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("窄屏：Tabs 根与 Radix 都是 horizontal（同一 TabsList 变成顶部横排菜单条）", () => {
    // setup.ts 的 matchMedia 替身一律 matches:false（= 窄屏）
    seedAdmin();
    renderAdmin();
    expect(document.querySelector('[data-slot="tabs"]')).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
  });

  it("宽屏竖排：方向键 ↓ 切到下一项（orientation 真的进了 Radix 的键盘映射）", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(min-width: 1024px)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    try {
      seedAdmin();
      renderAdmin();

      const first = screen.getByRole("tab", { name: "分类" });
      first.focus();
      await user.keyboard("{ArrowDown}");

      expect(screen.getByRole("tab", { name: "场景管理" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("左栏玻璃面：TabsList 保留 .glass，且默认的 bg-muted 被玻璃令牌替掉", () => {
    seedAdmin();
    renderAdmin();

    const list = screen.getByRole("tablist");
    expect(list).toHaveClass("glass");
    expect(list).toHaveClass("bg-[var(--glass-bg)]");
    // cn 的 tailwind-merge 必须把 cva 默认变体的 bg-muted 收掉，否则它（utilities 层）
    // 会盖过 .glass（components 层）的半透明底，左栏变成不透明实色块。
    expect(list.className).not.toContain("bg-muted");
  });

  it("分区内容放在毛玻璃卡片里（.glass）", () => {
    seedAdmin();
    renderAdmin();

    const heading = screen.getByRole("heading", { name: "分类", level: 2 });
    expect(heading.closest(".glass")).not.toBeNull();
  });
});

describe("AdminPage 分区切换：逻辑与面板不变，只换外壳", () => {
  it("默认显示分类；点「站点设置」切到设置面板，分类面板卸载", async () => {
    const user = userEvent.setup();
    seedAdmin();
    renderAdmin();

    expect(
      screen.getByRole("heading", { name: "分类", level: 2 }),
    ).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "站点设置" }));

    expect(
      screen.getByRole("heading", { name: "站点设置", level: 2 }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "分类", level: 2 }),
    ).toBeNull();
    // 站点设置里没有主题项（站点主题已删除），壁纸来源还在
    expect(screen.queryByLabelText("选择主题")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "选择壁纸来源" }),
    ).toBeVisible();
  });

  it("「导入导出」面板可达（菜单七项都能点开）", async () => {
    const user = userEvent.setup();
    seedAdmin();
    renderAdmin();

    await user.click(screen.getByRole("tab", { name: "导入导出" }));
    expect(
      screen.getByRole("heading", { name: "导入导出", level: 2 }),
    ).toBeVisible();
  });

  it("加载中（adminData 未回）：保留「加载中…」提示与外壳", () => {
    useNavStore.setState({ adminData: null, loadAdmin: loadAdminMock });
    renderAdmin();

    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(document.querySelector("header")).not.toBeNull();
    expect(backgroundLayer()).toBeInTheDocument();
  });
});

describe("AdminPage 顶栏操作", () => {
  it("返回首页调用 onBack", async () => {
    const user = userEvent.setup();
    seedAdmin();
    const { onBack } = renderAdmin();

    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("退出登录调用 store 的 logout（与公共页同款行为）", async () => {
    const user = userEvent.setup();
    seedAdmin();
    renderAdmin();

    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});

describe("AdminPage 主题：报障复现路径（后台背景跟随主题按钮）", () => {
  it("无本机偏好时是「跟随系统」；连点两下到深色，<html> 立即变深", async () => {
    const user = userEvent.setup();
    localStorage.removeItem(VISITOR_THEME_KEY);
    useVisitorThemeStore.setState({ mode: null });
    seedAdmin();
    renderAdmin();

    const toggle = screen.getByRole("button", { name: /^主题：/ });
    expect(toggle).toHaveAccessibleName("主题：跟随系统，点击切换为浅色");

    await user.click(toggle); // system → light
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(toggle); // light → dark
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("此前存过 dark 本机偏好的浏览器：后台一打开就是深色", () => {
    localStorage.setItem(VISITOR_THEME_KEY, "dark");
    useVisitorThemeStore.setState({ mode: "dark" });
    seedAdmin();
    renderAdmin();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(
      screen.getByRole("button", { name: /^主题：/ }),
    ).toHaveAccessibleName("主题：深色，点击切换为跟随系统");
  });
});
