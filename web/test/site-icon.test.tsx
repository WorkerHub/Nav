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
  it("无手动图标：img 指向本站 /api/icon", () => {
    const url = "https://example.com/";
    const { container } = render(<SiteIcon title="示例" url={url} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(endpoint(url));
  });

  it("手动图标优先，失败后才回退端点", () => {
    const url = "https://example.com/";
    const iconUrl = "/assets/assets/icon/a.png";
    const { container } = render(
      <SiteIcon title="示例" url={url} iconUrl={iconUrl} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(iconUrl);

    fireEvent.error(img!);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      endpoint(url),
    );
  });

  it("两档都失败回退首字圆", () => {
    const url = "https://example.com/";
    const { container } = render(
      <SiteIcon title="示例" url={url} iconUrl="/assets/assets/icon/a.png" />,
    );
    fireEvent.error(container.querySelector("img")!);
    fireEvent.error(container.querySelector("img")!);

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
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();

    rerender(<SiteIcon title="B" url={urlB} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      endpoint(urlB),
    );
  });
});
