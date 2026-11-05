import * as React from "react";
import type { SiteSettings } from "@/lib/types";

const BING_WALLPAPER_ENDPOINT = "/api/wallpaper/today";

/** 背景图未就绪 / 取图失败时的底色（深蓝灰，与罩层同色系）。 */
const FALLBACK_BACKGROUND_COLOR = "#0f172a";

/**
 * 全站背景层（公共页与后台**共用同一份实现**，不要另写一份近似的）：
 *
 *  - 壁纸来源（`settings.wallpaperSource`，缺省 bing）：`custom` 且填了
 *    `backgroundUrl` 才用自定义图，否则（bing / custom 但地址为空）都走 Bing 每日
 *    壁纸端点；
 *  - 站点设置未到达（`settings` 为 undefined/null）时先不解析来源、也不发探针，
 *    只显示纯色底，以免设置还没回就提前拉取整张大图；
 *  - bing 取图失败时回落：先试 `backgroundUrl`（非空），再落到纯色底（url 层去掉）；
 *  - 图上盖一层同款渐变罩层，保证毛玻璃面与正文的可读性（MASTER §3.2）。
 */
export function WallpaperBackground({
  settings,
}: {
  settings?: SiteSettings | null;
}) {
  const settingsReady = settings !== undefined && settings !== null;
  const wallpaperSource = settings?.wallpaperSource ?? "bing";
  const customBackgroundUrl = settings?.backgroundUrl ?? "";
  const useBing =
    settingsReady && (wallpaperSource !== "custom" || !customBackgroundUrl);

  const [bingFailed, setBingFailed] = React.useState(false);
  React.useEffect(() => {
    setBingFailed(false);
    if (!useBing) return;
    const img = new Image();
    img.onload = () => setBingFailed(false);
    img.onerror = () => setBingFailed(true);
    img.src = BING_WALLPAPER_ENDPOINT;
  }, [useBing]);

  const backgroundUrl = !settingsReady
    ? ""
    : useBing && !bingFailed
      ? BING_WALLPAPER_ENDPOINT
      : customBackgroundUrl;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(rgba(15,23,42,0.55), rgba(15,23,42,0.35)), url(${JSON.stringify(
          backgroundUrl,
        )})`,
        backgroundColor: FALLBACK_BACKGROUND_COLOR,
      }}
    />
  );
}
