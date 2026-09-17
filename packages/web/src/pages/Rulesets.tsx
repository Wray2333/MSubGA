import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Empty, Field, Input, Modal, Select, Spinner } from '../components/ui';
import { api, type Ruleset } from '../lib/api';

type Draft = Partial<Ruleset> & { name: string; kind: 'remote' | 'inline' };

const EMPTY: Draft = {
  name: '',
  description: '',
  kind: 'inline',
  behavior: 'classical',
  format: 'text',
  url: '',
  content: 'DOMAIN-SUFFIX,example.com\nDOMAIN-KEYWORD,example',
};

const BEHAVIOR_HINT: Record<string, string> = {
  classical: '每行是完整规则前半段，如 DOMAIN-SUFFIX,example.com',
  domain: '每行一个域名，+. 或 . 开头视为后缀匹配',
  ipcidr: '每行一个 CIDR，生成时会自动加 no-resolve',
};

export function RulesetsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['rulesets'], queryFn: api.rulesets.list });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['rulesets'] });

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload = {
        ...draft,
        description: draft?.description || null,
        url: draft?.kind === 'remote' ? draft.url : null,
        content: draft?.kind === 'inline' ? draft.content : null,
      } as Partial<Ruleset>;
      if (editingId) await api.rulesets.update(editingId, payload);
      else await api.rulesets.create(payload);
    },
    onSuccess: () => {
      toast.success('已保存');
      setDraft(null);
      setEditingId(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.rulesets.remove(id),
    onSuccess: () => {
      toast.success('已删除');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.rulesets.duplicate(id),
    onSuccess: ({ ruleset }) => {
      toast.success('已复制一份可编辑的副本');
      refresh();
      setEditingId(ruleset.id);
      setDraft(ruleset as Draft);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <Spinner />;
  const rulesets = data?.rulesets ?? [];

  return (
    <div className="space-y-3 p-5">
      <header className="flex items-center gap-2">
        <h1 className="mr-auto text-base font-semibold">
          规则集
          <span className="ml-2 text-xs font-normal text-muted">
            远程规则集会写成 rule-provider；内联规则集在生成时直接展开成规则行
          </span>
        </h1>
        <Button
          variant="primary"
          onClick={() => {
            setEditingId(null);
            setDraft({ ...EMPTY });
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </Button>
      </header>

      {rulesets.length === 0 ? (
        <Empty>还没有规则集</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left">名称</th>
                <th className="w-20 px-2 py-2 text-left">来源</th>
                <th className="w-24 px-2 py-2 text-left">行为</th>
                <th className="px-2 py-2 text-left">地址 / 内容</th>
                <th className="w-32 px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rulesets.map((ruleset) => (
                <tr key={ruleset.id} className="border-t border-border hover:bg-surface/60">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {ruleset.builtin && <Lock className="h-3 w-3 shrink-0 text-muted" />}
                      <span>{ruleset.name}</span>
                    </div>
                    {ruleset.description && (
                      <div className="text-xs text-muted">{ruleset.description}</div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Badge className="bg-surface-2 text-muted">
                      {ruleset.kind === 'remote' ? '远程' : '内联'}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted">
                    {ruleset.behavior} / {ruleset.format}
                  </td>
                  <td className="max-w-0 truncate px-2 py-2 font-mono text-xs text-muted">
                    {ruleset.kind === 'remote'
                      ? ruleset.url
                      : `${(ruleset.content ?? '').split('\n').length} 行`}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      {ruleset.builtin ? (
                        <Button size="sm" onClick={() => duplicate.mutate(ruleset.id)}>
                          <Copy className="h-3 w-3" />
                          复制
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditingId(ruleset.id);
                              setDraft(ruleset as Draft);
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              if (confirm(`删除规则集「${ruleset.name}」？`)) remove.mutate(ruleset.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setEditingId(null);
          }
        }}
        wide
        title={editingId ? '编辑规则集' : '新建规则集'}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>取消</Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!draft?.name.trim()}
              onClick={() => save.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="名称" hint="这个名字会直接成为 Clash 里 rule-provider 的键">
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="备注（可选）">
                <Input
                  value={draft.description ?? ''}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="来源">
                <Select
                  value={draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as 'remote' | 'inline';
                    setDraft({ ...draft, kind, format: kind === 'inline' ? 'text' : draft.format });
                  }}
                >
                  <option value="inline">内联（自己写规则）</option>
                  <option value="remote">远程（引用 URL）</option>
                </Select>
              </Field>
              <Field label="行为">
                <Select
                  value={draft.behavior}
                  onChange={(event) => setDraft({ ...draft, behavior: event.target.value as Ruleset['behavior'] })}
                >
                  <option value="classical">classical</option>
                  <option value="domain">domain</option>
                  <option value="ipcidr">ipcidr</option>
                </Select>
              </Field>
              <Field label="格式">
                <Select
                  value={draft.format}
                  onChange={(event) => setDraft({ ...draft, format: event.target.value as Ruleset['format'] })}
                >
                  <option value="text">text</option>
                  <option value="yaml">yaml</option>
                  {draft.kind === 'remote' && <option value="mrs">mrs（二进制，体积最小）</option>}
                </Select>
              </Field>
            </div>

            <p className="text-xs text-muted">{BEHAVIOR_HINT[draft.behavior ?? 'classical']}</p>

            {draft.kind === 'remote' ? (
              <Field label="URL">
                <Input
                  placeholder="https://raw.githubusercontent.com/..."
                  value={draft.url ?? ''}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </Field>
            ) : (
              <Field label="规则内容" hint="一行一条，# 开头的行会被忽略">
                <div className="overflow-hidden rounded-md border border-border">
                  <CodeMirror
                    value={draft.content ?? ''}
                    height="260px"
                    theme={oneDark}
                    extensions={[yaml()]}
                    onChange={(value) => setDraft({ ...draft, content: value })}
                  />
                </div>
              </Field>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
