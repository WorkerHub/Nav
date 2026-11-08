import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import { useNavStore } from "@/lib/nav-store";
import type { SearchEngine, SiteCategory, SiteSettings } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseSettings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

function seed(settings: SiteSettings) {
  useNavStore.setState({
    publicData: { categories: [], scenes: [], searchEngines: [], settings },
    privateData: null,
    authStatus: "anonymous",
    loginPromptOpen: false,
    loadPublic: async () => {},
    loadPrivate: async () => {},
  });
}

describe("PublicPage 头部：有 Logo 显示 Logo，无 Logo 显示标题文字", () => {
  beforeEach(() => {
    seed(baseSettings);
  });

  it("settings.logoUrl 有值：头部渲染 Logo 图（alt 取站点标题）", () => {
    seed({ ...baseSettings, logoUrl: "/assets/assets/logo/site.svg" });

    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const heading = screen.getByRole("heading", { level: 1 });
    const logo = within(heading).getByRole("img", { name: "我的导航" });
    expect(logo).toHaveAttribute("src", "/assets/assets/logo/site.svg");
    expect(heading).toHaveTextContent("");
  });

  it("settings.logoUrl 为空：头部维持标题文字", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("我的导航");
    expect(within(heading).queryByRole("img")).toBeNull();
  });
});

describe("PublicPage 头部：时钟块取代顶栏", () => {
  /** 两个分类各带链接：旧锚点栏在分类多时会横向溢出，现已整块移除。 */
  const categories: SiteCategory[] = [
    {
      id: "cat-dev",
      name: "开发",
      icon: null,
      sceneId: "scene_default",
      sortOrder: 0,
      links: [
        {
          id: "link-1",
          categoryId: "cat-dev",
          title: "GitHub",
          url: "https://github.com/",
          iconUrl: null,
          description: null,
          sortOrder: 0,
        },
      ],
    },
    {
      id: "cat-read",
      name: "阅读",
      icon: null,
      sceneId: "scene_default",
      sortOrder: 1,
      links: [],
    },
  ];

  function seedSite(settings: SiteSettings = baseSettings) {
    useNavStore.setState({
      publicData: {
        categories,
        scenes: [],
        searchEngines: [],
        settings,
      },
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: async () => {},
      loadPrivate: async () => {},
    });
  }

  beforeEach(() => {
    seedSite();
  });

  it("顶栏整条移除：页面没有 header / banner，站点标题在首屏时钟块的 h1 里", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(document.querySelector("header")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();

    const main = document.querySelector("main");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(main?.contains(heading)).toBe(true);
    expect(heading).toHaveTextContent("我的导航");
    // 时钟块在搜索区之前：正文第一行是「标题 | HH:MM」
    const search = screen.getByLabelText("搜索关键词");
    expect(
      heading.compareDocumentPosition(search) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("正文底部留白足够让最后一行链接超出固定坞（pb-96），锚点偏移调小（scroll-mt-6）", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(document.querySelector("main")).toHaveClass("pb-96");
    const section = document.getElementById("cat-cat-dev");
    expect(section).toHaveClass("scroll-mt-6");
    expect(section).not.toHaveClass("scroll-mt-24");
  });

  it("搜索框不再有 placeholder（引擎选择与提交逻辑不在本用例范围）", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const input = screen.getByLabelText("搜索关键词");
    expect(input).not.toHaveAttribute("placeholder");
  });

  it("settings.linkStyle=compact：链接按紧凑横排渲染（无域名、无卡片底）", () => {
    seedSite({ ...baseSettings, linkStyle: "compact" });
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).not.toHaveClass("glass");
    expect(link).not.toHaveTextContent("github.com");
    expect(link.parentElement?.parentElement).toHaveClass("lg:grid-cols-5");
  });

  it("settings.linkStyle=wide：宽卡片（玻璃底 + 名称与域名两行）", () => {
    seedSite({ ...baseSettings, linkStyle: "wide" });
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass");
    expect(link).toHaveTextContent("github.com");
    expect(link.parentElement?.parentElement).toHaveClass("lg:grid-cols-3");
  });

  it("旧后端 / 旧缓存没有 linkStyle：回落 classic（玻璃瓦片 + 域名，与改动前一致）", () => {
    seedSite(baseSettings);
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass");
    expect(link).toHaveTextContent("github.com");
    expect(link.parentElement?.parentElement).toHaveClass("xl:grid-cols-8");
  });

  it("settings.showUrl=false：普通模式卡片不渲染域名，名称与跳转不变", () => {
    seedSite({ ...baseSettings, showUrl: false });
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).not.toHaveTextContent("github.com");
    expect(link).toHaveTextContent("GitHub");
    expect(link).toHaveAttribute("href", "https://github.com/");
  });

  it("showUrl=false 对 wide 档同样生效：只剩名称一行", () => {
    seedSite({ ...baseSettings, linkStyle: "wide", showUrl: false });
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass");
    expect(link).toHaveTextContent("GitHub");
    expect(link).not.toHaveTextContent("github.com");
  });

  it("旧后端 / 旧缓存没有 showUrl：回落「开」，照旧显示域名", () => {
    seedSite(baseSettings);
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveTextContent(
      "github.com",
    );
  });

  it("不再渲染分类 anchor 栏，正文分类区块与链接照旧", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(
      screen.queryByRole("navigation", { name: "分类锚点" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "开发" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/",
    );
  });
});

describe("PublicPage：搜索跳转方式跟随站点设置 searchNewTab", () => {
  const engines: SearchEngine[] = [
    {
      id: "eng-google",
      name: "Google",
      urlTemplate: "https://www.google.com/search?q={q}",
      icon: null,
      sortOrder: 0,
      isDefault: true,
    },
  ];

  function seedWithEngines(settings: SiteSettings) {
    useNavStore.setState({
      publicData: {
        categories: [],
        scenes: [],
        searchEngines: engines,
        settings,
      },
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: async () => {},
      loadPrivate: async () => {},
    });
  }

  async function submitSearch() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("搜索关键词"), "nav{enter}");
  }

  it("searchNewTab=false：搜索在当前页跳转，且不带 Referer（rel=noreferrer 锚点）", async () => {
    seedWithEngines({ ...baseSettings, searchNewTab: false });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const location = { href: "http://localhost/start" };
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: location as unknown as Location,
    });
    // jsdom 里点锚点会触发未实现的导航：拦在 prototype 上，只记下被点的锚点
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    render(<PublicPage onOpenAdmin={vi.fn()} />);
    await submitSearch();

    expect(openSpy).not.toHaveBeenCalled();
    // 跳转交给挂了 rel=noreferrer 的临时锚点：这次导航不向搜索站发 Referer
    expect(clicked).toHaveLength(1);
    expect(clicked[0].rel).toBe("noreferrer");
    expect(clicked[0].getAttribute("href")).toBe(
      "https://www.google.com/search?q=nav",
    );
    expect(clicked[0].isConnected).toBe(false);
    expect(location.href).toBe("http://localhost/start");
  });

  it("设置缺该字段（存量库）时按默认开：新标签打开", async () => {
    seedWithEngines({ ...baseSettings, searchNewTab: undefined as never });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const location = { href: "http://localhost/start" };
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: location as unknown as Location,
    });

    render(<PublicPage onOpenAdmin={vi.fn()} />);
    await submitSearch();

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/search?q=nav",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.href).toBe("http://localhost/start");
  });
});

describe("PublicPage：壁纸来源解析（缺省 bing）", () => {
  /** 背景层是唯一的 aria-hidden 且带 backgroundImage 的 div。 */
  function backgroundLayer(container: HTMLElement): HTMLElement {
    const el = Array.from(
      container.querySelectorAll<HTMLElement>('div[aria-hidden="true"]'),
    ).find((d) => d.style.backgroundImage);
    if (!el) throw new Error("背景层未找到");
    return el;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("站点设置未到达（publicData 为 null）：不发起探针，背景层不指向端点", () => {
    useNavStore.setState({
      publicData: null,
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: async () => {},
      loadPrivate: async () => {},
    });
    const imageSpy = vi.fn();
    vi.stubGlobal("Image", imageSpy);

    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);

    // 设置没回之前不应提前拉取整张大图。
    expect(imageSpy).not.toHaveBeenCalled();
    expect(backgroundLayer(container).style.backgroundImage).not.toContain(
      "/api/wallpaper/today",
    );
  });

  it("wallpaperSource=bing（缺省）+ 无 backgroundUrl：背景层指向 /api/wallpaper/today", () => {
    seed(baseSettings);
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    expect(backgroundLayer(container).style.backgroundImage).toContain(
      "/api/wallpaper/today",
    );
  });

  it("wallpaperSource=custom + backgroundUrl 非空：背景层用 backgroundUrl", () => {
    seed({
      ...baseSettings,
      wallpaperSource: "custom",
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    const bg = backgroundLayer(container).style.backgroundImage;
    expect(bg).toContain("https://cdn.example.com/bg.jpg");
    expect(bg).not.toContain("/api/wallpaper/today");
  });

  it("wallpaperSource=custom 但 backgroundUrl 为空：回落 /api/wallpaper/today", () => {
    seed({ ...baseSettings, wallpaperSource: "custom", backgroundUrl: "" });
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    expect(backgroundLayer(container).style.backgroundImage).toContain(
      "/api/wallpaper/today",
    );
  });

  it("wallpaperSource=bing 但 backgroundUrl 非空：仍用 Bing（忽略自定义图）", () => {
    seed({
      ...baseSettings,
      wallpaperSource: "bing",
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    expect(backgroundLayer(container).style.backgroundImage).toContain(
      "/api/wallpaper/today",
    );
  });

  it("bing 图加载失败：回落 backgroundUrl（非空）", async () => {
    seed({
      ...baseSettings,
      wallpaperSource: "bing",
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);

    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);

    await waitFor(() =>
      expect(backgroundLayer(container).style.backgroundImage).toContain(
        "https://cdn.example.com/bg.jpg",
      ),
    );
  });

  it("bing 图加载失败且无 backgroundUrl：去掉 url 层（纯色底）", async () => {
    seed({ ...baseSettings, wallpaperSource: "bing", backgroundUrl: "" });

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);

    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);

    await waitFor(() => {
      const bg = backgroundLayer(container).style.backgroundImage;
      expect(bg).not.toContain("/api/wallpaper/today");
      expect(bg).not.toContain("cdn.example.com");
    });
  });
});
