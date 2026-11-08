import * as React from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X } from "lucide-react";
import { FadeIn } from "@/components/glass";
import {
  CategoryHeading,
  LinkTileContent,
  linkGridLayout,
  linkTileClassName,
} from "@/components/link-grid";
import { cn } from "@/lib/utils";
import type { LinkStyle, SiteCategory, SiteLink, TileSize } from "@/lib/types";

/**
 * 首页编辑模式的拖动看板（dnd-kit 原生多容器 Sortable）。
 *
 * 结构：一个 `DndContext` 罩住所有分类，每个分类一个 `SortableContext`
 * （`rectSortingStrategy`，砖是自动换行的网格）。投放目标三种：
 *  - 某块砖：落到它的下标位置（同分类换位、跨分类插入都走这条）；
 *  - 分类标题行（`end:<catId>`）：落到该分类**末尾**；
 *  - 空分类末尾的「+」砖（`cat:<catId>`）：与同档砖同高，落到唯一位置。
 *
 * 每个分类网格末尾恒有一块「+」砖（`AddLinkTile`）：点它在该分类新建链接。
 * 分类为空时这块砖就是上面那个落点（把最后一块拖走后还能拖回来）；分类非空时
 * 它不注册 droppable，不抢命中。
 *
 * 拖动中的预览顺序放在组件本地草稿里（只是拖拽期间的临时 UI 状态），松手才写 store：
 * `onDragOver` 做跨容器搬运，`onDragEnd` 再补同容器换位，然后把「目标分类 + 前驱 id」
 * 交给调用方 → `moveLinkOnHome` 乐观写 + 串行保存。store 数据一变（乐观写入 / 回滚 /
 * 删除）就按 props 重建草稿，所以保存失败会自然回到原样、不回弹。
 *
 * 触屏：`TouchSensor` 长按 250ms 才激活（普通滑动照常滚动页面），`MouseSensor`
 * 位移 6px 激活（单击不被吃掉）。拖拽覆盖层用 dnd-kit 原生 `DragOverlay`。
 *
 * 尺寸口径：砖的格子由 `linkGridLayout(linkStyle, columns, tileSize)` 给出（与普通模式
 * 同一个容器，classic 的成块列数与砖块尺寸取站点设置 `columns` / `tileSize`）；classic
 * 的砖壳是固定方砖（`size-[…]` 按三档静态类），普通模式与编辑模式完全同尺寸，名称与
 * 网址在砖内单行截断（`LinkTileContent` 的 `singleLine`）、悬停 `title` 看全称。✕ 角标
 * 定位在外层包一层上，自然落在方砖的右上角。拖拽预览用 dnd-kit 的 `DragOverlay`：包裹层
 * 尺寸由它按砖的实测矩形给定，砖规整后预览也就一致。
 *
 * 排布从「网格」改成「固定方砖 + 弹性换行 + 整块居中 + 末行左对齐」后，dnd-kit
 * 侧不需要换策略：DOM 顺序、`SortableContext` 分组与投放 id 全不变；
 * `rectSortingStrategy` 只是按实测矩形做位移预览，砖全部等尺寸反而更准；
 * `closestCorners` 也不依赖网格。
 * 空分类的落点就是那块固定尺寸的「+」砖，命中面积随方砖确定。
 */

/** 分类标题行投放目标（落到该分类末尾）的 id 前缀 */
const END_PREFIX = "end:";
/** 空分类落点（也就是那块「+」砖）投放目标的 id 前缀 */
const CAT_PREFIX = "cat:";

/**
 * 命中判定：指针落在分类标题行上时优先判为「该分类末尾」。
 *
 * 标题行只有 ~30px 高，`closestCorners` 比的是整块拖拽矩形的角距，会被紧挨着
 * 下方的第一排砖抢走（表现为「拖到标题行却插到了最前面」）。这里用 dnd-kit 自带的
 * `pointerWithin` 先做一次指针命中，只认标题行投放目标，其余情况仍走 `closestCorners`。
 */
const collisionDetection: CollisionDetection = (args) => {
  const endTarget = pointerWithin(args).find(({ id }) =>
    String(id).startsWith(END_PREFIX),
  );
  return endTarget ? [endTarget] : closestCorners(args);
};

/**
 * compact / wide 的「+」砖高度（框内只有一个图标）：与同档一块砖一致 ——
 * compact 图标 20 单行、wide 图标 36 + 一行名称 + 一行域名。classic 不列在这里：
 * 它的方砖尺寸直接由砖壳的 `size-[141.5px]` 给定，无须估算高度。
 */
const PLACEHOLDER_CLASS: Partial<Record<LinkStyle, string>> = {
  compact: "min-h-9",
  wide: "min-h-[62px]",
};

type Order = Record<string, string[]>;

function containerOf(order: Order, id: string): string | null {
  if (id.startsWith(END_PREFIX)) return id.slice(END_PREFIX.length);
  if (id.startsWith(CAT_PREFIX)) return id.slice(CAT_PREFIX.length);
  for (const [categoryId, ids] of Object.entries(order)) {
    if (ids.includes(id)) return categoryId;
  }
  return null;
}

/**
 * 把 `activeId` 挪到 `overId` 表示的位置，返回新草稿（无变化时返回原对象）。
 * 同容器：普通换位；标题行 → 末尾；跨容器：插入 over 下标（末尾目标则追加）。
 */
function relocate(prev: Order, activeId: string, overId: string): Order {
  const from = containerOf(prev, activeId);
  const to = containerOf(prev, overId);
  if (!from || !to) return prev;

  if (from === to) {
    const items = prev[from];
    if (overId.startsWith(END_PREFIX)) {
      if (items[items.length - 1] === activeId) return prev;
      return {
        ...prev,
        [from]: [...items.filter((id) => id !== activeId), activeId],
      };
    }
    if (overId.startsWith(CAT_PREFIX)) return prev;
    const oldIndex = items.indexOf(activeId);
    const newIndex = items.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev;
    return { ...prev, [from]: arrayMove(items, oldIndex, newIndex) };
  }

  const fromItems = prev[from];
  const toItems = prev[to];
  const activeIndex = fromItems.indexOf(activeId);
  if (activeIndex < 0) return prev;
  let insertAt = toItems.length;
  if (!overId.startsWith(END_PREFIX) && !overId.startsWith(CAT_PREFIX)) {
    const overIndex = toItems.indexOf(overId);
    if (overIndex >= 0) insertAt = overIndex;
  }
  return {
    ...prev,
    [from]: fromItems.filter((id) => id !== activeId),
    [to]: [...toItems.slice(0, insertAt), activeId, ...toItems.slice(insertAt)],
  };
}

/**
 * 松手结算：把拖拽草稿变成最终顺序。
 *
 * 跨容器搬运已经在 `onDragOver` 里完成 —— active 插到了落点砖**之前**，那块砖因此
 * 在草稿里顺延到 active 后面。松手时 dnd-kit 仍可能报「over = 那块被顺延的砖」；
 * 此时若再按同容器 arrayMove 一次，active 就会挪到它后面（多走一位，拖到目标分类
 * 首个砖时永远落不到首位）。因此跨容器插入后，只有松手指向的是**别的**砖才再结算。
 */
export function resolveDropOrder({
  order,
  initialOrder,
  activeId,
  overId,
}: {
  order: Order;
  initialOrder: Order;
  activeId: string;
  overId: string | null;
}): Order {
  if (!overId) return initialOrder;
  if (overId === activeId) return order;
  const currentCategory = containerOf(order, activeId);
  const initialCategory = containerOf(initialOrder, activeId);
  if (!currentCategory || !initialCategory) return order;
  if (currentCategory !== initialCategory) {
    const items = order[currentCategory];
    const activeIndex = items.indexOf(activeId);
    // 紧邻 active 之后 = 被跨容器插入顺延的那块，草稿本身已是落点
    if (activeIndex >= 0 && items.indexOf(overId) === activeIndex + 1)
      return order;
  }
  return relocate(order, activeId, overId);
}

/** 一条链接砖（编辑模式）：单击编辑、右上角删除；整块可拖。 */
function EditableTile({
  link,
  linkStyle,
  tileSize,
  onEdit,
  onRemove,
}: {
  link: SiteLink;
  linkStyle: LinkStyle;
  tileSize: TileSize;
  onEdit: (linkId: string) => void;
  onRemove: (linkId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: link.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative select-none",
        // classic 的砖壳自身就是固定方砖，外层包一层不能把它压缩
        linkStyle === "classic" && "shrink-0",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={link.title}
        title={link.title}
        className={cn(
          linkTileClassName(linkStyle, tileSize),
          // compact / wide 仍在网格里，砖壳要撑满格子（<button> 的 width:auto 会按
          // 内容收缩，不补 w-full 的话长名称的砖会比旁边的窄）；classic 固定方砖，
          // 不能补 w-full，否则宽度被容器抢走
          linkStyle !== "classic" && "w-full min-w-0",
          "cursor-grab select-none active:cursor-grabbing",
        )}
        onClick={() => onEdit(link.id)}
      >
        <LinkTileContent
          link={link}
          linkStyle={linkStyle}
          singleLine
          tileSize={tileSize}
        />
      </button>
      <button
        type="button"
        aria-label={`删除 ${link.title}`}
        title={`删除 ${link.title}`}
        // 角标独立于拖拽手柄：按下/点击都不冒泡到砖（不误触拖拽与编辑弹窗）
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(link.id);
        }}
        className="absolute -top-2 -right-2 z-10 flex size-7 items-center justify-center rounded-full border border-white/30 bg-black/60 text-white shadow-sm transition-colors hover:bg-black/80"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** 分类标题行：拖到这一行 = 落到该分类末尾。 */
function EndDropTarget({
  categoryId,
  children,
}: {
  categoryId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${END_PREFIX}${categoryId}`,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn("rounded-xl transition-colors", isOver && "bg-white/10")}
    >
      {children}
    </div>
  );
}

/** 空分类的落点 + 末尾新增入口：与同档砖同尺寸的虚线「+」砖。 */
function AddLinkTile({
  category,
  linkStyle,
  tileSize,
  empty,
  onAdd,
}: {
  category: SiteCategory;
  linkStyle: LinkStyle;
  tileSize: TileSize;
  /** 分类里还没有链接：此时它同时是该分类唯一的投放目标 */
  empty: boolean;
  onAdd: (categoryId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${CAT_PREFIX}${category.id}`,
    // 非空分类里不注册落点：否则会抢 `closestCorners` 的命中，把「拖到标题行
    // 落到末尾」变成命中这块砖（标题行只有 ~30px，本来就容易被下方砖抢走）
    disabled: !empty,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`向「${category.name}」新增链接`}
      title={`向「${category.name}」新增链接`}
      onClick={() => onAdd(category.id)}
      className={cn(
        linkTileClassName(linkStyle, tileSize),
        PLACEHOLDER_CLASS[linkStyle],
        // 同上一块砖：compact / wide 撑满格子，classic 保持固定方砖
        linkStyle !== "classic" && "w-full min-w-0",
        "items-center justify-center border border-dashed border-white/40 bg-transparent text-white/80 hover:bg-white/10 hover:text-white",
        isOver && "bg-white/10",
      )}
    >
      <Plus
        className={cn(
          "shrink-0",
          linkStyle === "compact" ? "size-4" : "size-6",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

export function HomeEditBoard({
  categories,
  linkStyle,
  columns,
  tileSize = "large",
  privateCategories,
  onEditLink,
  onRemoveLink,
  onMoveLink,
  onAddLink,
}: {
  /** 当前场景的分类（组内链接已按 sortOrder 排好，与正常模式同源） */
  categories: readonly SiteCategory[];
  linkStyle: LinkStyle;
  /** classic 成块列数（站点设置 `columns`，1–12）；缺省/0 回默认值，与普通模式同源 */
  columns?: number;
  /** classic 砖块尺寸（站点设置 `tileSize`）；缺省 large，与普通模式同源 */
  tileSize?: TileSize;
  /** 私有分类 id（显示「私有」徽标，与正常模式同口径） */
  privateCategories: ReadonlySet<string>;
  onEditLink: (linkId: string) => void;
  onRemoveLink: (linkId: string) => void;
  /** 末尾「+」砖：在该分类新建链接 */
  onAddLink: (categoryId: string) => void;
  /** 松手后保存：目标分类 + 落点前一块的 id（null = 该分类第一个位置） */
  onMoveLink: (
    linkId: string,
    categoryId: string,
    afterId: string | null,
  ) => void;
}) {
  const initialOrder = React.useMemo(() => {
    const next: Order = {};
    for (const category of categories) {
      next[category.id] = category.links.map((link) => link.id);
    }
    return next;
  }, [categories]);
  const [order, setOrder] = React.useState<Order>(initialOrder);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  // 拖动刚结束时浏览器还会补一个 click：它在下一个 tick 前不许打开编辑弹窗
  const suppressClick = React.useRef(false);

  // store 数据变化（乐观写入 / 失败回滚 / 删除 / 编辑保存）时按 props 重建草稿
  React.useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

  const linkById = React.useMemo(() => {
    const map = new Map<string, SiteLink>();
    for (const category of categories) {
      for (const link of category.links) map.set(link.id, link);
    }
    return map;
  }, [categories]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    suppressClick.current = true;
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    const from = containerOf(order, activeKey);
    const to = containerOf(order, overKey);
    // 同容器交给 dnd-kit 自己的 transform 预览，松手时再结算（避免每帧重排抖动）
    if (!from || !to || from === to) return;
    setOrder((prev) => relocate(prev, activeKey, overKey));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeKey = String(event.active.id);
    setActiveId(null);
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);

    const overKey = event.over ? String(event.over.id) : null;
    if (!overKey) {
      setOrder(initialOrder);
      return;
    }
    const final = resolveDropOrder({
      order,
      initialOrder,
      activeId: activeKey,
      overId: overKey,
    });
    const categoryId = containerOf(final, activeKey);
    const initialCategory = containerOf(initialOrder, activeKey);
    if (!categoryId || !initialCategory) return;
    const ids = final[categoryId];
    const index = ids.indexOf(activeKey);
    if (index < 0) return;
    setOrder(final);
    // 跨容器拖动在 onDragOver 里已经改过草稿：不能拿「final === order」判无变化，
    // 要和**进入拖动前的 props 顺序**比，否则「拖进别的分类再松手」会漏保存。
    const beforeIds = initialOrder[initialCategory] ?? [];
    if (
      categoryId === initialCategory &&
      index === beforeIds.indexOf(activeKey)
    )
      return;
    onMoveLink(activeKey, categoryId, index > 0 ? ids[index - 1] : null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOrder(initialOrder);
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  const handleEdit = (linkId: string) => {
    if (suppressClick.current) return;
    onEditLink(linkId);
  };

  const activeLink = activeId ? (linkById.get(activeId) ?? null) : null;
  const { className, style } = linkGridLayout(linkStyle, columns, tileSize);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <FadeIn>
        <div className="flex flex-col gap-10">
          {categories.map((category) => {
            const ids = order[category.id] ?? [];
            return (
              <section
                key={category.id}
                id={`cat-${category.id}`}
                className="scroll-mt-6"
              >
                <EndDropTarget categoryId={category.id}>
                  <CategoryHeading
                    category={category}
                    privateZone={privateCategories.has(category.id)}
                  />
                </EndDropTarget>
                <SortableContext items={ids} strategy={rectSortingStrategy}>
                  <div
                    className={className}
                    style={style}
                    data-link-grid={linkStyle}
                  >
                    {ids.map((id) => {
                      const link = linkById.get(id);
                      if (!link) return null;
                      return (
                        <EditableTile
                          key={id}
                          link={link}
                          linkStyle={linkStyle}
                          tileSize={tileSize}
                          onEdit={handleEdit}
                          onRemove={onRemoveLink}
                        />
                      );
                    })}
                    {/* 末尾恒有一个「+」砖：空分类时它就是该分类唯一的投放目标 */}
                    <AddLinkTile
                      category={category}
                      linkStyle={linkStyle}
                      tileSize={tileSize}
                      empty={ids.length === 0}
                      onAdd={onAddLink}
                    />
                  </div>
                </SortableContext>
              </section>
            );
          })}
        </div>
      </FadeIn>
      <DragOverlay>
        {activeLink ? (
          <div
            className={cn(
              linkTileClassName(linkStyle, tileSize),
              "cursor-grabbing shadow-2xl",
            )}
          >
            <LinkTileContent
              link={activeLink}
              linkStyle={linkStyle}
              singleLine
              tileSize={tileSize}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
