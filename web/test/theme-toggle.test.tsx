import * as React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useNavStore } from "@/lib/nav-store";
import {
  DARK_MEDIA_QUERY,
  readVisitorTheme,
  useThemeStore,
  useVisitorThemeStore,
  VISITOR_THEME_KEY,
} from "@/lib/theme";
import type { SiteSettings } from "@/lib/types";

const baseSettings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  logoUrl: "",
  theme: "system",
  columns: 6,
  searchNewTab: true,
};

/** 站点数据（与 public-page.test.tsx 的 seed 同形） */
function seedSite(theme: SiteSettings["theme"]) {
  useNavStore.setState({
    publicData: {
      categories: [],
      searchEngines: [],
      settings: { ...baseSettings, theme },
    },
    privateData: null,
    adminData: null,
    authStatus: "anonymous",
    loginPromptOpen: false,
    loadPublic: async () => {},
    loadPrivate: async () => {},
  });
}

/** 站点数据未加载（只有探活结果） */
function seedNoSite() {
  useNavStore.setState({
    publicData: null,
    privateData: null,
    adminData: null,
    authStatus: "anonymous",
    loginPromptOpen: false,
    loadPublic: async () => {},
    loadPrivate: async () => {},
  });
}

/**
 * 写 localStorage 并同步 store，给「已有偏好」的用例摆初始状态。
 * 注意它直接驱动 store：生产上的冷启动恢复路径（模块初始化时读取）由文件末尾
 * 「刷新后从 localStorage 恢复」那条用例单独覆盖。
 */
function seedVisitor(stored: string | null) {
  if (stored === null) localStorage.removeItem(VISITOR_THEME_KEY);
  else localStorage.setItem(VISITOR_THEME_KEY, stored);
  useVisitorThemeStore.setState({ mode: readVisitorTheme() });
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

/**
 * 只在被动 effect 里记录一次 <html> 是否已是深色：被动 effect 按「子 → 父」顺序跑，
 * 所以它能看出父级 ThemeProvider 是在 layout 阶段还是被动阶段落地的。
 */
function ClassProbe({ onRecord }: { onRecord: (dark: boolean) => void }) {
  const record = onRecord;
  React.useEffect(() => {
    record(document.documentElement.classList.contains("dark"));
  }, [record]);
  return null;
}

const themeButton = () => screen.getByRole("button", { name: /^主题：/ });
const htmlHasDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  localStorage.clear();
  useVisitorThemeStore.setState({ mode: readVisitorTheme() });
  useThemeStore.setState({ systemDark: false });
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("ThemeToggle：三态循环与 localStorage 记忆", () => {
  it("没点过时以站点设置为起点：连点三次依次 浅色 → 深色 → 跟随系统，每次都落盘", async () => {
    seedVisitor(null);
    seedSite("system");
    renderToggle();

    const user = userEvent.setup();
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBeNull();
    // 站点 system + 系统浅色：与现状一致，不猜，等数据到位后为浅色
    expect(htmlHasDark()).toBe(false);

    await user.click(themeButton());
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("light");
    expect(themeButton()).toHaveAccessibleName("主题：浅色，点击切换为深色");
    expect(htmlHasDark()).toBe(false);

    await user.click(themeButton());
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("dark");
    expect(themeButton()).toHaveAccessibleName(
      "主题：深色，点击切换为跟随系统",
    );
    expect(htmlHasDark()).toBe(true);

    await user.click(themeButton());
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("system");
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
    expect(htmlHasDark()).toBe(false);
  });

  it("循环起点跟着站点默认走：站点 dark 时首次点击落到「跟随系统」", async () => {
    seedVisitor(null);
    seedSite("dark");
    renderToggle();

    expect(htmlHasDark()).toBe(true);
    expect(themeButton()).toHaveAccessibleName(
      "主题：深色，点击切换为跟随系统",
    );

    await userEvent.setup().click(themeButton());
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("system");
  });

  it("刷新后从本机偏好恢复：本地 dark + 站点 light，挂载即深色（无先亮后暗）", () => {
    seedVisitor("dark");
    seedSite("light");
    renderToggle();

    // 渲染（layout effect 已在绘制前执行）第一刻就是深色，按钮显示「深色」
    expect(htmlHasDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(themeButton()).toHaveAccessibleName(
      "主题：深色，点击切换为跟随系统",
    );
  });

  it("访客偏好优先于站点默认：站点默认改了也不覆盖本机选择", () => {
    seedVisitor("light");
    seedSite("dark");
    renderToggle();

    expect(htmlHasDark()).toBe(false);
    expect(themeButton()).toHaveAccessibleName("主题：浅色，点击切换为深色");
  });

  it("点回「跟随系统」：本机偏好仍优先，改按系统外观解析（站点默认不覆盖）", async () => {
    seedVisitor("light");
    seedSite("light");
    renderToggle();
    expect(htmlHasDark()).toBe(false);

    await userEvent.setup().click(themeButton()); // light → dark
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("dark");
    await userEvent.setup().click(themeButton()); // dark → system
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBe("system");

    // 跟随系统 + 系统浅色：站点默认改成深色也不影响本机（本机已手动选过 system）
    act(() => seedSite("dark"));
    expect(htmlHasDark()).toBe(false);
  });

  it("没点过时站点默认改了，页面立即跟着变", () => {
    seedVisitor(null);
    seedSite("light");
    renderToggle();
    expect(htmlHasDark()).toBe(false);

    act(() => seedSite("dark"));
    expect(htmlHasDark()).toBe(true);
  });

  it("跟随系统一档订阅系统外观：系统深色时变深", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === DARK_MEDIA_QUERY,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    seedVisitor("system");
    seedSite("system");
    renderToggle();

    expect(htmlHasDark()).toBe(true);
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
  });

  it("本机存了非法值：当作没点过，回落站点设置", () => {
    seedVisitor("purple");
    seedSite("dark");
    renderToggle();

    expect(useVisitorThemeStore.getState().mode).toBeNull();
    expect(htmlHasDark()).toBe(true);
    expect(themeButton()).toHaveAccessibleName(
      "主题：深色，点击切换为跟随系统",
    );
  });

  it("站点数据未加载且没点过：不渲染按钮、不动 <html>", () => {
    seedVisitor(null);
    seedNoSite();
    renderToggle();

    expect(screen.queryByRole("button", { name: /^主题：/ })).toBeNull();
    expect(htmlHasDark()).toBe(false);
  });

  it("有本机偏好时站点数据未加载也能先按偏好上色并渲染按钮", () => {
    seedVisitor("dark");
    seedNoSite();
    renderToggle();

    expect(htmlHasDark()).toBe(true);
    expect(themeButton()).toBeInTheDocument();
  });
});

describe("刷新后的真实恢复路径：模块初始化就读进 store", () => {
  it("localStorage 已有合法偏好时，store 初值就是它（不依赖组件同步）", async () => {
    localStorage.setItem(VISITOR_THEME_KEY, "dark");
    vi.resetModules();
    const fresh = await import("@/lib/theme");
    expect(fresh.useVisitorThemeStore.getState().mode).toBe("dark");
  });

  it("localStorage 是非法值时，模块初始化后 mode 为 null（回落站点设置）", async () => {
    localStorage.setItem(VISITOR_THEME_KEY, "purple");
    vi.resetModules();
    const fresh = await import("@/lib/theme");
    expect(fresh.useVisitorThemeStore.getState().mode).toBeNull();
  });
});

describe("PublicPage 顶栏：主题按钮在三种登录态下都在，且固定在右侧", () => {
  // 只断言与本功能相关的事实（在不在、是不是组内最后一个），不锁按钮总数：
  // 以后顶栏加任何按钮都不该让这条用例失败。
  it.each(["pending", "anonymous", "authenticated"] as const)(
    "%s 状态：按钮在，且是顶栏最后一个按钮",
    (authStatus) => {
      seedVisitor(null);
      seedSite("light");
      useNavStore.setState({ authStatus });
      render(
        <ThemeProvider>
          <PublicPage onOpenAdmin={vi.fn()} />
        </ThemeProvider>,
      );

      const header = document.querySelector("header");
      expect(header).not.toBeNull();
      const scoped = within(header as HTMLElement);
      const toggle = scoped.getByRole("button", { name: /^主题：/ });
      // 登录/后台按钮出现或消失都不会把主题按钮顶来顶去：它始终在组内最右
      expect(scoped.getAllByRole("button").at(-1)).toBe(toggle);
    },
  );
});

describe("无首帧闪烁：主题在 layout 阶段落地（不是被动 effect）", () => {
  it("子组件的被动 effect 看到的已是深色（Provider 用 useEffect 时这里是 false）", () => {
    seedVisitor("dark");
    seedSite("light");
    const seen: boolean[] = [];
    render(
      <ThemeProvider>
        <ClassProbe
          onRecord={(dark) => {
            seen.push(dark);
          }}
        />
      </ThemeProvider>,
    );

    expect(seen[0]).toBe(true);
  });
});

describe("站点主题取值不受约束时的兜底：脏值不让页面崩", () => {
  /** 后端 settings 表是自由文本，存量行可能是历史脏值 */
  const dirtyTheme = (value: string) => value as SiteSettings["theme"];

  it("没点过 + 站点主题是非法值：当作未加载，不渲染按钮也不上色（不崩溃）", () => {
    seedVisitor(null);
    seedSite(dirtyTheme("purple"));

    expect(() => renderToggle()).not.toThrow();
    expect(screen.queryByRole("button", { name: /^主题：/ })).toBeNull();
    expect(htmlHasDark()).toBe(false);
  });

  it("有本机偏好 + 站点主题是非法值：按偏好正常渲染，不崩溃", () => {
    seedVisitor("dark");
    seedSite(dirtyTheme("purple"));

    expect(() => renderToggle()).not.toThrow();
    expect(htmlHasDark()).toBe(true);
    expect(themeButton()).toHaveAccessibleName(
      "主题：深色，点击切换为跟随系统",
    );
  });

  it("站点主题是非法值时 PublicPage 顶栏照常渲染（整页不白屏）", () => {
    seedVisitor(null);
    seedSite(dirtyTheme("purple"));
    useNavStore.setState({ authStatus: "anonymous" });

    expect(() =>
      render(
        <ThemeProvider>
          <PublicPage onOpenAdmin={vi.fn()} />
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
