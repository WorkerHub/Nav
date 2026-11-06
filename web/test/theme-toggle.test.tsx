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
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

/** 站点数据（与 public-page.test.tsx 的 seed 同形） */
function seedSite(settings: SiteSettings = baseSettings) {
  useNavStore.setState({
    publicData: { categories: [], scenes: [], searchEngines: [], settings },
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

/** 系统外观（系统事实，不是站点设置）：用 matchMedia 表态，Provider 挂载时按它校准 store */
function mockSystemDark(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: matches && query === DARK_MEDIA_QUERY,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
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

describe("ThemeToggle：三档循环与 localStorage 记忆", () => {
  it("没点过时默认跟随系统（系统浅色）：连点三次依次 浅色 → 深色 → 跟随系统，每次都落盘", async () => {
    seedVisitor(null);
    renderToggle();

    const user = userEvent.setup();
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
    expect(localStorage.getItem(VISITOR_THEME_KEY)).toBeNull();
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

  it("没点过 + 系统深色：挂载即深色，按钮显示「跟随系统」", () => {
    seedVisitor(null);
    mockSystemDark(true);
    renderToggle();

    expect(htmlHasDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
  });

  it("刷新后从本机偏好恢复：本地 dark + 系统浅色，挂载即深色（无先亮后暗）", () => {
    seedVisitor("dark");
    renderToggle();

    expect(htmlHasDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(themeButton()).toHaveAccessibleName(
      "主题：深色，点击切换为跟随系统",
    );
  });

  it("本机偏好优先于系统外观：本地浅色 + 系统深色 → 浅色", () => {
    seedVisitor("light");
    mockSystemDark(true);
    renderToggle();

    expect(htmlHasDark()).toBe(false);
    expect(themeButton()).toHaveAccessibleName("主题：浅色，点击切换为深色");
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
    renderToggle();

    expect(htmlHasDark()).toBe(true);
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
  });

  it("跟随系统一档实时跟随：系统外观变了（matchMedia change）页面立即变色", () => {
    const listeners: ((e: MediaQueryListEvent) => void)[] = [];
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
            listeners.push(cb),
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    seedVisitor(null);
    renderToggle();
    expect(htmlHasDark()).toBe(false);

    act(() => {
      for (const cb of listeners) cb({ matches: true } as MediaQueryListEvent);
    });
    expect(htmlHasDark()).toBe(true);
  });

  it("本机存了非法值：当作没点过，跟随系统", () => {
    seedVisitor("purple");
    mockSystemDark(true);
    renderToggle();

    expect(useVisitorThemeStore.getState().mode).toBeNull();
    expect(htmlHasDark()).toBe(true);
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
  });

  it("站点数据未加载时按钮照常渲染（主题不再依赖站点数据）", () => {
    seedVisitor(null);
    seedNoSite();
    renderToggle();

    expect(themeButton()).toBeInTheDocument();
    expect(themeButton()).toHaveAccessibleName(
      "主题：跟随系统，点击切换为浅色",
    );
  });

  it("即使站点 DTO 里残留历史 theme 字段，也不影响深浅色（只跟本机偏好/系统）", () => {
    // 站点主题已删除：这是线上存量设置的形状（theme=light），必须完全不生效
    const withLegacyTheme = {
      ...baseSettings,
      theme: "dark",
    } as unknown as SiteSettings;
    seedSite(withLegacyTheme);
    seedVisitor(null);

    render(
      <ThemeProvider>
        <PublicPage onOpenAdmin={vi.fn()} />
      </ThemeProvider>,
    );

    expect(htmlHasDark()).toBe(false);
    const dock = screen.getByRole("complementary", {
      name: "场景与快捷操作",
    });
    expect(
      within(dock).getByRole("button", { name: /^主题：/ }),
    ).toHaveAccessibleName("主题：跟随系统，点击切换为浅色");
  });
});

describe("刷新后的真实恢复路径：模块初始化就读进 store", () => {
  it("localStorage 已有合法偏好时，store 初值就是它（不依赖组件同步）", async () => {
    localStorage.setItem(VISITOR_THEME_KEY, "dark");
    vi.resetModules();
    const fresh = await import("@/lib/theme");
    expect(fresh.useVisitorThemeStore.getState().mode).toBe("dark");
  });

  it("localStorage 是非法值时，模块初始化后 mode 为 null（回落到跟随系统）", async () => {
    localStorage.setItem(VISITOR_THEME_KEY, "purple");
    vi.resetModules();
    const fresh = await import("@/lib/theme");
    expect(fresh.useVisitorThemeStore.getState().mode).toBeNull();
  });
});

describe("PublicPage 右下角坞：主题按钮在三种登录态下都在", () => {
  // 只断言与本功能相关的事实（在不在、是否固定在坞里），不锁按钮总数：
  // 以后坞里加任何按钮都不该让这条用例失败。
  it.each(["pending", "anonymous", "authenticated"] as const)(
    "%s 状态：按钮在坞里，登录态按钮变化不影响它",
    (authStatus) => {
      seedVisitor(null);
      seedSite();
      useNavStore.setState({ authStatus });
      render(
        <ThemeProvider>
          <PublicPage onOpenAdmin={vi.fn()} />
        </ThemeProvider>,
      );

      // 顶栏已移除：主题按钮在右下角坞里，位置不随登录态变化
      expect(document.querySelector("header")).toBeNull();
      const dock = screen.getByRole("complementary", {
        name: "场景与快捷操作",
      });
      const toggle = within(dock).getByRole("button", { name: /^主题：/ });
      expect(toggle).toBeInTheDocument();

      const buttonNames = within(dock)
        .getAllByRole("button")
        .map((el) => el.getAttribute("aria-label") ?? el.textContent);
      // 探活未回：坞里只有主题按钮（不闪「登录」）
      if (authStatus === "pending")
        expect(buttonNames).toEqual(["主题：跟随系统，点击切换为浅色"]);
      if (authStatus === "anonymous") expect(buttonNames).toContain("登录");
      if (authStatus === "authenticated")
        expect(buttonNames).toEqual(expect.arrayContaining(["后台", "退出"]));
    },
  );
});

describe("无首帧闪烁：主题在 layout 阶段落地（不是被动 effect）", () => {
  it("子组件的被动 effect 看到的已是深色（Provider 用 useEffect 时这里是 false）", () => {
    seedVisitor("dark");
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
