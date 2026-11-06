import { LayoutGrid } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ALL_SCENES } from "@/lib/scene-preference";
import { cn } from "@/lib/utils";
import type { Scene } from "@/lib/types";

/**
 * 场景切换胶囊（前后台共用，冻结契约 #16 §七）。
 *
 * 段序：
 *  - 前台 `includeAll`：第一段「全部」（Lucide LayoutGrid + 名称），其后按 DTO 顺序
 *    列出全部场景（默认场景「通用」是普通成员，同等成段、不特判）。
 *  - 后台不带「全部」：只有各场景，永远停在某个具体场景（新建分类/链接的归属场景）。
 *
 * 视觉：毛玻璃胶囊行（.glass）+ `flex-wrap`，窄屏/场景多时换行不横向溢出；
 * 选中态复用 .glass 的同一套 token（index.css 的 .glass-scene-trigger）。
 *
 * 单选组由 Radix ToggleGroup（type="single"）表达：再点一次当前段 Radix 会回调空串，
 * 这里忽略空串（场景必须有一个生效值，取消选中没有意义）。
 */
export function SceneSwitcher({
  scenes,
  value,
  onValueChange,
  includeAll = false,
  ariaLabel = "切换场景",
  className,
}: {
  scenes: readonly Scene[];
  /** 当前生效值：`"all"`（仅前台）或场景 id */
  value: string;
  onValueChange: (value: string) => void;
  /** 前台为 true（第一段「全部」）；后台为 false（只有场景） */
  includeAll?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        // Radix 单选组点当前项会回调空串（取消选中）：忽略，保持当前场景
        if (!next) return;
        onValueChange(next);
      }}
      aria-label={ariaLabel}
      className={cn("glass flex-wrap gap-1 rounded-2xl p-1.5", className)}
    >
      {includeAll && (
        <ToggleGroupItem
          value={ALL_SCENES}
          className="glass-scene-trigger gap-1.5 rounded-full px-3 text-foreground/70"
        >
          <LayoutGrid aria-hidden="true" />
          全部
        </ToggleGroupItem>
      )}
      {scenes.map((scene) => (
        // 场景段只显名称：图标属于后台管理信息，不挤进前台胶囊
        <ToggleGroupItem
          key={scene.id}
          value={scene.id}
          className="glass-scene-trigger rounded-full px-3 text-foreground/70"
        >
          {scene.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
