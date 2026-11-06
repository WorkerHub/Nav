import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SceneSwitcher } from "@/components/scene-switcher";
import type { Scene } from "@/lib/types";

const work: Scene = {
  id: "s_work",
  name: "工作",
  icon: null,
  sortOrder: 0,
  isDefault: false,
  visibility: "public",
};
const common: Scene = {
  id: "s_default",
  name: "通用",
  icon: "/assets/assets/icon/scene.png",
  sortOrder: 1,
  isDefault: true,
  visibility: "public",
};

describe("SceneSwitcher：只列真实场景", () => {
  it("没有「全部」段：按 DTO 顺序列场景（默认场景同等成段）", () => {
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value="s_default"
        onValueChange={vi.fn()}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "切换场景" });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((el) => el.textContent)).toEqual(["工作", "通用"]);
    // 场景段只显名称（不显示场景图标）
    expect(radios[0].querySelector("svg")).toBeNull();
    expect(radios[1].querySelector("svg")).toBeNull();
    expect(screen.queryByText("全部")).toBeNull();
    // 毛玻璃胶囊行（后台默认换行）
    expect(group).toHaveClass("glass", "flex-wrap");
  });

  it("前台顶栏覆盖为横向滚动：不换行、可横向滚动、隐藏滚动条", () => {
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value="s_work"
        onValueChange={vi.fn()}
        className="no-scrollbar max-w-full flex-nowrap overflow-x-auto"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "切换场景" });
    expect(group).toHaveClass("no-scrollbar", "flex-nowrap", "overflow-x-auto");
    // tailwind-merge 收掉了基础样式的 flex-wrap
    expect(group).not.toHaveClass("flex-wrap");
  });

  it("后台：可自定义分组名称", () => {
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value="s_work"
        onValueChange={vi.fn()}
        ariaLabel="选择场景"
      />,
    );

    expect(
      screen.getByRole("radiogroup", { name: "选择场景" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("全部")).toBeNull();
  });

  it("选中的段是 aria-checked=true（Radix 单选组语义）", () => {
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value="s_default"
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: "工作" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "通用" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("SceneSwitcher：交互", () => {
  it("点另一个场景回调它的 id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value="s_default"
        onValueChange={onChange}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "工作" }));
    expect(onChange).toHaveBeenCalledWith("s_work");
  });

  it("再点当前段（Radix 会回调空串）被忽略：不改变场景", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value="s_work"
        onValueChange={onChange}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "工作" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
