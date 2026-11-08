import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategorySection, LinkGrid } from "@/components/link-grid";
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

/** 网格容器：条目外面那层 `grid`。 */
function grid(container: HTMLElement) {
  const el = container.querySelector(".grid");
  if (!el) throw new Error("网格容器未找到");
  return el;
}

describe("LinkGrid：三档样式", () => {
  it("缺省（不传 linkStyle）= classic：图标上、名称下、域名小字，列数沿现状", () => {
    const { container } = render(<LinkGrid links={links} />);

    expect(grid(container)).toHaveClass(
      "grid-cols-4",
      "sm:grid-cols-5",
      "md:grid-cols-6",
      "lg:grid-cols-7",
      "xl:grid-cols-8",
    );
    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass", "flex-col", "text-center");
    expect(link).toHaveTextContent("github.com");
    expect(link.querySelector("img")).toHaveAttribute("width", "44");
  });

  it("compact：透明无卡片底、单行名称、不显示域名，桌面 5 列", () => {
    const { container } = render(
      <LinkGrid links={links} linkStyle="compact" />,
    );

    expect(grid(container)).toHaveClass(
      "grid-cols-2",
      "sm:grid-cols-3",
      "md:grid-cols-4",
      "lg:grid-cols-5",
    );
    expect(grid(container)).not.toHaveClass("grid-cols-4");

    const link = screen.getByRole("link", { name: /GitHub/ });
    // 无卡片底：不带 .glass / .glass-hover
    expect(link).not.toHaveClass("glass");
    expect(link).not.toHaveClass("glass-hover");
    // 不显示域名
    expect(link).not.toHaveTextContent("github.com");
    // 小图标在左、名称单行省略
    expect(link).toHaveClass("items-center");
    expect(link.querySelector("img")).toHaveAttribute("width", "20");
    expect(link.querySelector("span.min-w-0")).toHaveClass("truncate");
  });

  it("wide：玻璃底宽卡，图标左、右侧名称 + 域名两行，桌面 3 列", () => {
    const { container } = render(<LinkGrid links={links} linkStyle="wide" />);

    expect(grid(container)).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-2",
      "lg:grid-cols-3",
    );

    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toHaveClass("glass", "glass-hover", "items-center");
    expect(link).toHaveTextContent("github.com");
    expect(link.querySelector("img")).toHaveAttribute("width", "36");
    // 名称与域名各占一行
    const title = screen.getByText("GitHub");
    expect(title).toHaveClass("block", "truncate");
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
    expect(grid(container)).toHaveClass("xl:grid-cols-8");
  });

  it("linkStyle=wide：分类里的链接换成宽卡片", () => {
    const { container } = render(
      <CategorySection category={category} linkStyle="wide" />,
    );

    expect(grid(container)).toHaveClass("lg:grid-cols-3");
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveClass("glass");
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
