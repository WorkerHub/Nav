import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IconPickerField } from "@/components/admin/icon-picker";
import type { IconIndexEntry } from "@/lib/icon-search";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const index: IconIndexEntry[] = [
  {
    slug: "jellyfin",
    name: "Jellyfin",
    aliases: [],
    source: "dashboard",
    url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg",
  },
  {
    slug: "github",
    name: "GitHub",
    aliases: [],
    source: "simple",
    url: "https://cdn.simpleicons.org/github",
  },
];

describe("IconPickerField", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => index,
      }),
    );
  });

  it("标题非空时按标题预填、点选候选回填 CDN URL", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <IconPickerField
        id="link-icon"
        label="链接图标"
        value=""
        onChange={onChange}
        title="Jellyfin"
        url="https://jellyfin.example.com"
      />,
    );

    await user.click(screen.getByRole("button", { name: /从图标库选择/ }));

    const input = await screen.findByRole("combobox");
    expect(input).toHaveValue("Jellyfin");

    const option = await screen.findByRole("option", { name: /jellyfin/i });
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith(
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg",
    );
  });

  it("标题为空时按 URL 主机名首标签推导查询词", async () => {
    const user = userEvent.setup();
    render(
      <IconPickerField
        id="link-icon"
        label="链接图标"
        value=""
        onChange={vi.fn()}
        title=""
        url="https://github.com"
      />,
    );

    await user.click(screen.getByRole("button", { name: /从图标库选择/ }));

    const input = await screen.findByRole("combobox");
    expect(input).toHaveValue("github");
  });
});
