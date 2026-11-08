import type { CSSProperties } from "react";
import { FadeIn, GlassCard } from "@/components/glass";
import { SiteIcon } from "@/components/site-icon";
import {
  CLASSIC_TILE_SIZE_CLASS,
  classicGridMetrics,
} from "@/lib/grid-columns";
import { safeHost } from "@/lib/icons";
import type { LinkStyle, SiteCategory, SiteLink, TileSize } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 链接网格（站点设置 `linkStyle` 决定呈现形态，全站统一、访客不可切）。
 *
 * 三档形状由 `resolveLinkStyle`（lib/link-style.ts）解析，缺省 classic：
 *  - classic：图标上、名称下、域名小字；砖是固定边长的**方砖**，站点设置 `columns`
 *    （1–12）是**成块列数**：桌面按这个数成块、整块居中，窄屏放不下整块时一行
 *    自然少放几块（0/未配置回默认 8）；
 *  - compact：小图标左、名称右（单行省略），透明无卡片底、不显示域名，桌面 5 列；
 *  - wide：玻璃底宽卡，图标左、右侧名称 + 域名两行，桌面 3 列 / 窄屏 1–2 列。
 *
 * 每一条都包一层 `FadeIn`（错峰入场，与改动前一致）；外链属性
 * `target="_blank" rel="noopener noreferrer"` 三档一致。
 *
 * 图标一律放进固定边长的「图标盒」（`LinkIcon` + `LINK_ICON_BOX` / `CLASSIC_ICON_BOX`）：
 * 盒子的宽高只由档位决定、与图标文件自身的尺寸无关，图标在盒内等比缩放完整显示
 * （`object-contain`）—— 所以同一行的图标外接尺寸一致，不拉伸、不裁切。
 * 圆角（`rounded-md`）与透明底仍是图标元素自己的样式，没有额外底色或描边。
 *
 * 「显示网址」开关（站点设置 `showUrl`，缺省开）只作用于普通模式：关闭后 classic 与
 * wide 两档不再渲染网址行（compact 本就没有网址行）。首页编辑模式不传 `showUrl`，
 * 走默认 `true` —— 编辑场景要核对地址，恒显示网址。
 *
 * 首页编辑模式（home-edit-board.tsx）复用同一套「砖的外观」：`linkTileClassName`
 * 给出三档外壳类、`LinkTileContent` 给出内层 DOM（图标 / 名称 / 域名）。正常模式
 * 仍把外壳挂在 `<a>` 上、DOM 与类名保持改动前一致；编辑模式把它挂在 `<button>` 上
 * （classic 是固定方砖、compact / wide 撑满格子；单击打开编辑弹窗，不跳转），并传
 * `singleLine` 让名称与网址各占一行、超长截断省略号（悬停 `title` 看全称）。
 *
 * classic 的排布模型（规格已定版）：固定边长方砖（边长按站点设置 `tileSize`
 * 从 `CLASSIC_TILE_SIZE_CLASS` 取静态类）+ flex 换行 + **整块居中 + 末行左对齐**。
 * `columns` 是成块列数，行组的最大宽度由它与当档砖宽算出（见 lib/grid-columns.ts
 * 的 `classicGridMetrics`）；窄屏放不下整块时一行自然少放几块。砖再也不会被容器
 * 拉宽，所以列数设小时看到的是「同样的方砖、更少更松」，而不是大宽矩形。
 */

/**
 * 每档的容器类名（条目形状见下方各自的组件）。
 *
 * classic 是弹性换行容器：固定方砖、`justify-start` 让砖从左起排 —— 不满列数的
 * 末行因此落在与满行相同的列位上（上下对齐）。整块居中由 `mx-auto` + 内联
 * `max-width` 完成：满行正好填满行组宽度，`justify-start` 对满行没有影响；末行
 * 也不会为了居中而整体右移。`w-full` 给 `column-gap` 的百分比一个确定基准；间距
 * 与行组宽度来自 `linkGridLayout`（lib/grid-columns.ts 的 `classicGridMetrics`）。
 */
export const LINK_GRID_CLASS: Record<LinkStyle, string> = {
  classic: "mx-auto flex w-full flex-wrap content-start justify-start gap-y-3",
  compact:
    "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  wide: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * 网格容器的完整排布：classic 额外带内联 `maxWidth` / `columnGap`（成块列数与
 * 间距都随站点设置变，类名拼不出来），compact / wide 只有类名。
 *
 * 普通模式（`LinkGrid`）与首页编辑模式（home-edit-board.tsx 的看板网格）都必须走
 * 这里 —— 两处同源，改一处两边一起生效。
 */
export function linkGridLayout(
  linkStyle: LinkStyle,
  columns?: number | null,
  tileSize: TileSize = "large",
): { className: string; style?: CSSProperties } {
  if (linkStyle !== "classic") {
    return { className: LINK_GRID_CLASS[linkStyle] };
  }
  const { maxWidth, columnGap } = classicGridMetrics(columns, tileSize);
  return {
    className: LINK_GRID_CLASS.classic,
    style: { maxWidth, columnGap },
  };
}

/**
 * 图标盒边长（px，按链接样式分档）：同一档内所有链接共用一个定值，图标盒因此
 * 全站同档同尺寸。compact / wide 与改动前一致（36 / 20）；classic 随砖块尺寸
 * 三档变化（见 `CLASSIC_ICON_BOX`），不改图标本身的圆角与背景。
 */
export const LINK_ICON_BOX: Record<LinkStyle, number> = {
  classic: 44,
  wide: 36,
  compact: 20,
};

/** classic 图标盒三档边长（px）：large 沿用 44，medium / small 随方砖缩小。 */
export const CLASSIC_ICON_BOX: Record<TileSize, number> = {
  large: 44,
  medium: 36,
  small: 28,
};

/**
 * classic 砖内密度（按档）：gap / 内距与名称、网址的静态字号类。
 *
 * 数值按「内容能装进方砖」反推（两行名称 + 网址）：
 * large 44+8+40+8+16+24=140 ≤ 141.5；
 * medium 36+6+32+6+16+12=108 ≤ 113；
 * small 28+4+32+4+16+4=88 ≤ 92。
 * 字号类必须是字面量（Tailwind 只扫源码字面量），不能按档动态拼。
 */
const CLASSIC_TILE_DENSITY: Record<
  TileSize,
  { gap: string; padding: string; title: string; url: string }
> = {
  large: {
    gap: "gap-2",
    padding: "px-2 py-3",
    title: "text-sm",
    url: "text-xs",
  },
  medium: {
    gap: "gap-1.5",
    padding: "px-2 py-1.5",
    title: "text-[13px] leading-4",
    url: "text-xs",
  },
  small: {
    gap: "gap-1",
    padding: "px-1.5 py-0.5",
    title: "text-xs",
    url: "text-[11px] leading-4",
  },
};

/**
 * 一块链接砖的外壳类（三档形状）。正常模式挂在 `<a>`、编辑模式挂在 div 上，
 * 两处必须同源，避免「编辑模式一进去样式就变」。
 *
 * classic 的边长与内距随站点设置 `tileSize` 变；compact / wide 排法固定，
 * 忽略第二个参数。
 */
export function linkTileClassName(
  linkStyle: LinkStyle,
  tileSize: TileSize = "large",
): string {
  if (linkStyle === "compact") {
    return "flex h-full items-center gap-2 rounded-xl px-2 py-2 text-start text-white/90 transition-colors hover:bg-white/10 hover:text-white";
  }
  if (linkStyle === "wide") {
    return "glass glass-hover flex h-full items-center gap-3 rounded-2xl px-4 py-3 text-start";
  }
  const density = CLASSIC_TILE_DENSITY[tileSize];
  return cn(
    "glass glass-hover group flex shrink-0 flex-col items-center justify-center rounded-2xl text-center",
    CLASSIC_TILE_SIZE_CLASS[tileSize],
    density.gap,
    density.padding,
  );
}

/**
 * 图标盒：固定边长的方块 + 居中，图标用 `fill` 填满盒子（等比完整显示由
 * `SiteIcon` 的 `object-contain` 负责）。盒子尺寸只来自 `LINK_ICON_BOX`，
 * 不受图标文件原始尺寸影响，因此不会因为图标大小不同把同一行撑得参差。
 */
function LinkIcon({
  link,
  linkStyle,
  tileSize = "large",
}: {
  link: SiteLink;
  linkStyle: LinkStyle;
  /** classic 的砖块尺寸档；compact / wide 忽略 */
  tileSize?: TileSize;
}) {
  const size =
    linkStyle === "classic"
      ? CLASSIC_ICON_BOX[tileSize]
      : LINK_ICON_BOX[linkStyle];
  return (
    <span
      data-icon-box={linkStyle}
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <SiteIcon
        title={link.title}
        url={link.url}
        iconUrl={link.iconUrl}
        size={size}
        fill
      />
    </span>
  );
}

/**
 * 砖的内层内容（不含外壳）：三档各自的图标尺寸、名称与域名排布。
 *
 * `singleLine`：编辑模式的砖尺寸由砖壳自己给定（classic 固定方砖、compact / wide
 * 撑满格子），名称与网址各占一行、超长截断省略号，并补 `title` 让悬停可看全称；
 * 普通模式的砖仍按改动前的排布（classic 名称最多两行），不传该 prop 即可。
 *
 * `showUrl`：普通模式的「显示网址」开关（站点设置 `showUrl`）；编辑模式不传，恒显示。
 */
export function LinkTileContent({
  link,
  linkStyle,
  singleLine = false,
  showUrl = true,
  tileSize = "large",
}: {
  link: SiteLink;
  linkStyle: LinkStyle;
  /** 名称单行截断 + 名称/网址补 title（编辑模式用；普通模式保持原排布） */
  singleLine?: boolean;
  /** 是否渲染网址行（站点设置 `showUrl`）；编辑模式不传，恒显示 */
  showUrl?: boolean;
  /** classic 的砖块尺寸档（站点设置 `tileSize`）；compact / wide 忽略 */
  tileSize?: TileSize;
}) {
  const host = safeHost(link.url);
  // 只在编辑模式补 title：普通模式的 DOM 与提示行为保持改动前一致
  const titleAttr = singleLine ? link.title : undefined;
  const hostAttr = singleLine ? host : undefined;

  if (linkStyle === "compact") {
    return (
      <>
        <LinkIcon link={link} linkStyle="compact" />
        <span title={titleAttr} className="min-w-0 flex-1 truncate text-sm">
          {link.title}
        </span>
      </>
    );
  }
  if (linkStyle === "wide") {
    return (
      <>
        <LinkIcon link={link} linkStyle="wide" />
        <span className="min-w-0 flex-1">
          <span
            title={titleAttr}
            className="block truncate text-sm font-medium text-foreground/90"
          >
            {link.title}
          </span>
          {showUrl && (
            <span
              title={hostAttr}
              className="block truncate text-xs text-muted-foreground"
            >
              {host}
            </span>
          )}
        </span>
      </>
    );
  }
  const density = CLASSIC_TILE_DENSITY[tileSize];
  return (
    <>
      <LinkIcon link={link} linkStyle="classic" tileSize={tileSize} />
      <span
        title={titleAttr}
        className={cn(
          "w-full font-medium text-foreground/90",
          density.title,
          singleLine ? "truncate" : "line-clamp-2",
        )}
      >
        {link.title}
      </span>
      {showUrl && (
        <span
          title={hostAttr}
          className={cn("w-full truncate text-muted-foreground", density.url)}
        >
          {host}
        </span>
      )}
    </>
  );
}

/** 经典：图标上、名称下、域名小字（改动前的原样） */
function LinkTile({
  link,
  index,
  showUrl,
  tileSize,
}: {
  link: SiteLink;
  index: number;
  showUrl: boolean;
  tileSize: TileSize;
}) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)} className="shrink-0">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkTileClassName("classic", tileSize)}
      >
        <LinkTileContent
          link={link}
          linkStyle="classic"
          showUrl={showUrl}
          tileSize={tileSize}
        />
      </a>
    </FadeIn>
  );
}

/** 紧凑：小图标左、名称右；无卡片底、不显示域名 */
function CompactLinkTile({
  link,
  index,
  showUrl,
}: {
  link: SiteLink;
  index: number;
  showUrl: boolean;
  /** 接受但忽略：与 LinkGrid 的统一 props 对齐 */
  tileSize?: TileSize;
}) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={link.title}
        className={linkTileClassName("compact")}
      >
        <LinkTileContent link={link} linkStyle="compact" showUrl={showUrl} />
      </a>
    </FadeIn>
  );
}

/** 宽卡片：玻璃底，图标左，右侧名称 + 域名两行 */
function WideLinkTile({
  link,
  index,
  showUrl,
}: {
  link: SiteLink;
  index: number;
  showUrl: boolean;
  /** 接受但忽略：与 LinkGrid 的统一 props 对齐 */
  tileSize?: TileSize;
}) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkTileClassName("wide")}
      >
        <LinkTileContent link={link} linkStyle="wide" showUrl={showUrl} />
      </a>
    </FadeIn>
  );
}

export function LinkGrid({
  links,
  linkStyle = "classic",
  showUrl = true,
  columns,
  tileSize = "large",
}: {
  links: SiteLink[];
  linkStyle?: LinkStyle;
  /** 是否渲染网址行（站点设置 `showUrl`）；缺省开 */
  showUrl?: boolean;
  /** classic 成块列数（站点设置 `columns`，1–12）；缺省/0 回默认值 */
  columns?: number;
  /** classic 砖块尺寸（站点设置 `tileSize`）；缺省 large */
  tileSize?: TileSize;
}) {
  const Tile =
    linkStyle === "compact"
      ? CompactLinkTile
      : linkStyle === "wide"
        ? WideLinkTile
        : LinkTile;
  const { className, style } = linkGridLayout(linkStyle, columns, tileSize);

  return (
    <div className={className} style={style} data-link-grid={linkStyle}>
      {links.map((link, i) => (
        <Tile
          key={link.id}
          link={link}
          index={i}
          showUrl={showUrl}
          tileSize={tileSize}
        />
      ))}
    </div>
  );
}

/**
 * 分类标题行（普通页与首页编辑模式的拖动看板共用，编辑模式把整行作为
 * 「落到该分类末尾」的投放目标）。`privateZone` 时带「私有」徽标。
 */
export function CategoryHeading({
  category,
  privateZone = false,
}: {
  category: SiteCategory;
  privateZone?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 className="font-heading text-xl font-semibold text-white drop-shadow">
        {category.name}
      </h2>
      {privateZone && (
        <GlassCard
          hover={false}
          className="rounded-full px-2.5 py-0.5 text-xs text-white/90"
        >
          私有
        </GlassCard>
      )}
    </div>
  );
}

/**
 * 分类区块（锚点目标）；private 时带 accent 描边与「私有」徽标。
 * `scroll-mt-6`：顶栏删除后锚点偏移随之调小，跳转后分类标题贴顶可见、不被裁切。
 */
export function CategorySection({
  category,
  privateZone = false,
  linkStyle = "classic",
  showUrl = true,
  columns,
  tileSize = "large",
}: {
  category: SiteCategory;
  privateZone?: boolean;
  linkStyle?: LinkStyle;
  /** 是否渲染网址行（站点设置 `showUrl`）；缺省开 */
  showUrl?: boolean;
  /** classic 成块列数（站点设置 `columns`，1–12）；缺省/0 回默认值 */
  columns?: number;
  /** classic 砖块尺寸（站点设置 `tileSize`）；缺省 large */
  tileSize?: TileSize;
}) {
  return (
    <section id={`cat-${category.id}`} className="scroll-mt-6">
      <CategoryHeading category={category} privateZone={privateZone} />
      <LinkGrid
        links={category.links}
        linkStyle={linkStyle}
        showUrl={showUrl}
        columns={columns}
        tileSize={tileSize}
      />
    </section>
  );
}
