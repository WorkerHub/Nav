import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { Scene } from "@/lib/types";

/**
 * 场景切换胶囊（前后台共用，冻结契约 #16 §七 / nav #19 §A1–A2）。
 *
 * 只列真实场景，没有「全部」聚合项。`scenes` 由调用方按当前视角传入 ——
 * 前台未登录只有公开场景、登录全量，后台全量；组件内不做可见性判断。
 *
 * 视觉：毛玻璃胶囊行（.glass），默认 `flex-wrap`（后台内容区场景多时换行）。
 * 前台顶栏由调用方覆盖为 `flex-nowrap overflow-x-auto`：窄屏在顶栏内横向滚动，
 * 不换行、不另起一行、不做抽屉。
 *
 * 单选组由 Radix ToggleGroup（type="single"）表达：再点一次当前段 Radix 会回调空串，
 * 这里忽略空串（场景必须有一个生效值，取消选中没有意义）。
 */
export function SceneSwitcher({
  scenes,
  value,
  onValueChange,
  ariaLabel = "切换场景",
  className,
}: {
  scenes: readonly Scene[];
  /** 当前生效的场景 id */
  value: string;
  onValueChange: (value: string) => void;
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
