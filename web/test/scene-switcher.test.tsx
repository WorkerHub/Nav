import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SceneSwitcher } from "@/components/scene-switcher";
import { ALL_SCENES } from "@/lib/scene-preference";
import type { Scene } from "@/lib/types";

const work: Scene = {
  id: "s_work",
  name: "工作",
  icon: null,
  sortOrder: 0,
  isDefault: false,
};
const common: Scene = {
  id: "s_default",
  name: "通用",
  icon: "/assets/assets/icon/scene.png",
  sortOrder: 1,
  isDefault: true,
};

describe("SceneSwitcher：段序与视觉", () => {
  it("前台：第一段是「全部」（LayoutGrid 图标），其后按 DTO 顺序列场景（默认场景同等成段）", () => {
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value={ALL_SCENES}
        onValueChange={vi.fn()}
        includeAll
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "切换场景" });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((el) => el.textContent)).toEqual([
      "全部",
      "工作",
      "通用",
    ]);
    // 「全部」段带图标；场景段只显名称（不显示场景图标）
    expect(radios[0].querySelector("svg")).not.toBeNull();
    expect(radios[1].querySelector("svg")).toBeNull();
    expect(radios[2].querySelector("svg")).toBeNull();

    // 毛玻璃胶囊行 + 可换行（场景多/窄屏不横向溢出）
    expect(group).toHaveClass("glass", "flex-wrap");
  });

  it("后台：没有「全部」段，只有场景", () => {
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
    expect(screen.getAllByRole("radio").map((el) => el.textContent)).toEqual([
      "工作",
      "通用",
    ]);
  });

  it("选中的段是 aria-checked=true（Radix 单选组语义）", () => {
    render(
      <SceneSwitcher
        scenes={[work, common]}
        value="s_default"
        onValueChange={vi.fn()}
        includeAll
      />,
    );

    expect(screen.getByRole("radio", { name: "全部" })).toHaveAttribute(
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
        value={ALL_SCENES}
        onValueChange={onChange}
        includeAll
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
        includeAll
      />,
    );

    await user.click(screen.getByRole("radio", { name: "工作" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
