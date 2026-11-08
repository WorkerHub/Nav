import { FadeIn, GlassCard } from "@/components/glass";
import { SiteIcon } from "@/components/site-icon";
import { safeHost } from "@/lib/icons";
import type { LinkStyle, SiteCategory, SiteLink } from "@/lib/types";

/**
 * 链接网格（站点设置 `linkStyle` 决定呈现形态，全站统一、访客不可切）。
 *
 * 三档形状由 `resolveLinkStyle`（lib/link-style.ts）解析，缺省 classic：
 *  - classic：图标上、名称下、域名小字，列数沿现状（桌面 7–8 列 / 手机 4 列）；
 *  - compact：小图标左、名称右（单行省略），透明无卡片底、不显示域名，桌面 5 列；
 *  - wide：玻璃底宽卡，图标左、右侧名称 + 域名两行，桌面 3 列 / 窄屏 1–2 列。
 *
 * 每一条都包一层 `FadeIn`（错峰入场，与改动前一致）；外链属性
 * `target="_blank" rel="noopener noreferrer"` 三档一致。
 *
 * 首页编辑模式（home-edit-board.tsx）复用同一套「砖的外观」：`linkTileClassName`
 * 给出三档外壳类、`LinkTileContent` 给出内层 DOM（图标 / 名称 / 域名）。正常模式
 * 仍把外壳挂在 `<a>` 上、DOM 与类名保持改动前一致；编辑模式把它挂在一个
 * `role="button"` 的 `<div>` 上（单击打开编辑弹窗，不跳转）。
 */

/** 每档的网格列数（只有列数与间距不同，条目形状见下方各自的组件）。 */
export const LINK_GRID_CLASS: Record<LinkStyle, string> = {
  classic:
    "grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8",
  compact:
    "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  wide: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
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

/** 砖的内层内容（不含外壳）：三档各自的图标尺寸、名称与域名排布。 */
export function LinkTileContent({
  link,
  linkStyle,
}: {
  link: SiteLink;
  linkStyle: LinkStyle;
}) {
  if (linkStyle === "compact") {
    return (
      <>
        <SiteIcon
          title={link.title}
          url={link.url}
          iconUrl={link.iconUrl}
          size={20}
        />
        <span className="min-w-0 flex-1 truncate text-sm">{link.title}</span>
      </>
    );
  }
  if (linkStyle === "wide") {
    return (
      <>
        <SiteIcon
          title={link.title}
          url={link.url}
          iconUrl={link.iconUrl}
          size={36}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground/90">
            {link.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {safeHost(link.url)}
          </span>
        </span>
      </>
    );
  }
  return (
    <>
      <SiteIcon
        title={link.title}
        url={link.url}
        iconUrl={link.iconUrl}
        size={44}
      />
      <span className="line-clamp-2 w-full text-sm font-medium text-foreground/90">
        {link.title}
      </span>
      <span className="w-full truncate text-xs text-muted-foreground">
        {safeHost(link.url)}
      </span>
    </>
  );
}

/** 经典：图标上、名称下、域名小字（改动前的原样） */
function LinkTile({ link, index }: { link: SiteLink; index: number }) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkTileClassName("classic")}
      >
        <LinkTileContent link={link} linkStyle="classic" />
      </a>
    </FadeIn>
  );
}

/** 紧凑：小图标左、名称右；无卡片底、不显示域名 */
function CompactLinkTile({ link, index }: { link: SiteLink; index: number }) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={link.title}
        className={linkTileClassName("compact")}
      >
        <LinkTileContent link={link} linkStyle="compact" />
      </a>
    </FadeIn>
  );
}

/** 宽卡片：玻璃底，图标左，右侧名称 + 域名两行 */
function WideLinkTile({ link, index }: { link: SiteLink; index: number }) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkTileClassName("wide")}
      >
        <LinkTileContent link={link} linkStyle="wide" />
      </a>
    </FadeIn>
  );
}

export function LinkGrid({
  links,
  linkStyle = "classic",
}: {
  links: SiteLink[];
  linkStyle?: LinkStyle;
}) {
  const Tile =
    linkStyle === "compact"
      ? CompactLinkTile
      : linkStyle === "wide"
        ? WideLinkTile
        : LinkTile;

  return (
    <div className={LINK_GRID_CLASS[linkStyle]}>
      {links.map((link, i) => (
        <Tile key={link.id} link={link} index={i} />
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
}: {
  category: SiteCategory;
  privateZone?: boolean;
  linkStyle?: LinkStyle;
}) {
  return (
    <section id={`cat-${category.id}`} className="scroll-mt-6">
      <CategoryHeading category={category} privateZone={privateZone} />
      <LinkGrid links={category.links} linkStyle={linkStyle} />
    </section>
  );
}
