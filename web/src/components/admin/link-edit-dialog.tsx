import * as React from "react";
import { toast } from "sonner";
import {
  deleteReplacedAsset,
  useAssetDraftCleanup,
} from "@/components/admin/asset-upload";
import { IconPickerField } from "@/components/admin/icon-picker";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { adminUpdateLink, type CreateLinkInput } from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import type { AdminCategory, AdminLink, Visibility } from "@/lib/types";

/**
 * 链接编辑弹窗（后台「链接」面板与首页编辑模式共用同一份实现，不另写平行表单）。
 *
 * 口径沿用 nav #21：
 *  - 「所属分类」只列**当前场景**的分类，编辑时预选链接的实际分类；
 *  - 改分类 = 把链接搬到目标分类末尾（服务端在 categoryId 变更且未给 sortOrder 时
 *    置全局 MAX+1）；所以换分类前先 `settleLinkOrder()`，保证这次 PUT 是最后一次写；
 *  - 保存失败弹错误原文、弹窗保持打开；成功清理被替换的 R2 图标。
 *
 * `link === null` 是新建（首页编辑模式分类末尾的「+」砖）。新建交给调用方的
 * `onCreateLink`：置位/排序与读回完整 DTO 是调用方的事（契约 POST 只回 `{id}`）；
 * 两条路径成功后都走 `onSaved`，并入 store 只有一条路径。
 */
export function LinkEditDialog({
  open,
  link,
  categories,
  defaultCategoryId,
  onCreateLink,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** 编辑的链接；null = 新建 */
  link: AdminLink | null;
  /** 当前场景的分类（分类下拉只列这些） */
  categories: AdminCategory[];
  /** 新建时预选的分类（首页编辑模式选中那块「+」砖所属的分类） */
  defaultCategoryId?: string;
  /** 新建提交：落库后回传完整 DTO（排序号由调用方定，POST 只回 {id}） */
  onCreateLink: (input: CreateLinkInput) => Promise<AdminLink>;
  onClose: () => void;
  /** 保存成功：回传服务端的最新 DTO，由调用方就地并入 store */
  onSaved: (link: AdminLink) => void;
}) {
  const [form, setForm] = React.useState({
    categoryId: "",
    title: "",
    url: "",
    iconUrl: "",
    description: "",
    visibility: "public" as Visibility,
  });
  const draft = useAssetDraftCleanup();

  // 只在「打开」或「换了一条链接」时初始化表单：父组件重渲染（store 别的写入）
  // 换了对象引用也不能把用户正在输入的内容冲掉。
  const initializedKey = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      initializedKey.current = null;
      return;
    }
    const key = link?.id ?? "new";
    if (initializedKey.current === key) return;
    initializedKey.current = key;
    setForm(
      link
        ? {
            categoryId: link.categoryId,
            title: link.title,
            url: link.url,
            iconUrl: link.iconUrl ?? "",
            description: link.description ?? "",
            visibility: link.visibility,
          }
        : {
            categoryId: defaultCategoryId ?? "",
            title: "",
            url: "",
            iconUrl: "",
            description: "",
            visibility: "public",
          },
    );
  }, [open, link, defaultCategoryId]);

  const close = () => {
    void draft.discard();
    onClose();
  };

  const save = async () => {
    if (!form.categoryId) {
      toast.error("请先选择一个分类");
      return;
    }
    const previousIcon = link?.iconUrl ?? null;
    const moved = !!link && link.categoryId !== form.categoryId;
    const targetCategory = categories.find((c) => c.id === form.categoryId);
    const payload = {
      categoryId: form.categoryId,
      title: form.title,
      url: form.url,
      iconUrl: form.iconUrl || null,
      description: form.description || null,
      visibility: form.visibility,
    };
    try {
      let saved: AdminLink;
      if (link) {
        if (moved) {
          // 换分类要把「最后一次写」留给这次 PUT：先等在飞的 /links/reorder 落库，
          // 同时作废本地顺序簿记（旧顺序若在 PUT 之后落库，会把这个链接改回旧槽位，
          // 成功后还会把旧顺序写回本地、让界面继续按旧槽位排）。
          await useNavStore.getState().settleLinkOrder();
        }
        saved = await adminUpdateLink(link.id, payload);
        toast.success(
          moved && targetCategory
            ? `链接已移到「${targetCategory.name}」末尾`
            : "链接已更新",
        );
      } else {
        saved = await onCreateLink(payload);
        toast.success("链接已创建");
      }
      draft.commit();
      // 图标清旧由前端负责（后端只对 settings 的 background/logo 自动清旧）
      await deleteReplacedAsset(previousIcon, payload.iconUrl);
      onSaved(saved);
    } catch (error) {
      // 与分类/场景面板同口径：保存失败弹错误原文，弹窗保持打开
      toast.error(`保存失败：${(error as Error).message}`);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{link ? "编辑链接" : "新建链接"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="link-category">所属分类</Label>
            {/* 只列当前场景的分类（跨场景搬分类不做）；编辑时预选链接实际分类 */}
            <Select
              value={form.categoryId}
              onValueChange={(v) => setForm({ ...form, categoryId: v })}
            >
              <SelectTrigger
                id="link-category"
                aria-label="选择所属分类"
                className="w-full"
              >
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="link-title">标题</Label>
            <Input
              id="link-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          <IconPickerField
            id="link-icon"
            label="链接图标"
            value={form.iconUrl}
            onChange={(iconUrl) => setForm({ ...form, iconUrl })}
            onUploaded={draft.track}
            title={form.title}
            url={form.url}
          />
          <div className="grid gap-2">
            <Label htmlFor="link-desc">描述</Label>
            <Input
              id="link-desc"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="link-vis">私有链接</Label>
            <Switch
              id="link-vis"
              checked={form.visibility === "private"}
              onCheckedChange={(v) =>
                setForm({ ...form, visibility: v ? "private" : "public" })
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void save()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
