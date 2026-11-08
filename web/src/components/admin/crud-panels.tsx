import * as React from "react";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  SortableList,
  type SortableEntry,
} from "@/components/admin/sortable-list";
import {
  AssetThumb,
  AssetUploadField,
  deleteReplacedAsset,
  useAssetDraftCleanup,
} from "@/components/admin/asset-upload";
import {
  adminCreateCategory,
  adminDeleteCategory,
  adminUpdateCategory,
} from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import type { AdminCategory, Visibility } from "@/lib/types";

/**
 * 分类 CRUD + dnd-kit 拖拽排序（分类列表由调用方按当前场景过滤后传入）。
 *
 * 两层取与（场景公开 AND 分类公开）：所在场景为私有时，行内额外给一条有效状态
 * 提示「场景私有，对外不可见」—— 分类自身的公开/私有徽标仍按自身标记展示。
 */
export function CategoryPanel({
  categories,
  sceneId,
  sceneVisibility = "public",
  onChanged,
}: {
  /** 当前场景的分类（已按 sceneId 过滤；无场景概念时为全量） */
  categories: AdminCategory[];
  /** 新建分类的归属场景；null/未传 = 无场景概念（旧后端），不提交该字段 */
  sceneId?: string | null;
  /** 当前场景的可见性：private 时行内提示「对外不可见」；未传按公开 */
  sceneVisibility?: Visibility;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState<AdminCategory | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("public");
  const draft = useAssetDraftCleanup();

  const openCreate = () => {
    setName("");
    setIcon("");
    setVisibility("public");
    setCreating(true);
  };

  const openEdit = (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    setName(c.name);
    setIcon(c.icon ?? "");
    setVisibility(c.visibility);
    setEditing(c);
    setCreating(false);
  };

  const close = () => {
    void draft.discard();
    setEditing(null);
    setCreating(false);
  };

  const save = async () => {
    const nextName = name.trim();
    if (!nextName) {
      toast.error("分类名称不能为空");
      return;
    }
    // 同名分类前端拦一道（后端无唯一约束）：trim + 不区分大小写，编辑时排除自身
    const duplicated = categories.some(
      (c) =>
        c.id !== editing?.id &&
        c.name.trim().toLowerCase() === nextName.toLowerCase(),
    );
    if (duplicated) {
      toast.error(`分类「${nextName}」已存在，请换一个名称`);
      return;
    }
    const previousIcon = editing?.icon ?? null;
    const payload = { name: nextName, icon: icon || null, visibility };
    try {
      if (editing) {
        await adminUpdateCategory(editing.id, payload);
        toast.success("分类已更新");
      } else {
        // 分类的 sort_order 是场景内排序：新建必须显式给「当前场景末尾」。
        // 后端省略 sortOrder 会兜底 0（新分类插到场景首项之后，连建多个全堆在 0），
        // 这里用面板拿到的（已按场景过滤的）分类取最大序号 + 1。
        const nextSortOrder =
          categories.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
        // 新建分类默认归当前场景（契约：场景内排序从此刻开始）
        await adminCreateCategory({
          ...payload,
          sortOrder: nextSortOrder,
          ...(sceneId ? { sceneId } : {}),
        });
        toast.success("分类已创建");
      }
    } catch (error) {
      // 例：另一个标签页刚删掉当前场景 → 后端 400「sceneId does not exist」。
      // 失败时弹窗保持打开、错误原文透出，不能静默无反应。
      toast.error(`保存失败：${(error as Error).message}`);
      return;
    }
    draft.commit();
    // 图标清旧由前端负责（后端只对 settings 的 background/logo 自动清旧）
    await deleteReplacedAsset(previousIcon, payload.icon);
    setEditing(null);
    setCreating(false);
    onChanged();
  };

  const remove = async (id: string) => {
    await adminDeleteCategory(id);
    toast.success("分类已删除");
    onChanged();
  };

  const reorder = async (ids: string[]) => {
    // 乐观写入在 store 内同步完成（界面立刻定住），成功后不再整表重拉（见 nav-store 排序簿记）。
    // 分类的 sort_order 是场景内排序：这里提交的就是当前场景的分类全集。
    // 失败时 store 已回滚顺序并按服务端刷新，这里只负责提示。
    try {
      await useNavStore.getState().reorderCategories(ids);
    } catch {
      toast.error("排序失败，已恢复原顺序");
    }
  };

  const entries: SortableEntry[] = categories.map((c) => ({
    id: c.id,
    label: c.name,
    meta: (
      <span className="flex items-center gap-2">
        <AssetThumb src={c.icon} alt="" />
        <Badge variant={c.visibility === "private" ? "default" : "secondary"}>
          {c.visibility === "private" ? "私有" : "公开"}
        </Badge>
        {sceneVisibility === "private" && (
          <Badge variant="outline" className="gap-1">
            <EyeOff aria-hidden="true" />
            场景私有，对外不可见
          </Badge>
        )}
      </span>
    ),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">分类</h2>
        <Button onClick={openCreate}>新建分类</Button>
      </div>

      <SortableList
        entries={entries}
        onReorder={reorder}
        onEdit={openEdit}
        onRemove={remove}
        confirmRemove
        removeDescription="删除分类后无法恢复，该分类下的链接也会一并删除。"
      />

      <Dialog
        open={creating || !!editing}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑分类" : "新建分类"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cat-name">名称</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <AssetUploadField
              id="cat-icon"
              label="分类图标"
              purpose="icon"
              value={icon}
              onChange={setIcon}
              onUploaded={draft.track}
            />
            <div className="flex items-center justify-between">
              <Label htmlFor="cat-vis">私有分类</Label>
              <Switch
                id="cat-vis"
                checked={visibility === "private"}
                onCheckedChange={(v) => setVisibility(v ? "private" : "public")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
