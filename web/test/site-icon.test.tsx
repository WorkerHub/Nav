import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteIcon } from "@/components/site-icon";
import { faviconCandidates } from "@/lib/icons";

/**
 * 图标来源契约（docs/api-contract.md § GET /api/icon）：
 * 候选为 `[iconUrl, "/api/icon?url=" + encodeURIComponent(url)]`，两档都失败回退首字圆；
 * 不再有 Google s2 与目标站裸 `/favicon.ico` 两个直连候选。
 */

const endpoint = (url: string) => `/api/icon?url=${encodeURIComponent(url)}`;

describe("faviconCandidates", () => {
  it("无手动图标时只走本站端点", () => {
    const url = "https://github.com/workerhub/nav";
    expect(faviconCandidates(url)).toEqual([endpoint(url)]);
  });

  it("手动图标排第一，其次本站端点", () => {
    const url = "https://example.com/";
    expect(faviconCandidates(url, "/assets/assets/icon/a.png")).toEqual([
      "/assets/assets/icon/a.png",
      endpoint(url),
    ]);
  });

  it("不再出现 Google s2 与目标站裸 /favicon.ico", () => {
    const candidates = faviconCandidates("https://example.com/");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).not.toContain("google.com");
    expect(candidates[0]).not.toContain("example.com/favicon.ico");
  });

  it("畸形 URL 与非 http(s) 不请求端点，直接首字圆", () => {
    expect(faviconCandidates("not a url")).toEqual([]);
    expect(faviconCandidates("ftp://example.com/a")).toEqual([]);
    expect(faviconCandidates("/relative")).toEqual([]);
    // 手动图标不受 url 畸形影响
    expect(faviconCandidates("not a url", "/assets/x.png")).toEqual([
      "/assets/x.png",
    ]);
  });
});

describe("SiteIcon", () => {
  /** 取当前图片元素；没有就显式失败（不用非空断言）。 */
  function currentImg(container: HTMLElement): HTMLImageElement {
    const img = container.querySelector("img");
    if (!img) throw new Error("expected an <img> in container");
    return img;
  }

  it("无手动图标：img 指向本站 /api/icon", () => {
    const url = "https://example.com/";
    const { container } = render(<SiteIcon title="示例" url={url} />);
    expect(currentImg(container).getAttribute("src")).toBe(endpoint(url));
  });

  it("手动图标优先，失败后才回退端点", () => {
    const url = "https://example.com/";
    const iconUrl = "/assets/assets/icon/a.png";
    const { container } = render(
      <SiteIcon title="示例" url={url} iconUrl={iconUrl} />,
    );
    expect(currentImg(container).getAttribute("src")).toBe(iconUrl);

    fireEvent.error(currentImg(container));
    expect(currentImg(container).getAttribute("src")).toBe(endpoint(url));
  });

  it("两档都失败回退首字圆", () => {
    const url = "https://example.com/";
    const { container } = render(
      <SiteIcon title="示例" url={url} iconUrl="/assets/assets/icon/a.png" />,
    );
    fireEvent.error(currentImg(container));
    fireEvent.error(currentImg(container));

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("示")).toBeInTheDocument();
  });

  it("畸形 URL 不发图请求，直接首字圆", () => {
    const { container } = render(<SiteIcon title="示例" url="not a url" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("示")).toBeInTheDocument();
  });

  it("url 变化（切换搜索引擎）后从第一候选重试", () => {
    const urlA = "https://a.example.com/";
    const urlB = "https://b.example.com/";
    const { container, rerender } = render(<SiteIcon title="A" url={urlA} />);
    fireEvent.error(currentImg(container));
    expect(container.querySelector("img")).toBeNull();

    rerender(<SiteIcon title="B" url={urlB} />);
    expect(currentImg(container).getAttribute("src")).toBe(endpoint(urlB));
  });

  it("A→B→A 来回切换：切回 A 仍从第一候选重试", () => {
    const urlA = "https://a.example.com/";
    const urlB = "https://b.example.com/";
    const { container, rerender } = render(<SiteIcon title="A" url={urlA} />);
    fireEvent.error(currentImg(container));
    expect(container.querySelector("img")).toBeNull();

    rerender(<SiteIcon title="B" url={urlB} />);
    expect(currentImg(container).getAttribute("src")).toBe(endpoint(urlB));

    rerender(<SiteIcon title="A" url={urlA} />);
    expect(currentImg(container).getAttribute("src")).toBe(endpoint(urlA));
  });

  it("手动图标换成另一个后重试新值，不被旧失败跳过", () => {
    const url = "https://example.com/";
    const { container, rerender } = render(
      <SiteIcon title="示例" url={url} iconUrl="/assets/a.png" />,
    );
    fireEvent.error(currentImg(container));
    expect(currentImg(container).getAttribute("src")).toBe(endpoint(url));

    rerender(<SiteIcon title="示例" url={url} iconUrl="/assets/b.png" />);
    expect(currentImg(container).getAttribute("src")).toBe("/assets/b.png");
  });

  it("旧 src 的 error 不推进新候选（候选变化时换元素）", () => {
    const urlA = "https://a.example.com/";
    const urlB = "https://b.example.com/";
    const { container, rerender } = render(<SiteIcon title="A" url={urlA} />);
    const oldImg = currentImg(container);

    rerender(<SiteIcon title="B" url={urlB} />);
    const newImg = currentImg(container);
    expect(newImg).not.toBe(oldImg);
    expect(newImg.getAttribute("src")).toBe(endpoint(urlB));

    // 模拟被中止的旧请求补发的 error：旧元素已不在文档里，不得影响新候选
    fireEvent.error(oldImg);
    expect(currentImg(container).getAttribute("src")).toBe(endpoint(urlB));
  });
});
