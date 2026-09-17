import { NODE_TYPES } from '@msubga/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Gauge, PenLine, Tags, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Checkbox, Empty, Input, Select, Spinner } from '../components/ui';
import { useLatencyStream } from '../hooks/useLatencyStream';
import { api, type NodeItem } from '../lib/api';
import { STATUS_LABEL, cn, delayTone, formatTime } from '../lib/utils';
import { ImportDialog } from './ImportDialog';
import { RenameDialog } from './RenameDialog';
import { TagManager } from './TagManager';

type TestMethod = 'proxy' | 'tcp' | 'auto';

const METHOD_HINT: Record<TestMethod, string> = {
  proxy: '走内核实际连一次，能测出节点是否真的可用',
  auto: '先 TCP 粗筛掉不可达的，再对活着的走内核，省时间',
  tcp: '只做 TCP 握手，快但只能说明服务器可达',
};

export function NodesPage() {
  const queryClient = useQueryClient();
  const { progress } = useLatencyStream();

  const { data, isLoading } = useQuery({ queryKey: ['nodes'], queryFn: api.nodes.list });
  const { data: tagData } = useQuery({ queryKey: ['tags'], queryFn: api.tags.list });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [method, setMethod] = useState<TestMethod>('proxy');
  const [importOpen, setImportOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const nodes = data?.nodes ?? [];
  const tags = tagData?.tags ?? [];
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const visible = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return nodes.filter((node) => {
      if (needle && !`${node.name} ${node.server}`.toLowerCase().includes(needle)) return false;
      if (typeFilter && node.type !== typeFilter) return false;
      if (tagFilter && !node.tagIds.includes(tagFilter)) return false;
      if (statusFilter === 'ok' && node.lastStatus !== 'ok') return false;
      if (statusFilter === 'bad' && (node.lastStatus === 'ok' || node.lastStatus === null)) return false;
      if (statusFilter === 'untested' && node.lastStatus !== null) return false;
      return true;
    });
  }, [nodes, keyword, typeFilter, tagFilter, statusFilter]);

  const selectedIds = [...selected].filter((id) => nodes.some((node) => node.id === id));
  const allVisibleSelected = visible.length > 0 && visible.every((node) => selected.has(node.id));

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['nodes'] });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.nodes.update(id, { name }),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api.nodes.bulkDelete(ids),
    onSuccess: () => {
      toast.success('已删除');
      setSelected(new Set());
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ ids, enabled }: { ids: string[]; enabled: boolean }) => api.nodes.bulkEnabled(ids, enabled),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const startTest = useMutation({
    mutationFn: (ids?: string[]) => api.latency.test(ids?.length ? { nodeIds: ids, method } : { method }),
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const commitRename = () => {
    if (!editing) return;
    const node = nodes.find((item) => item.id === editing.id);
    const value = editing.value.trim();
    if (node && value && value !== node.name) rename.mutate({ id: editing.id, name: value });
    setEditing(null);
  };

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-3 p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-base font-semibold">
          节点池
          <span className="ml-2 text-xs font-normal text-muted">
            共 {nodes.length} 个{visible.length !== nodes.length ? `，筛出 ${visible.length} 个` : ''}
          </span>
        </h1>

        <Select
          value={method}
          onChange={(e) => setMethod(e.target.value as TestMethod)}
          title={METHOD_HINT[method]}
          className="w-36"
        >
          <option value="proxy">内核真实延迟</option>
          <option value="auto">先粗筛再精测</option>
          <option value="tcp">仅 TCP 握手</option>
        </Select>
        <Button
          variant="primary"
          loading={progress !== null}
          disabled={nodes.length === 0}
          onClick={() => startTest.mutate(selectedIds)}
        >
          <Gauge className="h-3.5 w-3.5" />
          {progress ? `${progress.done}/${progress.total}` : selectedIds.length ? `测选中 ${selectedIds.length} 个` : '测全部'}
        </Button>
        <Button onClick={() => setTagsOpen(true)}>
          <Tags className="h-3.5 w-3.5" />
          标签
        </Button>
        <Button onClick={() => setImportOpen(true)}>
          <Download className="h-3.5 w-3.5" />
          导入
        </Button>
      </header>

      <p className="text-xs text-muted">{METHOD_HINT[method]}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-56"
          placeholder="搜名称或地址"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Select className="w-28" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">全部协议</option>
          {NODE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Select className="w-32" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">全部标签</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </Select>
        <Select className="w-28" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="ok">仅存活</option>
          <option value="bad">仅失败</option>
          <option value="untested">未测过</option>
        </Select>

        {selectedIds.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted">选中 {selectedIds.length} 个</span>
            <Button size="sm" onClick={() => setRenameOpen(true)}>
              <PenLine className="h-3.5 w-3.5" />
              批量改名
            </Button>
            <Button size="sm" onClick={() => toggleEnabled.mutate({ ids: selectedIds, enabled: true })}>
              启用
            </Button>
            <Button size="sm" onClick={() => toggleEnabled.mutate({ ids: selectedIds, enabled: false })}>
              停用
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (confirm(`确定删除选中的 ${selectedIds.length} 个节点？`)) bulkDelete.mutate(selectedIds);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <Empty>{nodes.length === 0 ? '还没有节点，点右上角「导入」粘一批进来' : '没有符合条件的节点'}</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="w-10 px-2 py-2">
                  <Checkbox
                    checked={allVisibleSelected}
                    onChange={(event) =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        for (const node of visible) {
                          if (event.target.checked) next.add(node.id);
                          else next.delete(node.id);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th className="px-2 py-2 text-left">名称</th>
                <th className="w-24 px-2 py-2 text-left">协议</th>
                <th className="px-2 py-2 text-left">地址</th>
                <th className="w-40 px-2 py-2 text-left">标签</th>
                <th className="w-28 px-2 py-2 text-right">延迟</th>
                <th className="w-28 px-2 py-2 text-left">测于</th>
                <th className="w-12 px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  tagById={tagById}
                  checked={selected.has(node.id)}
                  editing={editing?.id === node.id ? editing.value : null}
                  onToggle={() => toggle(node.id)}
                  onStartEdit={() => setEditing({ id: node.id, value: node.name })}
                  onEditChange={(value) => setEditing({ id: node.id, value })}
                  onCommitEdit={commitRename}
                  onCancelEdit={() => setEditing(null)}
                  onDelete={() => bulkDelete.mutate([node.id])}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} tags={tags} />
      <TagManager open={tagsOpen} onOpenChange={setTagsOpen} tags={tags} selectedNodeIds={selectedIds} />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        nodes={nodes.filter((node) => selected.has(node.id))}
      />
    </div>
  );
}

function NodeRow({
  node,
  tagById,
  checked,
  editing,
  onToggle,
  onStartEdit,
  onEditChange,
  onCommitEdit,
  onCancelEdit,
  onDelete,
}: {
  node: NodeItem;
  tagById: Map<string, { name: string; color: string }>;
  checked: boolean;
  editing: string | null;
  onToggle: () => void;
  onStartEdit: () => void;
  onEditChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr className={cn('border-t border-border hover:bg-surface/60', !node.enabled && 'opacity-45')}>
      <td className="px-2 py-1.5 text-center">
        <Checkbox checked={checked} onChange={onToggle} />
      </td>
      <td className="px-2 py-1.5">
        {editing !== null ? (
          <Input
            autoFocus
            value={editing}
            onChange={(event) => onEditChange(event.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCommitEdit();
              if (event.key === 'Escape') onCancelEdit();
            }}
            className="h-6 py-0"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={onStartEdit}
            title="双击改名"
            className="max-w-[22rem] truncate text-left hover:text-accent"
          >
            {node.name}
            {!node.enabled && <span className="ml-1.5 text-[11px] text-muted">已停用</span>}
          </button>
        )}
      </td>
      <td className="px-2 py-1.5">
        <Badge className="bg-surface-2 text-muted">{node.type}</Badge>
      </td>
      <td className="px-2 py-1.5 font-mono text-xs text-muted">
        {node.server}:{node.port}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {node.tagIds.map((id) => {
            const tag = tagById.get(id);
            return tag ? (
              <Badge key={id} style={{ color: tag.color, borderColor: tag.color }} className="border">
                {tag.name}
              </Badge>
            ) : null;
          })}
        </div>
      </td>
      <td className={cn('px-2 py-1.5 text-right font-mono', delayTone(node.lastDelayMs, node.lastStatus))}>
        {node.lastStatus === null
          ? '—'
          : node.lastStatus === 'ok'
            ? `${node.lastDelayMs} ms`
            : (STATUS_LABEL[node.lastStatus] ?? node.lastStatus)}
      </td>
      <td className="px-2 py-1.5 text-xs text-muted">{formatTime(node.lastTestedAt)}</td>
      <td className="px-2 py-1.5 text-center">
        <button
          type="button"
          title="删除"
          onClick={() => {
            if (confirm(`删除节点「${node.name}」？`)) onDelete();
          }}
          className="text-muted transition hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}
