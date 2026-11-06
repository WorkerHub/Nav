import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import { useNavStore } from "@/lib/nav-store";
import {
  ALL_SCENES,
  SCENE_PREFERENCE_KEY,
  useScenePreferenceStore,
} from "@/lib/scene-preference";
import type { Scene, SiteCategory, SiteSettings } from "@/lib/types";

const settings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

const common: Scene = {
  id: "s_default",
  name: "通用",
  icon: null,
  sortOrder: 0,
  isDefault: true,
};
const work: Scene = {
  id: "s_work",
  name: "工作",
  icon: null,
  sortOrder: 1,
  isDefault: false,
};

function category(
  id: string,
  name: string,
  sceneId: string,
  sortOrder: number,
): SiteCategory {
  return {
    id,
    name,
    icon: null,
    sceneId,
    sortOrder,
    links: [
      {
        id: `link-${id}`,
        categoryId: id,
        title: `${name}链接`,
        url: `https://example.com/${id}`,
        iconUrl: null,
        description: null,
        sortOrder: 0,
      },
    ],
  };
}

const dev = category("cat-dev", "开发", "s_default", 0);
const ops = category("cat-ops", "运维", "s_work", 1);
const reading = category("cat-read", "阅读", "s_default", 2);

function seed(
  categories: SiteCategory[] = [dev, ops, reading],
  scenes: Scene[] = [common, work],
) {
  useNavStore.setState({
    publicData: { categories, scenes, searchEngines: [], settings },
    privateData: null,
    authStatus: "anonymous",
    loginPromptOpen: false,
    loadPublic: vi.fn(async () => {}),
    loadPrivate: vi.fn(async () => {}),
  });
}

function categoryHeadings(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((el) => el.textContent);
}

beforeEach(() => {
  localStorage.clear();
  useScenePreferenceStore.setState({ raw: null });
});

describe("PublicPage 场景胶囊：段序与位置", () => {
  it("两个场景：胶囊在搜索区之后、分类区之前，「全部」是第 1 段", () => {
    seed();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const search = screen.getByLabelText("搜索关键词");
    const group = screen.getByRole("radiogroup", { name: "切换场景" });
    const firstHeading = screen.getByRole("heading", {
      level: 2,
      name: "开发",
    });

    // 位置：搜索区 → 胶囊 → 导航区
    expect(
      search.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      group.compareDocumentPosition(firstHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getAllByRole("radio").map((el) => el.textContent)).toEqual([
      "全部",
      "通用",
      "工作",
    ]);
  });

  it("只有 1 个场景（仅通用）：与现状一致，不渲染胶囊，分类平铺", () => {
    seed([dev, reading], [common]);
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(categoryHeadings()).toEqual(["开发", "阅读"]);
  });

  it("老缓存 / 旧后端没有 scenes：不渲染胶囊，按现状平铺", () => {
    useNavStore.setState({
      publicData: {
        categories: [dev, ops, reading],
        // 运行时缺字段（类型契约要求存在，这里模拟旧缓存）
        scenes: undefined as never,
        searchEngines: [],
        settings,
      },
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: vi.fn(async () => {}),
      loadPrivate: vi.fn(async () => {}),
    });
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(categoryHeadings()).toEqual(["开发", "运维", "阅读"]);
  });
});

describe("PublicPage 场景切换：只做前端过滤", () => {
  it("默认「全部」显示所有场景的分类", () => {
    seed();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "全部" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // 按（场景 sortOrder，分类 sortOrder）排序：通用(0) 的开发/阅读在前，工作(1) 的运维随后
    expect(categoryHeadings()).toEqual(["开发", "阅读", "运维"]);
  });

  it("「全部」按场景顺序分组渲染（DTO 里场景内 sortOrder 交错也不乱）", () => {
    // DTO 顺序故意交错：通用 / 工作 / 通用 / 工作
    seed([
      category("cat-a", "开发", "s_default", 0),
      category("cat-c", "运维", "s_work", 1),
      category("cat-b", "阅读", "s_default", 2),
      category("cat-d", "发布", "s_work", 3),
    ]);
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    // 场景 sortOrder(通用 0 < 工作 1) 是第一键、分类 sortOrder 是第二键：
    // 通用两项在前（开发 0、阅读 2），工作两项随后（运维 1、发布 3）
    expect(categoryHeadings()).toEqual(["开发", "阅读", "运维", "发布"]);
    // 只排序、不加场景分段标题：仍是同一组分类区块
    expect(screen.queryByRole("heading", { name: "通用" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
  });

  it("点「工作」只留该场景分类，并写回本机偏好", async () => {
    seed();
    const user = userEvent.setup();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    // 挂载时本来就会拉一次公开数据：清掉调用记录，只断言「切换不再发请求」
    const loadPublic = vi.mocked(useNavStore.getState().loadPublic);
    loadPublic.mockClear();

    await user.click(screen.getByRole("radio", { name: "工作" }));

    expect(categoryHeadings()).toEqual(["运维"]);
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_work");
    // 切换不发请求：服务端始终返回全量
    expect(loadPublic).not.toHaveBeenCalled();
  });

  it("点「全部」恢复全部并写回 all", async () => {
    seed();
    useScenePreferenceStore.setState({ raw: "s_work" });
    const user = userEvent.setup();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(categoryHeadings()).toEqual(["运维"]);

    await user.click(screen.getByRole("radio", { name: "全部" }));
    expect(categoryHeadings()).toEqual(["开发", "阅读", "运维"]);
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe(ALL_SCENES);
  });

  it("已存偏好：首屏直接按该场景渲染", () => {
    seed();
    useScenePreferenceStore.setState({ raw: "s_work" });
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "工作" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryHeadings()).toEqual(["运维"]);
  });

  it("偏好指向已删除的场景：回落「全部」，且不把回落值写回 localStorage", () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "s_gone");
    useScenePreferenceStore.setState({ raw: "s_gone" });
    seed();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "全部" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryHeadings()).toEqual(["开发", "阅读", "运维"]);
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_gone");
  });

  it("登录后的私有分类同样按场景过滤", async () => {
    const privateOps = category("cat-private", "私有运维", "s_work", 3);
    useNavStore.setState({
      // 公开区：开发 + 运维；私密阅读与私有运维只在登录后的全量数据里
      publicData: {
        categories: [dev, ops],
        scenes: [common, work],
        searchEngines: [],
        settings,
      },
      privateData: {
        categories: [
          dev,
          ops,
          category("cat-priv", "私密阅读", "s_default", 2),
          privateOps,
        ],
        scenes: [common, work],
        searchEngines: [],
        settings,
      },
      authStatus: "authenticated",
      loginPromptOpen: false,
      loadPublic: vi.fn(async () => {}),
      loadPrivate: vi.fn(async () => {}),
    });
    useScenePreferenceStore.setState({ raw: "s_work" });
    const user = userEvent.setup();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(categoryHeadings()).toEqual(["运维", "私有运维"]);
    expect(screen.getAllByText("私有")).toHaveLength(1);

    await user.click(screen.getByRole("radio", { name: "全部" }));
    // 通用(0)：开发、私密阅读；工作(1)：运维、私有运维
    expect(categoryHeadings()).toEqual([
      "开发",
      "私密阅读",
      "运维",
      "私有运维",
    ]);
    expect(screen.getAllByText("私有")).toHaveLength(2);
  });
});
