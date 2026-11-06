import * as React from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass";
import { SiteIcon } from "@/components/site-icon";
import type { SearchEngine } from "@/lib/types";

/**
 * 顶部多引擎搜索框：引擎切换（下拉）、`/` 键全局聚焦、Enter 按 {q} 模板跳转。
 *
 * `openInNewTab`（站点设置 `searchNewTab`，默认开）：开时结果在新标签页打开，
 * 起始页与会话保留；关时在当前页跳转。两种方式对所有引擎（含自定义）一致生效。
 * 两条路径都不向搜索站发送 Referer（见 `navigateSameTabWithoutReferrer`）。
 */

/**
 * 当前页跳转且不带 Referer：用临时锚点（`rel="noreferrer"`）点击完成导航。
 *
 * `window.location.href` 无法抑制来源，跨站跳转时浏览器按默认策略（
 * strict-origin-when-cross-origin）会把本页 origin 作为 Referer 一起发出去。
 * 锚点的 `rel="noreferrer"` 只作用于这一次导航（强制 no-referrer），因此不动
 * 页面级 `<meta name="referrer">`，其它外跳与资源加载的 Referer 行为一律不变。
 */
export function navigateSameTabWithoutReferrer(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noreferrer";
  anchor.target = "_self";
  document.body.append(anchor);
  anchor.click();
  // 锚点是临时的：点击已触发导航，随即从 DOM 撤掉（不留空节点、不改布局）
  anchor.remove();
}

export function SearchBar({
  engines,
  openInNewTab = true,
}: {
  engines: SearchEngine[];
  openInNewTab?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [engineId, setEngineId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const engine =
    engines.find((e) => e.id === engineId) ??
    engines.find((e) => e.isDefault) ??
    engines[0];

  // 全局 `/` 聚焦搜索框（不在输入框内时）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !engine) return;
    const url = engine.urlTemplate.replace("{q}", encodeURIComponent(q));
    if (openInNewTab) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    navigateSameTabWithoutReferrer(url);
  };

  return (
    // hover={false}：这张卡片不带上浮位移。Radix DropdownMenu 打开时给 body 设
    // pointer-events:none，卡片 :hover 丢失，translateY(-1px) 来回过渡 —— 表现为
    // 切换引擎时搜索框上下晃动。其余卡片的 .glass-hover 全局行为不受影响。
    <GlassCard
      hover={false}
      className="mx-auto flex w-full max-w-2xl items-center gap-2 p-2"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-11 shrink-0 gap-1.5 px-2.5 text-foreground/90"
            aria-label={`当前搜索引擎：${engine?.name ?? "未配置"}，点击切换`}
          >
            {engine ? (
              <SiteIcon
                title={engine.name}
                url={engine.urlTemplate.replace("{q}", "")}
                size={20}
              />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span className="max-w-24 truncate text-sm">{engine?.name}</span>
            <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {engines.map((e) => (
            <DropdownMenuItem
              key={e.id}
              onSelect={() => setEngineId(e.id)}
              className="gap-2"
            >
              <SiteIcon
                title={e.name}
                url={e.urlTemplate.replace("{q}", "")}
                size={18}
              />
              <span className="truncate">{e.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <form onSubmit={submit} className="flex flex-1 items-center gap-2">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 border-transparent bg-transparent text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="搜索关键词"
          autoComplete="off"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11"
          aria-label="搜索"
        >
          <Search className="size-5" aria-hidden="true" />
        </Button>
      </form>
    </GlassCard>
  );
}
