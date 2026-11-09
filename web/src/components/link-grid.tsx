import type { CSSProperties } from "react";
import { FadeIn, GlassCard } from "@/components/glass";
import { SiteIcon } from "@/components/site-icon";
import {
  CLASSIC_TILE_HEIGHT_CLASS,
  CLASSIC_TILE_WIDTH_CLASS,
  classicGridMetrics,
} from "@/lib/grid-columns";
import { safeHost } from "@/lib/icons";
import type { LinkStyle, SiteCategory, SiteLink, TileSize } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 链接网格（站点设置 `linkStyle` 决定呈现形态，全站统一、访客不可切）。
 *
 * 三档形状由 `resolveLinkStyle`（lib/link-style.ts）解析，缺省 classic：
 *  - classic：图标上、名称下、域名小字；砖是**正方形卡片**（边长按 `tileSize`
 *    成块、高与宽相等，见 lib/grid-columns.ts），图标盒固定占边长的 46%，名称与
 *    网址各单行截断；站点设置 `columns`（1–12）是**成块列数**：桌面按这个数成块、
 *    整块居中，窄屏放不下整块时一行自然少放几块（0/未配置回默认 8）；
 *  - compact：24px 小图标左、15px 名称右（单行省略），透明无卡片底（只在悬停时
 *    给一层 5% 白底表示可点）、不显示域名；条目固定 240px，按 #35 的成块模型
 *    排布（整块居中、末行左对齐到满行列位）；
 *  - wide：玻璃底宽卡，图标（56px、垂直居中）左、右侧名称 + 域名两行；列模板
 *    `repeat(auto-fill, minmax(min(300px, 100%), 380px))` —— 卡宽封顶 300–380px，
 *    桌面一行多张、整行居中，窄屏自然折行，卡不再把整行撑满。
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
 * 仍把外壳挂在 `<a>` 上；编辑模式把它挂在 `<button>` 上（classic 是定边长的正方形
 * 砖、compact / wide 撑满格子；单击打开编辑弹窗，不跳转）。classic 两模式都把名称与
 * 网址各渲染一行、超长截断省略号并恒给 `title`（悬停看全称）；compact / wide 仍由
 * `singleLine`（编辑模式）决定要不要补 `title`。
 *
 * compact 的排布模型（规格已定版）：条目固定 240px，容器是 **CSS 网格** ——
 * `repeat(auto-fill, 240px)` 的轨道数就是「成块列数」（floor((容宽 + gap) /
 * (240 + gap))，gap 天然算进去），`justify-center` 让整块水平居中、末行从第 1
 * 列起排。这与 classic 的 `maxWidth = columns*砖宽 + (columns-1)*gap` + `mx-auto`
 * 是同一几何结果，但 compact 的列数不来自站点设置，用 CSS 自动排即可，无需
 * 测量容器宽度（也就没有首帧闪动与 jsdom 量不到的测试难题）。
 *
 * classic 的排布模型（规格已定版）：**正方形**砖（边长按站点设置 `tileSize` 从
 * `CLASSIC_TILE_WIDTH_CLASS` 取、高度从 `CLASSIC_TILE_HEIGHT_CLASS` 取，两者数值
 * 相同、都是静态类）+ flex 换行 + **整块居中 + 末行左对齐**。
 * `columns` 是成块列数，行组的最大宽度由它与当档砖宽算出（见 lib/grid-columns.ts
 * 的 `classicGridMetrics`）；窄屏放不下整块时一行自然少放几块。砖再也不会被容器
 * 拉宽，所以列数设小时看到的是「同样的砖、更少更松」，而不是大宽矩形。
 *
 * 砖内只装「图标盒 + 名称一行 + 网址一行」：名称与网址在正方形里一律单行截断，所以
 * 砖高不会再被文字撑开；图标盒跟着缩到边长的 46%，逐档都留了正余量（测算见
 * `CLASSIC_ICON_BOX` 与 `CLASSIC_TILE_DENSITY`）。宽度仍是成块排布的唯一依据。
 */

/**
 * 每档的容器类名（条目形状见下方各自的组件）。
 *
 * classic 是弹性换行容器：固定砖、`justify-start` 让砖从左起排 —— 不满列数的
 * 末行因此落在与满行相同的列位上（上下对齐）。整块居中由 `mx-auto` + 内联
 * `max-width` 完成：满行正好填满行组宽度，`justify-start` 对满行没有影响；末行
 * 也不会为了居中而整体右移。`w-full` 给 `column-gap` 的百分比一个确定基准；间距
 * 与行组宽度来自 `linkGridLayout`（lib/grid-columns.ts 的 `classicGridMetrics`）。
 *
 * compact 是定宽轨道的网格：`repeat(auto-fill, 240px)` 先按容器宽度定下「成块
 * 列数」，`justify-center` 把整组轨道居中（满行块宽 = 列数×240 + 间隔×gap），末行
 * 因此仍从第 1 列起排、与满行同列对齐；`content-start` 让行不被拉伸。240 与
 * `gap-x-3` 都是字面量（Tailwind 只扫字面量，改任一值须同步这里），条目宽度由
 * 轨道给定，砖壳无须再写 `w-[240px]`。
 *
 * wide 用 CSS Grid 的 `auto-fill` 列模板（规格已定版）：轨道在 300–380px 之间，
 * 一行放得下几张就放几张，多出来的宽度被 `justify-center` 对称留在两侧 —— 卡不再
 * 被拉成整行宽。用 `auto-fill`（不是 `auto-fit`）：空轨道保留，末行的卡仍落在与
 * 满行相同的列位上，不会为居中整体右移。轨道下限写 `min(300px, 100%)`：容器窄于
 * 300px（如 320px 视口的内容区）时轨道跟着收缩，不会横向溢出；其余情况就等同于
 * 规格里的 `minmax(300px, 380px)`。类名是源码里的字面量（Tailwind 只扫字面量）。
 */
export const LINK_GRID_CLASS: Record<LinkStyle, string> = {
  classic: "mx-auto flex w-full flex-wrap content-start justify-start gap-y-3",
  compact:
    "grid grid-cols-[repeat(auto-fill,240px)] content-start justify-center gap-x-3 gap-y-2",
  wide: "grid gap-3 justify-center grid-cols-[repeat(auto-fill,minmax(min(300px,100%),380px))]",
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
 * classic 图标盒三档边长（px）：固定取砖边长（= 正方形边长）的 46%，三档同比例
 * （图标因此随砖等比缩放）：141.5 × 0.46 = 65.1 → 65；113 × 0.46 = 52.0 → 52；
 * 92 × 0.46 = 42.3 → 42。
 *
 * 46% 是「正方形里装得下图标 + 名称一行 + 网址一行」的上限附近：按 1px 边框×2 +
 * 上下内距×2 + 图标盒 + 2×gap + 名称行 + 网址行 算，三档余量分别为 6.5 / 3 / 4px。
 */
export const CLASSIC_ICON_BOX: Record<TileSize, number> = {
  large: 65,
  medium: 52,
  small: 42,
};

/**
 * 图标盒边长（px，按链接样式分档）：同一档内所有链接共用一个定值，图标盒因此
 * 全站同档同尺寸。compact 24（条目放大到 240px 宽后的点选口径）、wide 56（图标在
 * 宽卡里垂直居中，卡高 ≈ 56 + 上下内距 + 边框 ≈ 82px）；classic 取大档的 46%
 * 图标盒边长（逐档值见 `CLASSIC_ICON_BOX`），不改图标本身的圆角与背景。
 */
export const LINK_ICON_BOX: Record<LinkStyle, number> = {
  classic: CLASSIC_ICON_BOX.large,
  wide: 56,
  compact: 24,
};

/**
 * classic 砖内密度（按档）：gap / 内距与名称、网址的静态字号类。
 *
 * 与正方形边长配套：砖内固定三行（图标盒 + 名称一行 + 网址一行），所以内距随砖缩小
 * 同步收紧。逐档验算（1px 边框×2 + 上下内距×2 + 图标盒 + 2×gap + 名称行 + 网址行
 * ≤ 边长）：
 * large 2 + 16 + 65 + 16 + 20 + 16 = 135 ≤ 141.5（余 6.5）；
 * medium 2 + 12 + 52 + 12 + 16 + 16 = 110 ≤ 113（余 3）；
 * small 2 + 4 + 42 + 8 + 16 + 16 = 88 ≤ 92（余 4）。
 * 字号类必须是字面量（Tailwind 只扫源码字面量），不能按档动态拼。
 */
const CLASSIC_TILE_DENSITY: Record<
  TileSize,
  { gap: string; padding: string; title: string; url: string }
> = {
  large: {
    gap: "gap-2",
    padding: "px-2 py-2",
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
 * 忽略第二个参数。classic 是正方形（高 = 宽），宽度决定成块排布。
 */
export function linkTileClassName(
  linkStyle: LinkStyle,
  tileSize: TileSize = "large",
): string {
  if (linkStyle === "compact") {
    // 24px 图标 + py-2.5 上下内距 = 44px 高的点选区；悬停只给一层极淡的白底，
    // 不动文字与图标颜色（规格 3）。
    return "flex h-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-white/90 transition-colors hover:bg-white/5";
  }
  if (linkStyle === "wide") {
    return "glass glass-hover flex h-full items-center gap-3 rounded-2xl px-4 py-3 text-start";
  }
  const density = CLASSIC_TILE_DENSITY[tileSize];
  return cn(
    "glass glass-hover group flex shrink-0 flex-col items-center justify-center rounded-2xl text-center",
    CLASSIC_TILE_WIDTH_CLASS[tileSize],
    CLASSIC_TILE_HEIGHT_CLASS[tileSize],
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
 * `singleLine`：编辑模式下 compact / wide 名称与网址各占一行、超长截断省略号，
 * 并补 `title` 让悬停可看全称。classic 不受它影响：正方形只够「名称一行 + 网址
 * 一行」，两模式都单行截断且恒给 `title`。
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
  // compact / wide 只在编辑模式补 title；classic 恒给（正方形里名称与网址必然单行截断）
  const titleAttr = singleLine ? link.title : undefined;
  const hostAttr = singleLine ? host : undefined;

  if (linkStyle === "compact") {
    return (
      <>
        <LinkIcon link={link} linkStyle="compact" />
        <span
          title={titleAttr}
          className="min-w-0 flex-1 truncate text-[15px] leading-5"
        >
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
        title={link.title}
        className={cn(
          "w-full truncate font-medium text-foreground/90",
          density.title,
        )}
      >
        {link.title}
      </span>
      {showUrl && (
        <span
          title={host}
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

/** 紧凑：24px 图标左、15px 名称右（截断省略号）；无卡片底、不显示域名 */
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
