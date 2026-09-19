import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Chip,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
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
  const [viewing, setViewing] = useState<Ruleset | null>(null);

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
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="规则集"
        count={`${rulesets.length} 个`}
        subtitle="远程规则集会写成 rule-provider；内联规则集在生成时直接展开成规则行"
      >
        <Button
          variant="primary"
          onClick={() => {
            setEditingId(null);
            setDraft({ ...EMPTY });
          }}
        >
          <Plus className="size-4" />
          新建
        </Button>
      </PageHeader>

      {rulesets.length === 0 ? (
        <Empty title="还没有规则集">内置规则集会随首次启动自动写入</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface/60 text-2xs text-muted">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">名称</th>
                <th className="hidden w-20 px-2 py-2.5 text-left font-medium sm:table-cell">来源</th>
                <th className="hidden w-28 px-2 py-2.5 text-left font-medium md:table-cell">行为 / 格式</th>
                <th className="hidden px-2 py-2.5 text-left font-medium lg:table-cell">内容</th>
                <th className="w-px px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rulesets.map((ruleset) => (
                <tr
                  key={ruleset.id}
                  className="group cursor-pointer border-t border-border align-middle hover:bg-surface/60"
                  onClick={() => setViewing(ruleset)}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {ruleset.builtin && <Lock className="size-3 shrink-0 text-muted" />}
                      <span className="text-[0.9375rem]">{ruleset.name}</span>
                    </div>
                    {ruleset.description && (
                      <div className="mt-0.5 line-clamp-1 text-2xs text-muted">
                        {ruleset.description}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-2 py-2.5 sm:table-cell">
                    <Chip>{ruleset.kind === 'remote' ? '远程' : '内联'}</Chip>
                  </td>
                  <td className="hidden px-2 py-2.5 font-mono text-2xs text-muted md:table-cell">
                    {ruleset.behavior} / {ruleset.format}
                  </td>
                  {/* 原来这列塞完整 URL 又写死 truncate，等于永远看不全。
                      列表只给文件名，完整地址放详情里，那里能选中也能复制。 */}
                  <td className="hidden px-2 py-2.5 lg:table-cell">
                    <span className="font-mono text-2xs text-muted">
                      {ruleset.kind === 'remote'
                        ? (ruleset.url ?? '').split('/').pop()
                        : `${(ruleset.content ?? '').split('\n').filter(Boolean).length} 行规则`}
                    </span>
                  </td>
                  <td className="px-2 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(ruleset)}>
                        <Eye className="size-3" />
                        <span className="hidden sm:inline">详情</span>
                      </Button>
                      {ruleset.builtin ? (
                        <Button size="sm" onClick={() => duplicate.mutate(ruleset.id)}>
                          <Copy className="size-3" />
                          <span className="hidden sm:inline">复制</span>
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
                            className="hover-reveal opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                            onClick={() => {
                              if (confirm(`删除规则集「${ruleset.name}」？`)) remove.mutate(ruleset.id);
                            }}
                          >
                            <Trash2 className="size-3" />
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

      {viewing && <RulesetDetail ruleset={viewing} onClose={() => setViewing(null)} />}

      <Modal
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setEditingId(null);
          }
        }}
        size="lg"
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
            <div className="grid gap-3 sm:grid-cols-2">
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

            <div className="grid gap-3 sm:grid-cols-3">
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

/** 只读详情。内置规则集不能编辑，但得让人看得见它到底指向什么、内容长什么样 */
function RulesetDetail({ ruleset, onClose }: { ruleset: Ruleset; onClose: () => void }) {
  const lines = (ruleset.content ?? '').split('\n').filter(Boolean);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={ruleset.name}
      description={ruleset.description ?? undefined}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {[
            ['来源', ruleset.kind === 'remote' ? '远程' : '内联'],
            ['匹配行为', ruleset.behavior],
            ['文件格式', ruleset.format],
            ['是否内置', ruleset.builtin ? '内置（只读）' : '自定义'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="telemetry-cjk text-muted">{label}</dt>
              <dd className="mt-1 font-mono text-xs text-fg-2">{value}</dd>
            </div>
          ))}
        </dl>

        {ruleset.kind === 'remote' ? (
          <div>
            <div className="telemetry-cjk mb-1.5 text-muted">完整地址</div>
            {/* 列表里放不下所以只显示文件名，完整地址在这里，可以选中复制 */}
            <code className="block w-full break-all rounded border border-border bg-bg px-2.5 py-2 font-mono text-xs text-fg-2">
              {ruleset.url}
            </code>
            <p className="mt-2 text-2xs text-muted">
              生成订阅时会写成 rule-provider，由客户端自己去拉取并按 24 小时缓存。
            </p>
          </div>
        ) : (
          <div>
            <div className="telemetry-cjk mb-1.5 text-muted">规则内容 · 共 {lines.length} 条</div>
            <pre className="max-h-80 overflow-auto rounded border border-border bg-bg px-2.5 py-2 font-mono text-xs leading-relaxed text-fg-2">
              {ruleset.content}
            </pre>
            <p className="mt-2 text-2xs text-muted">
              内联规则集不会写成 rule-provider，生成时直接展开成一条条规则行。
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
