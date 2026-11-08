import { FadeIn, GlassCard } from "@/components/glass";
import { SiteIcon } from "@/components/site-icon";
import { DEFAULT_COLUMNS, resolveColumns } from "@/lib/grid-columns";
import { safeHost } from "@/lib/icons";
import type { LinkStyle, SiteCategory, SiteLink } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 链接网格（站点设置 `linkStyle` 决定呈现形态，全站统一、访客不可切）。
 *
 * 三档形状由 `resolveLinkStyle`（lib/link-style.ts）解析，缺省 classic：
 *  - classic：图标上、名称下、域名小字，列数取站点设置 `columns`（桌面列数，1–12
 *    设几是几；0/未配置用默认梯度，桌面 8 列）；
 *  - compact：小图标左、名称右（单行省略），透明无卡片底、不显示域名，桌面 5 列；
 *  - wide：玻璃底宽卡，图标左、右侧名称 + 域名两行，桌面 3 列 / 窄屏 1–2 列。
 *
 * 每一条都包一层 `FadeIn`（错峰入场，与改动前一致）；外链属性
 * `target="_blank" rel="noopener noreferrer"` 三档一致。
 *
 * 图标一律放进固定边长的「图标盒」（`LinkIcon` + `LINK_ICON_BOX`）：盒子的宽高
 * 只由档位决定、与图标文件自身的尺寸无关，图标在盒内等比缩放完整显示
 * （`object-contain`）—— 所以同一行的图标外接尺寸一致，不拉伸、不裁切。
 * 圆角（`rounded-md`）与透明底仍是图标元素自己的样式，没有额外底色或描边。
 *
 * 「显示网址」开关（站点设置 `showUrl`，缺省开）只作用于普通模式：关闭后 classic 与
 * wide 两档不再渲染网址行（compact 本就没有网址行）。首页编辑模式不传 `showUrl`，
 * 走默认 `true` —— 编辑场景要核对地址，恒显示网址。
 *
 * 首页编辑模式（home-edit-board.tsx）复用同一套「砖的外观」：`linkTileClassName`
 * 给出三档外壳类、`LinkTileContent` 给出内层 DOM（图标 / 名称 / 域名）。正常模式
 * 仍把外壳挂在 `<a>` 上、DOM 与类名保持改动前一致；编辑模式把它挂在一个撑满网格
 * 格子的 `<button>` 上（单击打开编辑弹窗，不跳转），并传 `singleLine` 让名称与网址
 * 各占一行、超长截断省略号（悬停 `title` 看全称）。
 */

/**
 * classic 档「桌面列数（站点设置 `columns`）→ 各断点列数」的全量静态阶梯。
 *
 * 口径（规格已定版）：`columns` 是**桌面端（xl）**列数，1–12 设几是几；桌面以下
 * 按固定梯度递减、保证窄屏可用 —— xl 用设定值，往下一档减 1；lg/md 不低于 3、
 * sm/base 不低于 2；同时 lg ≤10、md ≤8、sm ≤6、base ≤4；任何一档不超过上一档。
 * 第 8 行即改动前的默认梯度（手机 4 / sm 5 / md 6 / lg 7 / xl 8），`columns`
 * 未配置（0）时走这一行，所以不碰设置的用户看到的就是原来的排法。
 *
 * 必须逐行写**字面类名**：Tailwind 扫的是源码文本，`grid-cols-${n}` 这类拼接
 * 扫不到、生成的 CSS 里没有对应类名。调整档位时整行改，不要改成模板字符串。
 */
const CLASSIC_GRID_BY_COLUMNS: Record<number, string> = {
  1: "grid gap-3 grid-cols-1 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-1 xl:grid-cols-1",
  2: "grid gap-3 grid-cols-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2",
  3: "grid gap-3 grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3",
  4: "grid gap-3 grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4",
  5: "grid gap-3 grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  6: "grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
  7: "grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7",
  8: "grid gap-3 grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8",
  9: "grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-9",
  10: "grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-9 xl:grid-cols-10",
  11: "grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-11",
  12: "grid gap-3 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12",
};

/**
 * 每档的网格列数与间距（条目形状见下方各自的组件）。classic 这里给的是默认梯度
 * （`columns` 未配置时的那一行），实际列数走 `linkGridClassName`。
 */
export const LINK_GRID_CLASS: Record<LinkStyle, string> = {
  classic: CLASSIC_GRID_BY_COLUMNS[DEFAULT_COLUMNS],
  compact:
    "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  wide: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * 网格容器类名：classic 按站点设置 `columns`（桌面列数，1–12；0/未配置用默认梯度）
 * 出对应阶梯；compact / wide 不受 `columns` 影响，恒用各自排法。
 *
 * 普通模式（`LinkGrid`）与首页编辑模式（home-edit-board.tsx 的看板网格）都必须走
 * 这里 —— 两处同源，改一处两边一起生效。
 */
export function linkGridClassName(
  linkStyle: LinkStyle,
  columns?: number | null,
): string {
  if (linkStyle !== "classic") return LINK_GRID_CLASS[linkStyle];
  return CLASSIC_GRID_BY_COLUMNS[resolveColumns(columns)];
}

/**
 * 图标盒边长（px，按链接样式分档）：同一档内所有链接共用一个定值，图标盒因此
 * 全站同档同尺寸。三档的数值与改动前的图标尺寸一致（classic 44 / wide 36 /
 * compact 20），换档只换盒子大小、不改图标本身的圆角与背景。
 */
export const LINK_ICON_BOX: Record<LinkStyle, number> = {
  classic: 44,
  wide: 36,
  compact: 20,
};

/**
 * 一块链接砖的外壳类（三档形状）。正常模式挂在 `<a>`、编辑模式挂在 div 上，
 * 两处必须同源，避免「编辑模式一进去样式就变」。
 */
export function linkTileClassName(linkStyle: LinkStyle): string {
  if (linkStyle === "compact") {
    return "flex h-full items-center gap-2 rounded-xl px-2 py-2 text-start text-white/90 transition-colors hover:bg-white/10 hover:text-white";
  }
  if (linkStyle === "wide") {
    return "glass glass-hover flex h-full items-center gap-3 rounded-2xl px-4 py-3 text-start";
  }
  return "glass glass-hover group flex h-full flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center";
}

/**
 * 图标盒：固定边长的方块 + 居中，图标用 `fill` 填满盒子（等比完整显示由
 * `SiteIcon` 的 `object-contain` 负责）。盒子尺寸只来自 `LINK_ICON_BOX`，
 * 不受图标文件原始尺寸影响，因此不会因为图标大小不同把同一行撑得参差。
 */
function LinkIcon({
  link,
  linkStyle,
}: {
  link: SiteLink;
  linkStyle: LinkStyle;
}) {
  const size = LINK_ICON_BOX[linkStyle];
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
 * `singleLine`：编辑模式的砖宽高由网格给定（home-edit-board.tsx 把外壳撑满格子），
 * 名称与网址各占一行、超长截断省略号，并补 `title` 让悬停可看全称；普通模式的砖
 * 仍按改动前的排布（classic 名称最多两行），不传该 prop 即可。
 *
 * `showUrl`：普通模式的「显示网址」开关（站点设置 `showUrl`）；编辑模式不传，恒显示。
 */
export function LinkTileContent({
  link,
  linkStyle,
  singleLine = false,
  showUrl = true,
}: {
  link: SiteLink;
  linkStyle: LinkStyle;
  /** 名称单行截断 + 名称/网址补 title（编辑模式用；普通模式保持原排布） */
  singleLine?: boolean;
  /** 是否渲染网址行（站点设置 `showUrl`）；编辑模式不传，恒显示 */
  showUrl?: boolean;
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
  return (
    <>
      <LinkIcon link={link} linkStyle="classic" />
      <span
        title={titleAttr}
        className={cn(
          "w-full text-sm font-medium text-foreground/90",
          singleLine ? "truncate" : "line-clamp-2",
        )}
      >
        {link.title}
      </span>
      {showUrl && (
        <span
          title={hostAttr}
          className="w-full truncate text-xs text-muted-foreground"
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
}: {
  link: SiteLink;
  index: number;
  showUrl: boolean;
}) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkTileClassName("classic")}
      >
        <LinkTileContent link={link} linkStyle="classic" showUrl={showUrl} />
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
}: {
  links: SiteLink[];
  linkStyle?: LinkStyle;
  /** 是否渲染网址行（站点设置 `showUrl`）；缺省开 */
  showUrl?: boolean;
  /** classic 桌面列数（站点设置 `columns`，1–12）；缺省/0 用默认梯度 */
  columns?: number;
}) {
  const Tile =
    linkStyle === "compact"
      ? CompactLinkTile
      : linkStyle === "wide"
        ? WideLinkTile
        : LinkTile;

  return (
    <div className={linkGridClassName(linkStyle, columns)}>
      {links.map((link, i) => (
        <Tile key={link.id} link={link} index={i} showUrl={showUrl} />
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
}: {
  category: SiteCategory;
  privateZone?: boolean;
  linkStyle?: LinkStyle;
  /** 是否渲染网址行（站点设置 `showUrl`）；缺省开 */
  showUrl?: boolean;
  /** classic 桌面列数（站点设置 `columns`，1–12）；缺省/0 用默认梯度 */
  columns?: number;
}) {
  return (
    <section id={`cat-${category.id}`} className="scroll-mt-6">
      <CategoryHeading category={category} privateZone={privateZone} />
      <LinkGrid
        links={category.links}
        linkStyle={linkStyle}
        showUrl={showUrl}
        columns={columns}
      />
    </section>
  );
}
