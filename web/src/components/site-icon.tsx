import * as React from "react";
import { faviconCandidates, hashColor, initialOf } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * 站点图标：手动指定的图标优先，其次是本站 `/api/icon` 解析出的 favicon，
 * 两者都失败时回退「按域名哈希着色的首字圆」（MASTER.md §1.4）。
 */
export function SiteIcon({
  title,
  url,
  iconUrl,
  size = 40,
  className,
}: {
  title: string;
  url: string;
  iconUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const candidates = React.useMemo(
    () => faviconCandidates(url, iconUrl),
    [url, iconUrl],
  );

  // 回退进度绑定在当前候选清单上：url/iconUrl 变化（如切换搜索引擎，组件实例被复用）
  // 时从第一候选重试，旧候选上的失败不会让新候选被跳过。
  const signature = candidates.join("\n");
  const [cursor, setCursor] = React.useState({ signature, index: 0 });
  const index = cursor.signature === signature ? cursor.index : 0;
  const src = candidates[index];

  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
          className,
        )}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.42,
          background: hashColor(url || title),
        }}
      >
        {initialOf(title, url)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setCursor({ signature, index: index + 1 })}
      className={cn("shrink-0 rounded-md object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
