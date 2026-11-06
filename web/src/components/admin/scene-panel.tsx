import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  AssetThumb,
  AssetUploadField,
  deleteReplacedAsset,
  useAssetDraftCleanup,
} from "@/components/admin/asset-upload";
import {
  SortableList,
  type SortableEntry,
} from "@/components/admin/sortable-list";
import {
  adminCreateScene,
  adminDeleteScene,
  adminUpdateScene,
} from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import { defaultScene } from "@/lib/scene-preference";
import type { AdminScene, Visibility } from "@/lib/types";

/**
 * 场景管理（后台「场景管理」分区，冻结契约 #16 §七）。
 *
 * 与分类面板同一模式：dnd-kit SortableList 拖拽/上移下移排序，行尾图标编辑，
 * 删除二次确认；差异只有三条场景语义：
 *  - 默认场景（`isDefault`）不可删：行尾没有删除按钮、名称旁带「默认」徽标，
 *    但仍可改名/改图标/参与排序（默认场景按 `isDefault` 识别，改名不改变身份）；
 *  - 删除非默认场景不会丢数据：后端单事务把它的分类（链接随分类走）移入默认场景；
 *    确认文案里写明移入哪个场景（取默认场景当前名称）；
 *  - 场景 `sortOrder` 是全局顺序（决定前台/后台胶囊的段序），用 store 的乐观排序。
 *  - 可见性（nav #19 §B4）：与分类表单同一 pattern 的「私有场景」Switch，列表行
 *    带公开/私有徽标；默认场景必须公开（契约禁止 default → private），表单里直接
 *    禁用该开关并说明原因，不把一个必然 400 的请求发出去。
 */
export function ScenePanel({
  scenes,
  onChanged,
}: {
  scenes: AdminScene[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState<AdminScene | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("public");
  const draft = useAssetDraftCleanup();

  const fallbackScene = defaultScene(scenes);

  const openCreate = () => {
    setName("");
    setIcon("");
    setVisibility("public");
    setCreating(true);
    setEditing(null);
  };

  const openEdit = (id: string) => {
    const scene = scenes.find((item) => item.id === id);
    if (!scene) return;
    setName(scene.name);
    setIcon(scene.icon ?? "");
    setVisibility(scene.visibility === "private" ? "private" : "public");
    setEditing(scene);
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
      toast.error("场景名称不能为空");
      return;
    }
    const previousIcon = editing?.icon ?? null;
    const payload = { name: nextName, icon: icon || null, visibility };
    try {
      if (editing) {
        await adminUpdateScene(editing.id, payload);
        toast.success("场景已更新");
      } else {
        await adminCreateScene(payload);
        toast.success("场景已创建");
      }
    } catch (error) {
      // 后端校验/网络失败：弹窗保持打开，错误原文透出（与新增面板的其他表单同口径）
      toast.error(`保存失败：${(error as Error).message}`);
      return;
    }
    draft.commit();
    // 图标清旧由前端负责（与分类/链接/引擎图标同一口径）
    await deleteReplacedAsset(previousIcon, payload.icon);
    setEditing(null);
    setCreating(false);
    onChanged();
  };

  const remove = async (id: string) => {
    const target = scenes.find((item) => item.id === id);
    if (target?.isDefault) {
      // 正常路径下默认场景根本没有删除按钮：这里只是双保险
      toast.error("默认场景不能删除");
      return;
    }
    try {
      await adminDeleteScene(id);
    } catch (error) {
      toast.error(`删除失败：${(error as Error).message}`);
      return;
    }
    toast.success("场景已删除");
    onChanged();
  };

  const reorder = async (ids: string[]) => {
    // 与分类/链接/引擎同一套乐观排序：界面立刻定住，成功后不再整表重拉
    try {
      await useNavStore.getState().reorderScenes(ids);
    } catch {
      toast.error("排序失败，已恢复原顺序");
    }
  };

  const entries: SortableEntry[] = scenes.map((scene) => ({
    id: scene.id,
    label: scene.name,
    removable: !scene.isDefault,
    meta: (
      <span className="flex items-center gap-2">
        <AssetThumb src={scene.icon} alt="" />
        <Badge
          variant={scene.visibility === "private" ? "default" : "secondary"}
        >
          {scene.visibility === "private" ? "私有" : "公开"}
        </Badge>
        {scene.isDefault && <Badge variant="secondary">默认</Badge>}
      </span>
    ),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">场景</h2>
        <Button onClick={openCreate}>新建场景</Button>
      </div>

      {scenes.length > 0 ? (
        <SortableList
          entries={entries}
          onReorder={reorder}
          onEdit={openEdit}
          onRemove={remove}
          confirmRemove
          removeDescription={`删除场景后无法恢复，其分类与链接会移入「${fallbackScene?.name ?? "默认场景"}」。`}
        />
      ) : (
        <p className="text-sm text-muted-foreground">暂无场景。</p>
      )}

      <Dialog
        open={creating || !!editing}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑场景" : "新建场景"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="scene-name">名称</Label>
              <Input
                id="scene-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <AssetUploadField
              id="scene-icon"
              label="场景图标"
              purpose="icon"
              value={icon}
              onChange={setIcon}
              onUploaded={draft.track}
            />
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-1">
                <Label htmlFor="scene-vis">私有场景</Label>
                {editing?.isDefault && (
                  <p className="text-xs text-muted-foreground">
                    默认场景必须公开，不能设为私有。
                  </p>
                )}
              </div>
              <Switch
                id="scene-vis"
                checked={visibility === "private"}
                disabled={editing?.isDefault ?? false}
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
