import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { hashColor, initialOf } from "@/lib/icons";
import type { Scene } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 场景切换（前后台共用，冻结契约 #16 §七 / nav #19 §A1–A2）。
 *
 * 只列真实场景，没有「全部」聚合项。`scenes` 由调用方按当前视角传入 ——
 * 前台未登录只有公开场景、登录全量，后台全量；组件内不做可见性判断。
 *
 * 两种外观：
 *  - 缺省：毛玻璃胶囊行（.glass），每段显示场景名，默认 `flex-wrap`（后台内容区换行）。
 *  - `iconOnly`：前台右下角坞用的图标轨道 —— 每段只显场景图标；没设图标（或图标
 *    加载失败）时回退「首字圆」（场景名首字 + 哈希底色，与 SiteIcon 同一套回退口径）。
 *    名称走 `title`/`aria-label`，悬停与读屏都能辨认。图标态不再包外层玻璃卡，
 *    选中态由每一段的 `glass-scene-trigger` 自己表达。
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
  itemClassName,
  iconOnly = false,
}: {
  scenes: readonly Scene[];
  /** 当前生效的场景 id */
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  /** 追加到每一段上的类（坞里用 `size-11 rounded-full p-0` 竖排图标） */
  itemClassName?: string;
  /** 只显图标（无图标场景回退首字圆），不显场景名 */
  iconOnly?: boolean;
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
      className={cn(
        "flex-wrap gap-1",
        // 图标态不要外层玻璃卡：每个场景按钮自己承担选中态（底色/描边）
        iconOnly ? "flex-col flex-nowrap" : "glass rounded-2xl p-1.5",
        className,
      )}
    >
      {scenes.map((scene) => (
        <ToggleGroupItem
          key={scene.id}
          value={scene.id}
          // 图标态没有可见文字：功能名走 title / aria-label（悬停与读屏可辨）
          aria-label={iconOnly ? scene.name : undefined}
          title={iconOnly ? scene.name : undefined}
          className={cn(
            "glass-scene-trigger rounded-full px-3 text-foreground/70",
            iconOnly && "p-0",
            itemClassName,
          )}
        >
          {iconOnly ? (
            <SceneAvatar scene={scene} />
          ) : (
            // 名称过长时截断（后台不设宽度约束，视觉与改动前一致）
            <span className="truncate">{scene.name}</span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * 场景图标（坞里的图标按钮内容）：设了图标就用图片，没设或加载失败回退首字圆。
 * 首字圆复用站点图标的现成口径（`hashColor` 稳定着色 + `initialOf` 取首字），
 * 不引入新的配色或绘制逻辑。
 */
function SceneAvatar({ scene }: { scene: Scene }) {
  const icon = scene.icon;
  // 记录加载失败的地址：换上新地址（后台改了图标）后自动重试
  const [brokenIcon, setBrokenIcon] = React.useState<string | null>(null);

  if (icon && brokenIcon !== icon) {
    return (
      <img
        // src 变化时换元素：被中止的旧请求的 error 不会落到新地址头上
        key={icon}
        src={icon}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        decoding="async"
        onError={() => setBrokenIcon(icon)}
        className="size-7 shrink-0 rounded-full object-contain"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex size-7 shrink-0 select-none items-center justify-center rounded-full text-sm font-semibold leading-none text-white"
      style={{ background: hashColor(scene.id || scene.name) }}
    >
      {initialOf(scene.name, scene.id)}
    </span>
  );
}
