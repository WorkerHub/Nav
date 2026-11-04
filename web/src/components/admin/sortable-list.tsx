import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * 可拖拽排序列表（dnd-kit 原生 sortable）。
 * 每行自带拖拽把手 + 「上移 / 下移」按钮（WCAG 2.2 单指/键盘替代，MASTER.md §6）。
 * 行内容只做展示，编辑 / 删除走行尾图标按钮（避免「点行即编辑」的误触）。
 */
export interface SortableEntry {
  id: string;
  label: string;
  meta?: React.ReactNode;
}

function SortableRow({
  entry,
  onMove,
  canMoveUp,
  canMoveDown,
  onEdit,
  onRemove,
}: {
  entry: SortableEntry;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entry.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-xl border bg-card px-3 py-2 ${
        isDragging ? "z-10 shadow-lg" : ""
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
        aria-label={`拖拽排序：${entry.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium">{entry.label}</span>
        {entry.meta}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={!canMoveUp}
          aria-label={`上移 ${entry.label}`}
          onClick={() => onMove(-1)}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={!canMoveDown}
          aria-label={`下移 ${entry.label}`}
          onClick={() => onMove(1)}
        >
          ↓
        </Button>
        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`编辑 ${entry.label}`}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive"
            aria-label={`删除 ${entry.label}`}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function SortableList({
  entries,
  onReorder,
  onEdit,
  onRemove,
  confirmRemove = false,
  removeDescription = "删除后无法恢复，请确认。",
}: {
  entries: SortableEntry[];
  onReorder: (ids: string[]) => void;
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** 删除前弹 AlertDialog 二次确认（破坏性删除，如分类会连带删掉其链接） */
  confirmRemove?: boolean;
  /** 二次确认弹窗的补充说明 */
  removeDescription?: string;
}) {
  const [confirmTarget, setConfirmTarget] =
    React.useState<SortableEntry | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = entries.map((e) => e.id);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= ids.length) return;
    onReorder(arrayMove(ids, index, next));
  };

  const requestRemove = (entry: SortableEntry) => {
    if (confirmRemove) {
      setConfirmTarget(entry);
      setConfirmOpen(true);
      return;
    }
    onRemove?.(entry.id);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {entries.map((entry, index) => (
            <SortableRow
              key={entry.id}
              entry={entry}
              onMove={(dir) => move(index, dir)}
              canMoveUp={index > 0}
              canMoveDown={index < entries.length - 1}
              onEdit={onEdit ? () => onEdit(entry.id) : undefined}
              onRemove={onRemove ? () => requestRemove(entry) : undefined}
            />
          ))}
        </div>
      </SortableContext>

      {confirmRemove && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                删除「{confirmTarget?.label}」？
              </AlertDialogTitle>
              <AlertDialogDescription>
                {removeDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                onClick={() => {
                  if (confirmTarget) onRemove?.(confirmTarget.id);
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </DndContext>
  );
}
