import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SiteClock,
  formatClockDate,
  formatClockTime,
} from "@/components/site-clock";

describe("SiteClock：格式口径（原生 Date，本地时区）", () => {
  it("时间补零到 HH:MM，日期不补零并带中文星期", () => {
    // 2026-11-06 是星期五
    const date = new Date(2026, 10, 6, 9, 5, 0);
    expect(formatClockTime(date)).toBe("09:05");
    expect(formatClockDate(date)).toBe("11-6 星期五");
  });

  it("24 小时制：下午 18:05 显示 18:05，月/日单位数时不补零", () => {
    const date = new Date(2026, 0, 9, 18, 5, 0);
    expect(formatClockTime(date)).toBe("18:05");
    expect(formatClockDate(date)).toBe("1-9 星期五");
  });

  it("星期日显示「星期日」（不是「星期天」或空串）", () => {
    expect(formatClockDate(new Date(2026, 2, 15, 0, 0, 0))).toBe("3-15 星期日");
  });
});

describe("SiteClock：顶部时钟块", () => {
  beforeEach(() => {
    // 固定在一个分钟边界上，便于验证「对齐到下一分钟」的刷新
    vi.useFakeTimers({ now: new Date(2026, 10, 6, 9, 5, 0) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("第一行是「站点标题 | HH:MM」，第二行是日期与星期", () => {
    render(<SiteClock siteTitle="我的导航" />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("我的导航");
    // 时间不进标题（读屏不该把每分钟变化的数字念成页面标题）
    expect(heading).not.toHaveTextContent("09:05");
    expect(screen.getByText("09:05")).toBeInTheDocument();
    expect(screen.getByText("11-6 星期五")).toBeInTheDocument();
  });

  it("标题为空：只显示时间，不留分隔符与空标题", () => {
    render(<SiteClock siteTitle="" />);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByText("09:05")).toBeInTheDocument();
    expect(screen.queryByText("|")).toBeNull();
    expect(screen.getByText("11-6 星期五")).toBeInTheDocument();
  });

  it("logoUrl 有值：标题位置显示 Logo 图，alt 取站点标题", () => {
    render(
      <SiteClock siteTitle="我的导航" logoUrl="/assets/assets/logo/site.svg" />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    const logo = within(heading).getByRole("img", { name: "我的导航" });
    expect(logo).toHaveAttribute("src", "/assets/assets/logo/site.svg");
    expect(heading).not.toHaveTextContent("我的导航");
    expect(screen.getByText("09:05")).toBeInTheDocument();
  });

  it("分钟翻转及时：越过分钟边界自动更新，不停在旧值", () => {
    render(<SiteClock siteTitle="我的导航" />);
    expect(screen.getByText("09:05")).toBeInTheDocument();

    // 定时器对齐到 09:06:00.060；跨过边界后应显示新的一分钟
    act(() => {
      vi.advanceTimersByTime(60_100);
    });
    expect(screen.getByText("09:06")).toBeInTheDocument();
    expect(screen.queryByText("09:05")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_100);
    });
    expect(screen.getByText("09:07")).toBeInTheDocument();
  });

  it("标签页从后台回到前台：立即按真实时间校正（不等到下一秒）", () => {
    render(<SiteClock siteTitle="我的导航" />);
    expect(screen.getByText("09:05")).toBeInTheDocument();

    // 后台期间定时器没跑，真实时间已经走到 09:08 —— 回到前台立刻校正
    vi.setSystemTime(new Date(2026, 10, 6, 9, 8, 2));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("09:08")).toBeInTheDocument();
  });
});
