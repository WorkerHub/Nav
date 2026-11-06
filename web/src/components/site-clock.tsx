import * as React from "react";

/**
 * 公共页顶部时钟块（顶栏移除后的页面头）：
 *
 *   ┌─────────────────────────┐
 *   │ 站点标题 | 09:05        │  ← 第一行：站点标题（或 Logo）+ 时间
 *   │ 11-6 星期四             │  ← 第二行：本月日期与星期
 *   └─────────────────────────┘
 *
 * 时间取**浏览器本地时区**、精度到分钟（不显示秒）。站点标题为空（且没有 Logo）时
 * 第一行只剩时间 —— 标题是可选配置，空标题不该在页面上留一条孤零零的分隔符。
 *
 * 刷新粒度：对齐到**下一分钟边界**再更新（不是 1 秒轮询），所以分钟翻转是即时的；
 * 后台标签页的定时器会被浏览器节流/挂起，回到前台时（`visibilitychange`）立即按
 * 真实时间校正一次并重排，避免出现「停在上一个分钟」的旧值。
 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** `HH:MM`（24 小时制，补零，不显示秒）。 */
export function formatClockTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** `M-D 星期X`（月/日不补零，星期用中文数字：`11-6 星期四`）。 */
export function formatClockDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}-${day} 星期${WEEKDAYS[date.getDay()]}`;
}

/**
 * 每分钟更新一次的当前时间：先同步一次，再把定时器对齐到下一分钟边界
 * （+60ms 余量，保证回调落在新的一分钟里而不是边界前）。
 */
function useMinuteTick(): Date {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    let timer: number | undefined;

    const sync = () => setNow(new Date());
    const schedule = () => {
      const current = new Date();
      const delay =
        (60 - current.getSeconds()) * 1000 - current.getMilliseconds() + 60;
      timer = window.setTimeout(() => {
        sync();
        schedule();
      }, delay);
    };
    schedule();

    // 标签页从后台回来：挂起的定时器可能刚补发、也可能还没到点，直接按真实时间校正并重排
    const onVisibilityChange = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      sync();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return now;
}

export function SiteClock({
  siteTitle,
  logoUrl,
}: {
  siteTitle?: string;
  logoUrl?: string | null;
}) {
  const now = useMinuteTick();
  const hasTitle = Boolean(siteTitle) || Boolean(logoUrl);

  return (
    <div className="flex flex-col items-center gap-1 text-white">
      <div className="flex items-center gap-2 sm:gap-3">
        {hasTitle && (
          <>
            {/*
              h1 只包站点标识（与旧顶栏同一口径：logoUrl 有值显示 Logo 图，
              否则显示站点标题文字），时间不进标题 —— 否则读屏会把每分钟变化的
              数字念成页面标题的一部分。
            */}
            <h1 className="flex min-w-0 items-center font-heading text-2xl font-semibold drop-shadow sm:text-3xl">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={siteTitle || "站点 Logo"}
                  className="h-9 w-auto max-w-[200px] object-contain"
                />
              ) : (
                <span className="min-w-0 truncate">{siteTitle}</span>
              )}
            </h1>
            <span aria-hidden="true" className="text-white/50">
              |
            </span>
          </>
        )}
        <time
          dateTime={now.toISOString()}
          className="font-heading text-2xl font-semibold tabular-nums drop-shadow sm:text-3xl"
        >
          {formatClockTime(now)}
        </time>
      </div>
      <p className="text-xs text-white/70 sm:text-sm">{formatClockDate(now)}</p>
    </div>
  );
}
