import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CategorySection,
  CLASSIC_ICON_BOX,
  LINK_ICON_BOX,
  LinkGrid,
} from "@/components/link-grid";
import { CLASSIC_TILE_SIZE } from "@/lib/grid-columns";
import type { LinkStyle, SiteCategory, SiteLink } from "@/lib/types";

const links: SiteLink[] = [
  {
    id: "link-1",
    categoryId: "cat-dev",
    title: "GitHub",
    url: "https://github.com/",
    iconUrl: null,
    description: null,
    sortOrder: 0,
  },
  {
    id: "link-2",
    categoryId: "cat-dev",
    title: "MDN Web Docs 前端文档与参考手册",
    url: "https://developer.mozilla.org/",
    iconUrl: null,
    description: null,
    sortOrder: 1,
  },
];

/** 网格容器：普通/编辑模式共用的那个 `[data-link-grid]`。 */
function grid(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>("[data-link-grid]");
  if (!el) throw new Error("网格容器未找到");
  return el;
}

/** 某条链接里那个链接样式的图标盒（固定边长的方块）。 */
function iconBox(link: HTMLElement, linkStyle: LinkStyle): HTMLElement {
  const box = link.querySelector<HTMLElement>(`[data-icon-box="${linkStyle}"]`);
  if (!box) throw new Error(`图标盒未找到: ${linkStyle}`);
  return box;
}

describe("LinkGrid：三档样式", () => {
  it("缺省（不传 linkStyle）= classic：固定方砖、图标上名称下域名小字，整块居中 + 末行左对齐", () => {
    const { container } = render(<LinkGrid links={links} />);

    // classic 不再是网格：固定方砖 + 弹性换行；砖从左起排（末行与满行同列），
    // 整块靠 mx-auto + 内联 maxWidth 居中
    const gridEl = grid(container);
    expect(gridEl).toHaveClass(
      "flex",
      "flex-wrap",
      "w-full",
      "justify-start",
      "mx-auto",
    );
    expect(gridEl).not.toHaveClass("justify-center");
    expect(gridEl).not.toHaveClass("grid");
    expect(gridEl).not.toHaveClass("grid-cols-8");
    // 行组宽度上限走内联 maxWidth（columns 未配置 = 默认 8）
    expect(gridEl).toHaveStyle({ maxWidth: "1468px" });

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass", "flex-col", "text-center");
    // 方砖：宽高固定（与常量同源，改了任一处这条会挂）
    expect(link).toHaveClass(`size-[${CLASSIC_TILE_SIZE}px]`, "shrink-0");
    expect(link).not.toHaveClass("h-full");
    expect(link).not.toHaveClass("w-full");
    // FadeIn 那层是 flex item，不能把方砖压小
    expect(link.parentElement).toHaveClass("shrink-0");
    expect(link).toHaveTextContent("github.com");
    expect(link.querySelector("img")).toHaveAttribute("width", "44");
    // 图标在固定 44×44 的盒子里等比缩放、填满盒子
    const box = iconBox(link, "classic");
    expect(box).toHaveStyle({ width: "44px", height: "44px" });
    expect(box.querySelector("img")).toHaveClass("object-contain", "size-full");
  });

  it("compact：透明无卡片底、单行名称、不显示域名，桌面 5 列", () => {
    const { container } = render(
      <LinkGrid links={links} linkStyle="compact" />,
    );

    const compactGrid = grid(container);
    expect(compactGrid).toHaveClass(
      "grid-cols-2",
      "sm:grid-cols-3",
      "md:grid-cols-4",
      "lg:grid-cols-5",
    );
    expect(compactGrid).not.toHaveClass("grid-cols-4");
    // compact 不吃 classic 的排布参数
    expect(compactGrid.style.maxWidth).toBe("");

    const link = screen.getByRole("link", { name: /GitHub/ });
    // 无卡片底：不带 .glass / .glass-hover
    expect(link).not.toHaveClass("glass");
    expect(link).not.toHaveClass("glass-hover");
    // 不显示域名
    expect(link).not.toHaveTextContent("github.com");
    // 小图标在左、名称单行省略
    expect(link).toHaveClass("items-center");
    expect(link.querySelector("img")).toHaveAttribute("width", "20");
    expect(iconBox(link, "compact")).toHaveStyle({
      width: "20px",
      height: "20px",
    });
    expect(link.querySelector("span.min-w-0")).toHaveClass("truncate");
  });

  it("wide：玻璃底宽卡，图标左、右侧名称 + 域名两行，桌面 3 列", () => {
    const { container } = render(<LinkGrid links={links} linkStyle="wide" />);

    const wideGrid = grid(container);
    expect(wideGrid).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-2",
      "lg:grid-cols-3",
    );
    expect(wideGrid.style.maxWidth).toBe("");

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass", "glass-hover", "items-center");
    expect(link).toHaveTextContent("github.com");
    expect(link.querySelector("img")).toHaveAttribute("width", "36");
    expect(iconBox(link, "wide")).toHaveStyle({
      width: "36px",
      height: "36px",
    });
    // 名称与域名各占一行
    const title = screen.getByText("GitHub");
    expect(title).toHaveClass("block", "truncate");
  });

  it("三档图标盒尺寸与 LINK_ICON_BOX 一致、同档内每条都相同（不随图标文件变化）", () => {
    for (const style of ["classic", "compact", "wide"] as LinkStyle[]) {
      const { container, unmount } = render(
        <LinkGrid links={links} linkStyle={style} />,
      );
      const boxes = Array.from(
        container.querySelectorAll<HTMLElement>(`[data-icon-box="${style}"]`),
      );
      expect(boxes).toHaveLength(links.length);
      for (const box of boxes) {
        const size = `${LINK_ICON_BOX[style]}px`;
        expect(box).toHaveStyle({ width: size, height: size });
        // 盒子只量边，不靠图标自身尺寸：图与首字圆都填满盒子
        expect(box.firstElementChild).toHaveClass("size-full");
      }
      unmount();
    }
  });

  it("三档都保持外链口径：新标签页打开、noopener noreferrer", () => {
    for (const style of ["classic", "compact", "wide"] as LinkStyle[]) {
      const { unmount } = render(<LinkGrid links={links} linkStyle={style} />);
      const link = screen.getByRole("link", { name: /GitHub/ });
      expect(link).toHaveAttribute("href", "https://github.com/");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      unmount();
    }
  });
});

describe("CategorySection：把样式透传给网格，锚点偏移随顶栏移除调小", () => {
  const category: SiteCategory = {
    id: "cat-dev",
    name: "开发",
    icon: null,
    sceneId: "s_default",
    sortOrder: 0,
    links,
  };

  it("默认 classic；scroll-mt-6（不再是顶栏时代的 scroll-mt-24）", () => {
    const { container } = render(<CategorySection category={category} />);

    const section = container.querySelector("section");
    expect(section).toHaveAttribute("id", "cat-cat-dev");
    expect(section).toHaveClass("scroll-mt-6");
    expect(section).not.toHaveClass("scroll-mt-24");
    expect(grid(container)).toHaveStyle({ maxWidth: "1468px" });
  });

  it("linkStyle=wide：分类里的链接换成宽卡片", () => {
    const { container } = render(
      <CategorySection category={category} linkStyle="wide" />,
    );

    expect(grid(container)).toHaveClass("lg:grid-cols-3");
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveClass("glass");
  });
});

describe("LinkGrid：classic 成块列数（站点设置 columns）", () => {
  it("columns=5：行组上限 899.5px（5 块 + 4 个 48px 间距），砖尺寸不变", () => {
    const { container } = render(<LinkGrid links={links} columns={5} />);

    const gridEl = grid(container);
    expect(gridEl).toHaveStyle({ maxWidth: "899.5px" });
    // 没有按列数生成的 grid-cols 类名了
    expect(gridEl.className).not.toContain("grid-cols");
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveClass(
      `size-[${CLASSIC_TILE_SIZE}px]`,
    );
  });

  it("两个边界：columns=1 行组只有一块砖；columns=12 行组上限 2226px", () => {
    const single = render(<LinkGrid links={links} columns={1} />);
    expect(grid(single.container)).toHaveStyle({
      maxWidth: "141.5px",
      columnGap: "12px",
    });
    single.unmount();

    const max = render(<LinkGrid links={links} columns={12} />);
    expect(grid(max.container)).toHaveStyle({ maxWidth: "2226px" });
    max.unmount();
  });

  it("columns=0 / 不传：与默认 8 完全一致", () => {
    const zero = render(<LinkGrid links={links} columns={0} />);
    expect(grid(zero.container)).toHaveStyle({ maxWidth: "1468px" });
    zero.unmount();

    const none = render(<LinkGrid links={links} />);
    expect(grid(none.container)).toHaveStyle({ maxWidth: "1468px" });
  });

  it("columns 不影响砖尺寸：columns=4 与 columns=8 的砖类名一致", () => {
    const four = render(<LinkGrid links={links} columns={4} />);
    const fourTile = screen.getByRole("link", { name: /GitHub/ }).className;
    expect(grid(four.container)).toHaveStyle({ maxWidth: "710px" });
    four.unmount();

    const eight = render(<LinkGrid links={links} columns={8} />);
    const eightTile = screen.getByRole("link", { name: /GitHub/ }).className;
    expect(grid(eight.container)).toHaveStyle({ maxWidth: "1468px" });

    expect(fourTile).toBe(eightTile);
  });

  it("compact / wide 不看 columns：传了也不改变各自排法", () => {
    const compact = render(
      <LinkGrid links={links} linkStyle="compact" columns={5} />,
    );
    expect(grid(compact.container)).toHaveClass(
      "grid-cols-2",
      "sm:grid-cols-3",
      "md:grid-cols-4",
      "lg:grid-cols-5",
    );
    expect(grid(compact.container).style.maxWidth).toBe("");
    compact.unmount();

    const wide = render(
      <LinkGrid links={links} linkStyle="wide" columns={12} />,
    );
    expect(grid(wide.container)).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-2",
      "lg:grid-cols-3",
    );
    expect(grid(wide.container).className).not.toContain("xl:grid-cols-12");
    expect(grid(wide.container).style.maxWidth).toBe("");
  });

  it("CategorySection 把 columns 透传给容器", () => {
    const category: SiteCategory = {
      id: "cat-dev",
      name: "开发",
      icon: null,
      sceneId: "s_default",
      sortOrder: 0,
      links,
    };

    const { container } = render(
      <CategorySection category={category} columns={5} />,
    );

    expect(grid(container)).toHaveStyle({ maxWidth: "899.5px" });
  });
});

describe("LinkGrid：classic 砖块尺寸三档（tileSize）", () => {
  it("三档的砖宽、图标盒、名称/网址字号与行组宽度同步变化", () => {
    const cases = [
      {
        tileSize: "large" as const,
        px: 141.5,
        maxWidth: "1468px",
        icon: 44,
        titleClass: ["text-sm"],
        urlClass: ["text-xs"],
        gap: "gap-2",
        padding: "py-3",
      },
      {
        tileSize: "medium" as const,
        px: 113,
        maxWidth: "1240px",
        icon: 36,
        titleClass: ["text-[13px]", "leading-4"],
        urlClass: ["text-xs"],
        gap: "gap-1.5",
        padding: "py-1.5",
      },
      {
        tileSize: "small" as const,
        px: 92,
        maxWidth: "1072px",
        icon: 28,
        titleClass: ["text-xs"],
        urlClass: ["text-[11px]", "leading-4"],
        gap: "gap-1",
        padding: "py-0.5",
      },
    ];

    for (const c of cases) {
      const { unmount } = render(
        <LinkGrid links={links} tileSize={c.tileSize} />,
      );

      const link = screen.getByRole("link", { name: /GitHub/ });
      expect(link).toHaveClass(`size-[${c.px}px]`, c.gap, c.padding);
      // 图标盒按档缩小，且与导出常量同源
      expect(CLASSIC_ICON_BOX[c.tileSize]).toBe(c.icon);
      expect(iconBox(link, "classic")).toHaveStyle({
        width: `${c.icon}px`,
        height: `${c.icon}px`,
      });
      expect(screen.getByText("GitHub")).toHaveClass(...c.titleClass);
      expect(screen.getByText("github.com")).toHaveClass(...c.urlClass);

      unmount();
    }
  });

  it("CategorySection 把 tileSize 透传给容器（medium 8 列 = 1240px）", () => {
    const category: SiteCategory = {
      id: "cat-dev",
      name: "开发",
      icon: null,
      sceneId: "s_default",
      sortOrder: 0,
      links,
    };

    const { container } = render(
      <CategorySection category={category} tileSize="medium" />,
    );

    expect(grid(container)).toHaveStyle({ maxWidth: "1240px" });
  });

  it("compact / wide 忽略 tileSize，排法与砖壳保持不变", () => {
    const compact = render(
      <LinkGrid links={links} linkStyle="compact" tileSize="small" />,
    );
    expect(grid(compact.container)).toHaveClass("lg:grid-cols-5");
    expect(screen.getByRole("link", { name: /GitHub/ })).not.toHaveClass(
      "size-[92px]",
    );
    compact.unmount();

    const wide = render(
      <LinkGrid links={links} linkStyle="wide" tileSize="medium" />,
    );
    expect(grid(wide.container)).toHaveClass("lg:grid-cols-3");
    expect(screen.getByRole("link", { name: /GitHub/ })).not.toHaveClass(
      "size-[113px]",
    );
  });
});

describe("LinkGrid：显示网址开关（showUrl，缺省开）", () => {
  it("classic 档 showUrl=false：只留图标与名称，不渲染域名行", () => {
    render(<LinkGrid links={links} showUrl={false} />);

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveTextContent("GitHub");
    expect(link).not.toHaveTextContent("github.com");
  });

  it("wide 档 showUrl=false：右侧只剩名称一行，不渲染域名", () => {
    render(<LinkGrid links={links} linkStyle="wide" showUrl={false} />);

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass", "glass-hover");
    expect(link).toHaveTextContent("GitHub");
    expect(link).not.toHaveTextContent("github.com");
  });

  it("compact 档本来就不渲染域名：开关不改变它的形状", () => {
    const { container } = render(
      <LinkGrid links={links} linkStyle="compact" showUrl={false} />,
    );

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).not.toHaveTextContent("github.com");
    expect(link).toHaveClass("items-center");
    expect(grid(container)).toHaveClass("lg:grid-cols-5");
  });

  it("不传 showUrl（编辑模式口径）：classic / wide 仍显示域名", () => {
    for (const style of ["classic", "wide"] as LinkStyle[]) {
      const { unmount } = render(<LinkGrid links={links} linkStyle={style} />);
      expect(screen.getByRole("link", { name: /GitHub/ })).toHaveTextContent(
        "github.com",
      );
      unmount();
    }
  });

  it("CategorySection 把 showUrl 透传给网格", () => {
    const category: SiteCategory = {
      id: "cat-dev",
      name: "开发",
      icon: null,
      sceneId: "s_default",
      sortOrder: 0,
      links,
    };

    render(<CategorySection category={category} showUrl={false} />);

    expect(screen.getByRole("link", { name: /GitHub/ })).not.toHaveTextContent(
      "github.com",
    );
  });
});
