import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Empty, Input, Modal } from '../components/ui';
import { api, type Tag } from '../lib/api';

const PALETTE = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185', '#64748b'];

export function TagManager({
  open,
  onOpenChange,
  tags,
  selectedNodeIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: Tag[];
  selectedNodeIds: string[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]!);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: ['nodes'] });
  };

  const create = useMutation({
    mutationFn: () => api.tags.create(name.trim(), color),
    onSuccess: () => {
      setName('');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.tags.remove(id),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const apply = useMutation({
    mutationFn: ({ tagId, add }: { tagId: string; add: boolean }) =>
      api.nodes.bulkTags(selectedNodeIds, add ? [tagId] : [], add ? [] : [tagId]),
    onSuccess: (_result, variables) => {
      toast.success(variables.add ? '已打标签' : '已移除标签');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="标签"
      description={
        selectedNodeIds.length > 0
          ? `当前选中 ${selectedNodeIds.length} 个节点，点标签右侧按钮可批量打或移除`
          : '在节点池里勾选节点后再打开，可以批量打标签'
      }
    >
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input placeholder="新标签名" value={name} onChange={(event) => setName(event.target.value)} />
          <div className="flex shrink-0 items-center gap-1">
            {PALETTE.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setColor(item)}
                style={{ background: item }}
                className={`h-5 w-5 rounded-full transition ${color === item ? 'ring-2 ring-fg' : 'opacity-60'}`}
              />
            ))}
          </div>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
            新建
          </Button>
        </form>

        {tags.length === 0 ? (
          <Empty title="还没有标签">标签用来给节点分组，订阅可以按标签动态筛选</Empty>
        ) : (
          <ul className="space-y-1">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
                <span className="flex-1 text-sm">{tag.name}</span>
                {selectedNodeIds.length > 0 && (
                  <>
                    <Button size="sm" onClick={() => apply.mutate({ tagId: tag.id, add: true })}>
                      打上
                    </Button>
                    <Button size="sm" onClick={() => apply.mutate({ tagId: tag.id, add: false })}>
                      移除
                    </Button>
                  </>
                )}
                <button
                  type="button"
                  title="删除标签"
                  onClick={() => {
                    if (confirm(`删除标签「${tag.name}」？节点本身不会被删除。`)) remove.mutate(tag.id);
                  }}
                  className="text-muted transition hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
