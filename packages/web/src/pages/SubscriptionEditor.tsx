import { NODE_TYPES, type NodeSelection, type SubFormat, type SubscriptionOptions } from '@msubga/core';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, Checkbox, Field, Input, Modal, Select } from '../components/ui';
import { api, type NodeItem, type RuleProfile, type Tag } from '../lib/api';
import { delayTone } from '../lib/utils';

export interface SubscriptionDraft {
  id: string | null;
  name: string;
  format: SubFormat;
  profileId: string | null;
  selection: NodeSelection;
  options: SubscriptionOptions;
  enabled: boolean;
}

export function SubscriptionEditor({
  draft,
  profiles,
  nodes,
  tags,
  onChange,
  onClose,
  onSaved,
}: {
  draft: SubscriptionDraft;
  profiles: RuleProfile[];
  nodes: NodeItem[];
  tags: Tag[];
  onChange: (draft: SubscriptionDraft) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [keyword, setKeyword] = useState('');

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload = {
        name: draft.name,
        format: draft.format,
        profileId: draft.format === 'base64' ? null : draft.profileId,
        selection: draft.selection,
        options: draft.options,
        enabled: draft.enabled,
      };
      if (draft.id) await api.subscriptions.update(draft.id, payload);
      else await api.subscriptions.create(payload);
    },
    onSuccess: () => {
      toast.success('已保存');
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const visibleNodes = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return needle
      ? nodes.filter((node) => `${node.name} ${node.server}`.toLowerCase().includes(needle))
      : nodes;
  }, [nodes, keyword]);

  const selectedIds = draft.selection.mode === 'manual' ? draft.selection.nodeIds : [];
  const filter = draft.selection.mode === 'filter' ? draft.selection.filter : null;

  const setOptions = (changes: Partial<SubscriptionOptions>): void =>
    onChange({ ...draft, options: { ...draft.options, ...changes } });

  const toggleNode = (id: string): void => {
    if (draft.selection.mode !== 'manual') return;
    const nodeIds = selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id];
    onChange({ ...draft, selection: { mode: 'manual', nodeIds } });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      wide
      title={draft.id ? '编辑订阅' : '新建订阅'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!draft.name.trim()}
            onClick={() => save.mutate()}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="订阅名称">
            <Input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="输出格式" hint="自动判断时按客户端 UA 决定给 YAML 还是 base64">
            <Select
              value={draft.format}
              onChange={(event) => onChange({ ...draft, format: event.target.value as SubFormat })}
            >
              <option value="auto">自动判断</option>
              <option value="clash">Clash YAML</option>
              <option value="base64">Base64 链接列表</option>
            </Select>
          </Field>
          <Field
            label="规则模板"
            hint={draft.format === 'base64' ? 'base64 格式没有规则，这项不生效' : undefined}
          >
            <Select
              disabled={draft.format === 'base64'}
              value={draft.profileId ?? ''}
              onChange={(event) => onChange({ ...draft, profileId: event.target.value || null })}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-sm font-medium">包含哪些节点</h3>
            <Select
              className="w-40"
              value={draft.selection.mode}
              onChange={(event) =>
                onChange({
                  ...draft,
                  selection:
                    event.target.value === 'manual'
                      ? { mode: 'manual', nodeIds: [] }
                      : { mode: 'filter', filter: { tagMode: 'any' } },
                })
              }
            >
              <option value="manual">手动勾选</option>
              <option value="filter">按条件动态筛选</option>
            </Select>
            <span className="text-xs text-muted">
              {draft.selection.mode === 'manual'
                ? '固定这批节点，之后新导入的不会自动进来'
                : '每次被拉取时实时求值，新节点满足条件就自动进来'}
            </span>
          </div>

          {draft.selection.mode === 'manual' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  className="w-56"
                  placeholder="搜节点"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...draft,
                      selection: { mode: 'manual', nodeIds: visibleNodes.map((node) => node.id) },
                    })
                  }
                >
                  全选当前 {visibleNodes.length} 个
                </Button>
                <Button
                  size="sm"
                  onClick={() => onChange({ ...draft, selection: { mode: 'manual', nodeIds: [] } })}
                >
                  清空
                </Button>
                <span className="ml-auto text-xs text-muted">已选 {selectedIds.length} 个</span>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                {visibleNodes.map((node) => (
                  <label
                    key={node.id}
                    className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1 text-xs last:border-b-0 hover:bg-surface"
                  >
                    <Checkbox checked={selectedIds.includes(node.id)} onChange={() => toggleNode(node.id)} />
                    <span className="w-48 truncate">{node.name}</span>
                    <span className="w-16 text-muted">{node.type}</span>
                    <span className="flex-1 truncate font-mono text-muted">
                      {node.server}:{node.port}
                    </span>
                    <span className={delayTone(node.lastDelayMs, node.lastStatus)}>
                      {node.lastStatus === 'ok' ? `${node.lastDelayMs} ms` : '—'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            filter && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="名称/地址关键词">
                  <Input
                    value={filter.keyword ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        selection: { mode: 'filter', filter: { ...filter, keyword: event.target.value } },
                      })
                    }
                  />
                </Field>
                <Field label="协议">
                  <Select
                    value={filter.types?.[0] ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        selection: {
                          mode: 'filter',
                          filter: {
                            ...filter,
                            types: event.target.value ? [event.target.value as (typeof NODE_TYPES)[number]] : undefined,
                          },
                        },
                      })
                    }
                  >
                    <option value="">不限</option>
                    {NODE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="标签">
                  <Select
                    value={filter.tagIds?.[0] ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        selection: {
                          mode: 'filter',
                          filter: { ...filter, tagIds: event.target.value ? [event.target.value] : undefined },
                        },
                      })
                    }
                  >
                    <option value="">不限</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="延迟上限 (ms)" hint="没测过的节点一律不满足">
                  <Input
                    type="number"
                    value={filter.maxDelayMs ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        selection: {
                          mode: 'filter',
                          filter: {
                            ...filter,
                            maxDelayMs: event.target.value ? Number(event.target.value) : undefined,
                          },
                        },
                      })
                    }
                  />
                </Field>
              </div>
            )
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <h3 className="mb-2 text-sm font-medium">输出选项</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="节点名前缀（可选）">
              <Input
                value={draft.options.namePrefix ?? ''}
                onChange={(event) => setOptions({ namePrefix: event.target.value || undefined })}
              />
            </Field>
            <Field label="建议更新间隔（小时）" hint="写进响应头，客户端据此决定多久拉一次">
              <Input
                type="number"
                min={1}
                value={draft.options.updateIntervalHours}
                onChange={(event) => setOptions({ updateIntervalHours: Number(event.target.value) || 24 })}
              />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={draft.options.sortByDelay}
                onChange={(event) => setOptions({ sortByDelay: event.target.checked })}
              />
              按最近延迟升序排列
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={draft.options.forceUdp}
                onChange={(event) => setOptions({ forceUdp: event.target.checked })}
              />
              强制开启 UDP
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={draft.options.forceSkipCertVerify}
                onChange={(event) => setOptions({ forceSkipCertVerify: event.target.checked })}
              />
              强制跳过证书校验（自签证书才需要）
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={draft.enabled}
                onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
              />
              启用这条订阅
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}
