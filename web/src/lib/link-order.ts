import type { AdminLink } from "@/lib/types";

/**
 * 首页编辑模式：一次拖动后重建**全局**链接顺序。
 *
 * 冻结契约（#28，docs/api-contract.md `POST /api/admin/links/move`）：
 *  - `ids` 是客户端重建后的全局顺序（链接 `sort_order` 是跨分类、跨场景的一条全局序列）；
 *  - 落点 = `linkId` 在 `ids` 里的下标，不是目标分类末尾；
 *  - 客户端应提交它可见的全部链接 id，库中不存在的忽略。
 *
 * 组内次序只由「本分类内各链接的 sortOrder 相对大小」决定，所以这里保留其它链接的
 * 相对次序，只在被拖链接的新落点处插入它：
 *  - `afterId` 非空：插到它后面（同分类拖到某个砖之下 / 跨分类落到某个砖的位置）；
 *  - `afterId` 为空：插到目标分类的**第一个**砖之前（拖到分类首位）；
 *  - 目标分类一个链接都没有：追加到全表末尾（组内唯一一项，位置不影响显示）。
 *
 * `afterId` 失效（已被删 / 属于别的分类 / 就是自己）一律按「分类首位」处理，
 * 不让一个陈旧的草稿把链接插到错误的分组里。
 */
export function buildMoveIds(
  links: readonly Pick<AdminLink, "id" | "categoryId" | "sortOrder">[],
  linkId: string,
  categoryId: string,
  afterId: string | null,
): string[] {
  const byId = new Map(links.map((link) => [link.id, link]));
  const ordered = [...links]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((link) => link.id)
    .filter((id) => id !== linkId);

  const anchor =
    afterId &&
    afterId !== linkId &&
    byId.get(afterId)?.categoryId === categoryId
      ? afterId
      : null;
  if (anchor) {
    const at = ordered.indexOf(anchor);
    if (at >= 0) {
      return [...ordered.slice(0, at + 1), linkId, ...ordered.slice(at + 1)];
    }
  }

  const firstInCategory = ordered.find(
    (id) => byId.get(id)?.categoryId === categoryId,
  );
  if (firstInCategory) {
    const at = ordered.indexOf(firstInCategory);
    return [...ordered.slice(0, at), linkId, ...ordered.slice(at)];
  }
  return [...ordered, linkId];
}
