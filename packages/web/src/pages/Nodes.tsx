import { NODE_TYPES } from '@msubga/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Gauge, PenLine, Power, PowerOff, Tags, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Checkbox,
  Chip,
  Empty,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useLatencyStream } from '../hooks/useLatencyStream';
import { api, type NodeItem, type Tag } from '../lib/api';
import { STATUS_LABEL, cn, delayTone, formatTime } from '../lib/utils';
import { ImportDialog } from './ImportDialog';
import { RenameDialog } from './RenameDialog';
import { TagManager } from './TagManager';

type TestMethod = 'proxy' | 'tcp' | 'auto';

/** 说明直接写进选项里，省掉界面上常驻的一行解释文字 */
const METHODS: { value: TestMethod; label: string; short: string }[] = [
  { value: 'proxy', label: '内核真实延迟 · 最准', short: '内核实测' },
  { value: 'auto', label: '先粗筛再精测 · 最快', short: '粗筛+精测' },
  { value: 'tcp', label: '仅 TCP 握手 · 只测可达', short: 'TCP 握手' },
];

export function NodesPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
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
  const filtered = visible.length !== nodes.length;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['nodes'] });
  const onError = (error: Error) => toast.error(error.message);

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.nodes.update(id, { name }),
    onSuccess: invalidate,
    onError,
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api.nodes.bulkDelete(ids),
    onSuccess: () => {
      toast.success('已删除');
      setSelected(new Set());
      invalidate();
    },
    onError,
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ ids, enabled }: { ids: string[]; enabled: boolean }) => api.nodes.bulkEnabled(ids, enabled),
    onSuccess: invalidate,
    onError,
  });

  const startTest = useMutation({
    mutationFn: (ids?: string[]) => api.latency.test(ids?.length ? { nodeIds: ids, method } : { method }),
    onError,
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
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="节点池"
        count={filtered ? `${visible.length} / ${nodes.length}` : `${nodes.length} 个`}
        subtitle={isMobile ? '点名称可以改名，测速结果会实时刷新' : '双击名称即可改名，测速结果会实时刷新'}
      >
        <Select
          value={method}
          onChange={(event) => setMethod(event.target.value as TestMethod)}
          className="basis-full sm:w-auto sm:basis-auto"
        >
          {METHODS.map((item) => (
            <option key={item.value} value={item.value}>
              {isMobile ? item.short : item.label}
            </option>
          ))}
        </Select>
        <Button
          variant="primary"
          loading={progress !== null}
          disabled={nodes.length === 0}
          onClick={() => startTest.mutate(selectedIds)}
        >
          <Gauge className="size-4" />
          {progress
            ? `测速中 ${progress.done}/${progress.total}`
            : selectedIds.length
              ? `测选中 ${selectedIds.length} 个`
              : '测速'}
        </Button>
        <Button onClick={() => setTagsOpen(true)}>
          <Tags className="size-4" />
          标签
        </Button>
        <Button onClick={() => setImportOpen(true)}>
          <Download className="size-4" />
          导入
        </Button>
      </PageHeader>

      {progress && (
        <div className="h-0.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
          />
        </div>
      )}

      {nodes.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Input
            className="col-span-2 sm:w-60"
            placeholder="搜名称或地址"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Select className="sm:w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">全部协议</option>
            {NODE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
          <Select className="sm:w-auto" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">全部标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Select className="sm:w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="ok">仅存活</option>
            <option value="bad">仅失败</option>
            <option value="untested">未测过</option>
          </Select>
        </div>
      )}

      {/* 批量操作条只在选中后出现，平时不占视线 */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2">
          <span className="text-xs font-medium text-accent">已选 {selectedIds.length} 个</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="subtle" onClick={() => setRenameOpen(true)}>
              <PenLine className="size-3" />
              批量改名
            </Button>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => toggleEnabled.mutate({ ids: selectedIds, enabled: true })}
            >
              <Power className="size-3" />
              启用
            </Button>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => toggleEnabled.mutate({ ids: selectedIds, enabled: false })}
            >
              <PowerOff className="size-3" />
              停用
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (confirm(`确定删除选中的 ${selectedIds.length} 个节点？`)) bulkDelete.mutate(selectedIds);
              }}
            >
              <Trash2 className="size-3" />
              删除
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <Empty title={nodes.length === 0 ? '节点池还是空的' : '没有符合条件的节点'}>
          {nodes.length === 0 ? '点右上角「导入」，把节点链接或 host:port:user:pass 粘进来' : '换个筛选条件试试'}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {isMobile ? (
            // 6 列表格在手机上没法看，改成一节点一张卡
            <div>
              {visible.map((node, index) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  tagById={tagById}
                  checked={selected.has(node.id)}
                  first={index === 0}
                  onToggle={() => toggle(node.id)}
                  onRename={() => {
                    const next = prompt('改个名字', node.name);
                    if (next && next.trim() && next.trim() !== node.name) {
                      rename.mutate({ id: node.id, name: next.trim() });
                    }
                  }}
                  onDelete={() => {
                    if (confirm(`删除节点「${node.name}」？`)) bulkDelete.mutate([node.id]);
                  }}
                />
              ))}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="telemetry-cjk border-b border-border bg-surface/60 text-muted">
                  <th className="w-10 px-3 py-2.5">
                    <Checkbox
                      checked={allVisibleSelected}
                      title="全选当前筛选结果"
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
                  <th className="px-2 py-2.5 text-left font-normal">节点</th>
                  <th className="w-24 px-2 py-2.5 text-left font-normal">协议</th>
                  <th className="w-44 px-2 py-2.5 text-left font-normal">标签</th>
                  <th className="w-28 px-2 py-2.5 text-right font-normal">延迟</th>
                  <th className="w-16 px-2 py-2.5" />
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
          )}
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
  tagById: Map<string, Tag>;
  checked: boolean;
  editing: string | null;
  onToggle: () => void;
  onStartEdit: () => void;
  onEditChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const alive = node.lastStatus === 'ok';

  return (
    <tr
      className={cn(
        'group border-b border-border/60 transition last:border-0 hover:bg-surface',
        !node.enabled && 'opacity-45',
      )}
    >
      <td className="px-3 py-2.5 align-middle">
        <Checkbox checked={checked} onChange={onToggle} />
      </td>

      {/* 名称是主信息，放大；地址退到第二行，小字弱化 */}
      <td className="min-w-0 px-2 py-2.5 align-middle">
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
            className="h-7"
          />
        ) : (
          <>
            <button
              type="button"
              onDoubleClick={onStartEdit}
              title="双击改名"
              className="block max-w-full truncate text-left text-[0.9375rem] leading-tight hover:text-accent"
            >
              {node.name}
            </button>
            <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted">
              <span className="truncate font-mono">
                {node.server}:{node.port}
              </span>
              {!node.enabled && <span className="shrink-0">· 已停用</span>}
            </div>
          </>
        )}
      </td>

      <td className="px-2 py-2.5 align-middle">
        <Chip>{node.type}</Chip>
      </td>

      <td className="px-2 py-2.5 align-middle">
        <div className="flex flex-wrap gap-1">
          {node.tagIds.map((id) => {
            const tag = tagById.get(id);
            return tag ? (
              <Chip key={id} style={{ color: tag.color, borderColor: tag.color }}>
                {tag.name}
              </Chip>
            ) : null;
          })}
        </div>
      </td>

      {/* 延迟是这张表最该被一眼看到的数字 */}
      <td className="px-2 py-2.5 text-right align-middle">
        {node.lastStatus === null ? (
          <span className="text-xs text-muted">未测速</span>
        ) : (
          <>
            <div
              className={cn(
                'text-[0.9375rem] leading-tight tabular',
                delayTone(node.lastDelayMs, node.lastStatus),
              )}
            >
              {alive ? node.lastDelayMs : (STATUS_LABEL[node.lastStatus] ?? node.lastStatus)}
              {alive && <span className="ml-0.5 text-2xs text-muted">ms</span>}
            </div>
            <div className="mt-0.5 text-2xs text-muted">{formatTime(node.lastTestedAt)}</div>
          </>
        )}
      </td>

      {/* 删除按钮平时隐形，鼠标移到这一行才露出来 */}
      <td className="px-2 py-2.5 text-center align-middle">
        <button
          type="button"
          title="删除这个节点"
          onClick={() => {
            if (confirm(`删除节点「${node.name}」？`)) onDelete();
          }}
          className={cn(
            'hover-reveal rounded p-1 text-muted opacity-0 transition',
            'group-hover:opacity-100 hover:bg-danger/12 hover:text-danger focus-visible:opacity-100',
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}

/**
 * 手机上的节点卡片。
 * 表格那 6 列在 375px 宽度下挤成一团，这里改成两行布局：
 * 第一行是名称和延迟这两个最该被一眼看到的，第二行是地址、协议、标签这些次要信息。
 */
function NodeCard({
  node,
  tagById,
  checked,
  first,
  onToggle,
  onRename,
  onDelete,
}: {
  node: NodeItem;
  tagById: Map<string, Tag>;
  checked: boolean;
  first: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const alive = node.lastStatus === 'ok';

  return (
    <div
      className={cn(
        'flex gap-3 px-3 py-3',
        !first && 'border-t border-border/60',
        !node.enabled && 'opacity-45',
      )}
    >
      <Checkbox checked={checked} onChange={onToggle} className="mt-1 shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {/* 手机上没有双击，改成长按/点击名称弹输入框 */}
          <button
            type="button"
            onClick={onRename}
            className="min-w-0 flex-1 truncate text-left text-[0.9375rem] leading-tight"
          >
            {node.name}
          </button>

          <div className="shrink-0 text-right">
            {node.lastStatus === null ? (
              <span className="text-xs text-muted">未测速</span>
            ) : (
              <span
                className={cn(
                  'text-[0.9375rem] leading-tight tabular',
                  delayTone(node.lastDelayMs, node.lastStatus),
                )}
              >
                {alive ? node.lastDelayMs : (STATUS_LABEL[node.lastStatus] ?? node.lastStatus)}
                {alive && <span className="ml-0.5 text-2xs text-muted">ms</span>}
              </span>
            )}
          </div>
        </div>

        <div className="mt-1 truncate font-mono text-2xs text-muted">
          {node.server}:{node.port}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip>{node.type}</Chip>
          {node.tagIds.map((id) => {
            const tag = tagById.get(id);
            return tag ? (
              <Chip key={id} style={{ color: tag.color, borderColor: tag.color }}>
                {tag.name}
              </Chip>
            ) : null;
          })}
          {!node.enabled && <span className="text-2xs text-muted">已停用</span>}
          {node.lastTestedAt !== null && (
            <span className="ml-auto text-2xs text-muted">{formatTime(node.lastTestedAt)}</span>
          )}
          <button
            type="button"
            aria-label="删除这个节点"
            onClick={onDelete}
            className={cn(
              'rounded p-1.5 text-muted transition hover:bg-danger/12 hover:text-danger',
              node.lastTestedAt === null && 'ml-auto',
            )}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
