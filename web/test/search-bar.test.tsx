import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  navigateSameTabWithoutReferrer,
  SearchBar,
} from "@/components/search-bar";
import type { SearchEngine } from "@/lib/types";

/**
 * 搜索跳转方式（站点设置 `searchNewTab`，默认开）：
 *  - 开：`window.open(url, "_blank", "noopener,noreferrer")`，起始页与会话保留；
 *  - 关：临时锚点（`rel="noreferrer"`）在当前页跳转，不带 Referer。
 * 两种方式都在 submit 的公共分支里，切换引擎（含自定义引擎）后行为一致。
 */

const google: SearchEngine = {
  id: "eng-google",
  name: "Google",
  urlTemplate: "https://www.google.com/search?q={q}",
  icon: null,
  sortOrder: 0,
  isDefault: true,
};

const custom: SearchEngine = {
  id: "eng-custom",
  name: "自建搜索",
  urlTemplate: "https://search.example.com/?wd={q}&lang=zh",
  icon: null,
  sortOrder: 1,
  isDefault: false,
};

const engines = [google, custom];

/**
 * jsdom 不实现真实导航：把 location 换成桩。带写入计数——同页跳转若退回
 * `window.location.href`，计数就会 > 0（那条路径压不住 Referer）。
 */
function stubLocation() {
  const state = { value: "http://localhost/start", writes: 0 };
  const location = {
    get href() {
      return state.value;
    },
    set href(next: string) {
      state.writes += 1;
      state.value = next;
    },
  };
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: location as unknown as Location,
  });
  return state;
}

/**
 * jsdom 里点锚点会触发未实现的导航：拦在 prototype 上，只记下「点的是哪个锚点」，
 * 用来断言同页跳转真的走的是带 rel="noreferrer" 的锚点。
 */
function stubAnchorClick() {
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  return clicked;
}

let openSpy: ReturnType<typeof vi.spyOn>;
let location: { value: string; writes: number };
let clickedAnchors: HTMLAnchorElement[];

beforeEach(() => {
  location = stubLocation();
  clickedAnchors = stubAnchorClick();
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

async function search(query: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("搜索关键词"), `${query}{enter}`);
}

async function switchEngine(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /当前搜索引擎/ }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

describe("SearchBar 视觉：卡片不做悬停上浮（防上下晃动回归）", () => {
  // Radix DropdownMenu 打开时给 body 设 pointer-events:none，卡片 :hover 随之丢失：
  // 带 .glass-hover 时 translateY(-1px) 会来回过渡，表现为切换引擎时搜索框上下晃动。
  // jsdom 不做布局，只能锁住「卡片没有这个类」这一根因链条的起点。
  it("搜索卡片只带 .glass，不带悬停上浮的 .glass-hover", () => {
    const { container } = render(<SearchBar engines={engines} />);

    const card = container.querySelector(".glass");
    expect(card).not.toBeNull();
    expect(card).toHaveClass("glass");
    expect(container.querySelector(".glass-hover")).toBeNull();
  });
});

describe("SearchBar 跳转方式：默认新标签打开", () => {
  it("回车在新标签页打开，当前页不动（noopener,noreferrer）", async () => {
    render(<SearchBar engines={engines} />);

    await search("react hooks");

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/search?q=react%20hooks",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.writes).toBe(0);
    // 新标签路径不借道同页锚点
    expect(clickedAnchors).toHaveLength(0);
  });

  it("显式 openInNewTab={true} 同为新标签打开", async () => {
    render(<SearchBar engines={engines} openInNewTab />);

    await search("nav");

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/search?q=nav",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.writes).toBe(0);
    expect(clickedAnchors).toHaveLength(0);
  });

  it("切换引擎后仍是新标签打开，且用该引擎的模板", async () => {
    render(<SearchBar engines={engines} />);

    await switchEngine("自建搜索");
    await search("nav 导航");

    expect(openSpy).toHaveBeenCalledWith(
      "https://search.example.com/?wd=nav%20%E5%AF%BC%E8%88%AA&lang=zh",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.writes).toBe(0);
    expect(clickedAnchors).toHaveLength(0);
  });
});

describe("SearchBar 跳转方式：关闭开关后当前页跳转（且不带 Referer）", () => {
  it("回车在当前页跳转：走 rel=noreferrer 的临时锚点，不新开标签、不写 location", async () => {
    render(<SearchBar engines={engines} openInNewTab={false} />);

    await search("react hooks");

    expect(openSpy).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(1);
    const [anchor] = clickedAnchors;
    // rel=noreferrer 是「这次导航不发 Referer」的唯一依据；location.href 压不住来源
    expect(anchor.rel).toBe("noreferrer");
    expect(anchor.target).toBe("_self");
    expect(anchor.getAttribute("href")).toBe(
      "https://www.google.com/search?q=react%20hooks",
    );
    // 临时锚点用完即撤；当前页本身不动（导航由锚点接管）
    expect(anchor.isConnected).toBe(false);
    expect(location.value).toBe("http://localhost/start");
    expect(location.writes).toBe(0);
  });

  it("切换引擎后仍是当前页跳转，且用该引擎的模板（同样 rel=noreferrer）", async () => {
    render(<SearchBar engines={engines} openInNewTab={false} />);

    await switchEngine("自建搜索");
    await search("nav 导航");

    expect(openSpy).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(1);
    const [anchor] = clickedAnchors;
    expect(anchor.rel).toBe("noreferrer");
    expect(anchor.getAttribute("href")).toBe(
      "https://search.example.com/?wd=nav%20%E5%AF%BC%E8%88%AA&lang=zh",
    );
    expect(location.writes).toBe(0);
  });
});

describe("navigateSameTabWithoutReferrer", () => {
  it("点一个挂了 rel=noreferrer 的锚点，点完从 DOM 撤掉、不留痕迹", () => {
    navigateSameTabWithoutReferrer("https://example.com/?q=1");

    expect(clickedAnchors).toHaveLength(1);
    const [anchor] = clickedAnchors;
    expect(anchor.rel).toBe("noreferrer");
    expect(anchor.getAttribute("href")).toBe("https://example.com/?q=1");
    expect(anchor.isConnected).toBe(false);
    expect(location.writes).toBe(0);
  });
});

describe("SearchBar 边界：空查询", () => {
  it("空查询 / 纯空格不跳转、不新开标签、不点锚点", async () => {
    render(<SearchBar engines={engines} />);

    await search("   ");

    expect(openSpy).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(0);
    expect(location.value).toBe("http://localhost/start");
  });
});
