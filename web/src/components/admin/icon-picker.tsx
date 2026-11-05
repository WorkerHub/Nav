import * as React from "react";
import { Library } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AssetUploadField } from "@/components/admin/asset-upload";
import {
  loadIconIndex,
  searchIcons,
  type IconIndexEntry,
  type IconSource,
} from "@/lib/icon-search";

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 50;

const SOURCE_LABEL: Record<IconSource, string> = {
  dashboard: "Dashboard",
  selfhst: "selfh.st",
  simple: "Simple",
};

/** 初始查询词：标题非空用标题，否则由 URL 主机名首标签推导（github.com → github）。 */
function initialQuery(title: string, url: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  try {
    // 裸主机名（无 scheme）如 github.com 会令 new URL 抛错，补 https:// 兜底。
    const host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`,
    ).hostname.replace(/^www\./, "");
    return host.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

/** 输入防抖：值变化 delayMs 后才更新（用于候选搜索）。 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * 链接图标选择器：在现有上传/URL 输入控件之上加「从图标库选择」入口。
 * 只对链接图标使用（分类/搜索引擎图标仍用 AssetUploadField）。
 * 选中结果只写一个 CDN URL 进 icon_url，保存时不会静默改写。
 */
export function IconPickerField({
  id,
  label,
  value,
  onChange,
  onUploaded,
  title,
  url,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onUploaded?: (path: string) => void;
  title: string;
  url: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState<IconIndexEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const results = React.useMemo(
    () => (index ? searchIcons(index, debouncedQuery, RESULT_LIMIT) : []),
    [index, debouncedQuery],
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery(initialQuery(title, url));
      if (!index) {
        loadIconIndex()
          .then(setIndex)
          .catch((err) => setError((err as Error).message));
      }
    }
  };

  return (
    <div className="grid gap-2">
      <AssetUploadField
        id={id}
        label={label}
        purpose="icon"
        value={value}
        onChange={onChange}
        onUploaded={onUploaded}
        hint="支持 PNG / JPEG / WebP / GIF / SVG / ICO，≤ 1MB；留空则自动抓 favicon"
      />
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-fit">
            <Library aria-hidden="true" />
            从图标库选择
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command shouldFilter={false} label="搜索图标">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="搜索图标名称…"
            />
            <CommandList>
              <CommandEmpty>
                {error
                  ? `索引加载失败：${error}`
                  : index
                    ? "没有匹配的图标"
                    : "加载中…"}
              </CommandEmpty>
              {results.map((entry) => (
                <CommandItem
                  key={`${entry.source}:${entry.slug}`}
                  value={`${entry.source}:${entry.slug}`}
                  onSelect={() => {
                    onChange(entry.url);
                    setOpen(false);
                  }}
                >
                  <img
                    src={entry.url}
                    alt=""
                    loading="lazy"
                    className="size-5 shrink-0 object-contain"
                  />
                  <span className="truncate">{entry.name}</span>
                  <Badge variant="secondary" className="ml-auto shrink-0">
                    {SOURCE_LABEL[entry.source]}
                  </Badge>
                  {entry.format === "svg" ? (
                    <Badge variant="outline" className="shrink-0">
                      SVG
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
