import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import { useNavStore } from "@/lib/nav-store";
import {
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
const secret: Scene = {
  id: "s_secret",
  name: "秘密",
  icon: null,
  sortOrder: 2,
  isDefault: false,
  visibility: "private",
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

/** 坞里的场景图标按钮（名称走 aria-label，图标本体不作为可见文字） */
function radioNames(): (string | null)[] {
  return screen
    .getAllByRole("radio")
    .map((el) => el.getAttribute("aria-label"));
}

beforeEach(() => {
  localStorage.clear();
  useScenePreferenceStore.setState({ raw: null });
});

describe("PublicPage 场景图标：右下角坞内竖排、只列真实场景", () => {
  it("两个场景：场景图标在右下角坞（complementary）里，段序只有真实场景且没有「全部」", () => {
    seed();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    // 顶栏已移除：场景图标住在右下角固定坞里，不再占用页面顶部的栏位
    expect(screen.queryByRole("banner")).toBeNull();
    const dock = screen.getByRole("complementary", {
      name: "场景与快捷操作",
    });
    const group = within(dock).getByRole("radiogroup", {
      name: "切换场景",
    });

    // 竖排坞：单图标宽（w-11 = 44px），场景多时组内纵向滚动
    expect(dock).toHaveClass("w-11");
    expect(group).toHaveClass("flex-col");
    expect(group).toHaveClass("overflow-y-auto", "w-full", "max-h-40");
    expect(group).not.toHaveClass("flex-wrap");
    // 坞本身固定贴右下、层级高于内容
    expect(dock).toHaveClass("fixed", "bottom-4", "z-30");

    expect(screen.queryByText("全部")).toBeNull();
    expect(radioNames()).toEqual(["通用", "工作"]);
  });

  it("只有 1 个场景（仅通用）：与现状一致，不渲染场景图标，分类只按该场景显示", () => {
    seed([dev, reading], [common]);
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(categoryHeadings()).toEqual(["开发", "阅读"]);
  });

  it("老缓存 / 旧后端没有 scenes：不渲染场景图标，按现状平铺", () => {
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

describe("PublicPage 场景切换：默认场景、只做前端过滤", () => {
  it("没选过偏好：默认场景（通用）选中，只显示该场景分类", () => {
    seed();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "通用" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryHeadings()).toEqual(["开发", "阅读"]);
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

  it("存量偏好是「全部」（all）：回落默认场景，且不把回落值写回 localStorage", () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "all");
    useScenePreferenceStore.setState({ raw: "all" });
    seed();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "通用" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryHeadings()).toEqual(["开发", "阅读"]);
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("all");
  });

  it("偏好指向已删除的场景：回落默认场景，且不写回偏好", () => {
    localStorage.setItem(SCENE_PREFERENCE_KEY, "s_gone");
    useScenePreferenceStore.setState({ raw: "s_gone" });
    seed();
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "通用" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryHeadings()).toEqual(["开发", "阅读"]);
    expect(localStorage.getItem(SCENE_PREFERENCE_KEY)).toBe("s_gone");
  });

  it("偏好指向私有场景、未登录时坞里没有它：回落到公开的默认场景，页面不空白", () => {
    // /api/public 只下发公开场景（秘密不在列表里），分类数据同样只含公开场景的分类。
    useScenePreferenceStore.setState({ raw: "s_secret" });
    seed([dev, reading], [common, work]);
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "通用" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryHeadings()).toEqual(["开发", "阅读"]);
    expect(screen.queryByText("秘密")).toBeNull();
  });

  it("登录后坞里改用全量场景（含私有场景），私有场景的分类按场景显示", () => {
    const secretCategory = category("cat-secret", "密钥", "s_secret", 3);
    useNavStore.setState({
      publicData: {
        categories: [dev, ops],
        scenes: [common, work],
        searchEngines: [],
        settings,
      },
      privateData: {
        categories: [dev, ops, secretCategory],
        scenes: [common, work, secret],
        searchEngines: [],
        settings,
      },
      authStatus: "authenticated",
      loginPromptOpen: false,
      loadPublic: vi.fn(async () => {}),
      loadPrivate: vi.fn(async () => {}),
    });
    useScenePreferenceStore.setState({ raw: "s_secret" });
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(radioNames()).toEqual(["通用", "工作", "秘密"]);
    expect(screen.getByRole("radio", { name: "秘密" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(categoryHeadings()).toEqual(["密钥"]);
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

    await user.click(screen.getByRole("radio", { name: "通用" }));
    // 默认场景：开发、私密阅读；工作场景的运维/私有运维不再显示
    expect(categoryHeadings()).toEqual(["开发", "私密阅读"]);
    expect(screen.getAllByText("私有")).toHaveLength(1);
  });
});
