import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import {
  BUILTIN_OUTBOUNDS,
  BUILTIN_PROFILES,
  PROXY_GROUP_TYPES,
  type RuleEntry,
  type RuleProfileDefinition,
} from '@msubga/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Lock,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SortableList, moveItem } from '../components/SortableList';
import {
  Button,
  CheckLabel,
  Chip,
  Field,
  Input,
  SectionTitle,
  Select,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui';
import { api, type Ruleset, type ValidationIssue } from '../lib/api';
import { cn } from '../lib/utils';
import { RuleDialog, describeRule, type RuleTarget } from './RuleDialog';

type Definition = RuleProfileDefinition;
type Group = Definition['groups'][number];

const NODE_SOURCE_LABEL: Record<string, string> = {
  all: '全部节点',
  none: '不含节点',
  filter: '按条件筛选',
  nodeIds: '指定节点',
};

interface Draft {
  id: string | null;
  name: string;
  description: string;
  definition: Definition;
}

/**
 * 规则模板编辑器。
 *
 * 这里是一个独立路由而不是模态框：它带标签页、可拖拽列表，还要再开「添加规则」的对话框。
 * 模态框里套模态框在桌面上别扭，在手机上基本没法用。
 */
export function ProfileEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const { data: profileData, isLoading } = useQuery({
    queryKey: ['profile', id],
    queryFn: () => api.profiles.get(id!),
    enabled: !isNew && Boolean(id),
  });
  const { data: rulesetData } = useQuery({ queryKey: ['rulesets'], queryFn: api.rulesets.list });

  const [draft, setDraft] = useState<Draft | null>(null);
  // 内置模板不能改，但要能看——之前直接点不开，等于藏了内置分流规则
  const readOnly = profileData?.profile.builtin === true;

  // 切换到另一个模板（比如复制后跳转）时清掉旧草稿，让下面的 effect 重新灌数据
  useEffect(() => {
    setDraft(null);
  }, [id]);

  useEffect(() => {
    if (draft) return;
    if (isNew) {
      setDraft({
        id: null,
        name: '',
        description: '',
        // 拿内置的「规则分流」当起点，比从空白开始好用得多
        definition: structuredClone(BUILTIN_PROFILES[0]!.definition),
      });
    } else if (profileData) {
      setDraft({
        id: profileData.profile.id,
        name: profileData.profile.name,
        description: profileData.profile.description ?? '',
        definition: profileData.profile.definition,
      });
    }
  }, [isNew, profileData, draft]);

  if (isLoading || !draft) return <Spinner />;

  return (
    <ProfileEditorForm
      draft={draft}
      rulesets={rulesetData?.rulesets ?? []}
      readOnly={readOnly}
      onChange={setDraft}
      onDone={() => navigate('/profiles')}
      onDuplicate={async () => {
        const { profile } = await api.profiles.duplicate(draft.id!);
        navigate(`/profiles/${profile.id}`, { replace: true });
      }}
    />
  );
}

function ProfileEditorForm({
  draft,
  rulesets,
  readOnly = false,
  onChange,
  onDone,
  onDuplicate,
}: {
  draft: Draft;
  rulesets: Ruleset[];
  readOnly?: boolean;
  onChange: (draft: Draft) => void;
  onDone: () => void;
  onDuplicate?: () => void;
}) {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [rawText, setRawText] = useState(() => JSON.stringify(draft.definition, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<{ index: number | null; rule: RuleEntry } | null>(null);

  const definition = draft.definition;
  const rulesetById = useMemo(() => new Map(rulesets.map((item) => [item.id, item])), [rulesets]);

  const targets: RuleTarget[] = useMemo(
    () => [
      ...definition.groups.map((group) => ({ key: group.key, label: group.name })),
      ...BUILTIN_OUTBOUNDS.map((name) => ({ key: name, label: name })),
    ],
    [definition.groups],
  );

  // 每次改动都拿服务端校验一遍，错误当场显示，不用等保存
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.profiles
        .validate(definition)
        .then((result) => {
          if (!cancelled) setIssues(result.issues);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [definition]);

  const setDefinition = (next: Definition): void => {
    onChange({ ...draft, definition: next });
    setRawText(JSON.stringify(next, null, 2));
  };

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload = { name: draft.name, description: draft.description || null, definition };
      if (draft.id) await api.profiles.update(draft.id, payload);
      else await api.profiles.create(payload);
    },
    onSuccess: () => {
      toast.success('模板已保存');
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  const hasMatch = definition.rules.some((rule) => rule.type === 'match');

  const commitRule = (rule: RuleEntry): void => {
    if (!editingRule) return;
    const rules = [...definition.rules];
    if (editingRule.index === null) {
      // 新规则插在 MATCH 前面，否则一加就违反「MATCH 必须最后」
      const at = rule.type === 'match' ? rules.length : rules.findIndex((item) => item.type === 'match');
      rules.splice(at === -1 ? rules.length : at, 0, rule);
    } else {
      rules[editingRule.index] = rule;
    }
    setDefinition({ ...definition, rules });
    setEditingRule(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <Button variant="ghost" onClick={onDone} className="-ml-2 px-2">
          <ArrowLeft className="size-4" />
          返回模板列表
        </Button>

        {readOnly && (
          <div className="flex flex-wrap items-center gap-2 border border-accent/30 bg-accent/8 px-3 py-2.5 text-xs">
            <Lock className="size-3.5 shrink-0 text-accent" />
            <span className="text-fg-2">这是内置模板，只能查看。想改的话先复制一份。</span>
            {onDuplicate && (
              <Button size="sm" variant="primary" className="ml-auto" onClick={onDuplicate}>
                <Copy className="size-3" />
                复制后编辑
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="模板名称">
            <Input
              value={draft.name}
              disabled={readOnly}
              placeholder="例如：家里的分流"
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="说明（可选）">
            <Input
              value={draft.description}
              disabled={readOnly}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
            />
          </Field>
        </div>

        {issues.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs">
            {issues.map((issue, index) => (
              <li
                key={`${issue.path}-${index}`}
                className={cn('flex gap-1.5', issue.level === 'error' ? 'text-danger' : 'text-warn')}
              >
                {issue.level === 'error' ? (
                  <AlertCircle className="mt-0.5 size-3 shrink-0" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                )}
                <span className="shrink-0 font-mono text-muted">{issue.path}</span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}

        <Tabs defaultValue="rules">
          <TabsList>
            <TabsTrigger value="rules">规则</TabsTrigger>
            <TabsTrigger value="groups">策略组</TabsTrigger>
            <TabsTrigger value="raw">高级</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="pt-3">
            <SectionTitle
              title="分流规则"
              hint={readOnly ? '从上往下匹配，第一条命中的生效' : '拖动左侧手柄调整顺序，点一行即可编辑'}
            >
              <Button
                size="sm"
                variant="primary"
                className={readOnly ? 'hidden' : undefined}
                onClick={() =>
                  setEditingRule({
                    index: null,
                    rule: {
                      type: 'literal',
                      matcher: 'DOMAIN-SUFFIX',
                      payload: '',
                      target: definition.groups[0]?.key ?? 'DIRECT',
                    },
                  })
                }
              >
                <Plus className="size-3" />
                添加规则
              </Button>
            </SectionTitle>

            {definition.rules.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted">
                还没有规则。至少要有一条兜底 MATCH，否则配置加载不了。
              </p>
            ) : (
              <SortableList
                items={definition.rules}
                getId={(_rule, index) => `rule-${index}`}
                onReorder={(from, to) =>
                  setDefinition({ ...definition, rules: moveItem(definition.rules, from, to) })
                }
                renderItem={(rule, index) => (
                  <RuleRow
                    rule={rule}
                    targets={targets}
                    rulesetById={rulesetById}
                    readOnly={readOnly}
                    onEdit={() => !readOnly && setEditingRule({ index, rule })}
                    onDelete={() =>
                      setDefinition({
                        ...definition,
                        rules: definition.rules.filter((_, i) => i !== index),
                      })
                    }
                  />
                )}
              />
            )}
          </TabsContent>

          <TabsContent value="groups" className="pt-3">
            <SectionTitle title="策略组" hint="成员列表里的第一项是客户端默认选中的">
              <Button
                size="sm"
                className={readOnly ? 'hidden' : undefined}
                onClick={() => {
                  const key = `GROUP${definition.groups.length + 1}`;
                  setDefinition({
                    ...definition,
                    groups: [
                      ...definition.groups,
                      { key, name: key, type: 'select', nodes: { mode: 'all' }, include: [], extra: [] },
                    ],
                  });
                }}
              >
                <Plus className="size-3" />
                加一组
              </Button>
            </SectionTitle>

            <SortableList
              items={definition.groups}
              getId={(group) => group.key}
              onReorder={(from, to) =>
                setDefinition({ ...definition, groups: moveItem(definition.groups, from, to) })
              }
              renderItem={(group, index) => (
                <GroupCard
                  group={group}
                  index={index}
                  definition={definition}
                  setDefinition={setDefinition}
                />
              )}
            />
          </TabsContent>

          <TabsContent value="raw" className="space-y-2 pt-3">
            <p className="text-xs text-muted">
              直接改底层结构。改完失焦即生效；JSON 不合法时不会覆盖可视化里的内容。
              AND / OR / NOT 这类复合规则只能在这里写。
            </p>
            <div className="overflow-hidden rounded-lg border border-border">
              <CodeMirror
                value={rawText}
                height="420px"
                theme={oneDark}
                extensions={[json()]}
                onChange={setRawText}
                onBlur={() => {
                  try {
                    const parsed = JSON.parse(rawText) as Definition;
                    setRawError(null);
                    onChange({ ...draft, definition: parsed });
                  } catch (error) {
                    setRawError((error as Error).message);
                  }
                }}
              />
            </div>
            {rawError && <p className="text-xs text-danger">JSON 解析失败：{rawError}</p>}
          </TabsContent>
        </Tabs>
      </div>

      {/* 操作条钉在底部：编辑器很长，滚到哪都能保存 */}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <span className="mr-auto flex items-center gap-1.5 text-xs">
          {errors.length > 0 ? (
            <>
              <AlertCircle className="size-3.5 shrink-0 text-danger" />
              <span className="text-danger">{errors.length} 个错误</span>
            </>
          ) : warnings.length > 0 ? (
            <>
              <TriangleAlert className="size-3.5 shrink-0 text-warn" />
              <span className="text-warn">{warnings.length} 个提醒</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
              <span className="text-muted">校验通过</span>
            </>
          )}
        </span>
        <Button onClick={onDone}>{readOnly ? '返回' : '取消'}</Button>
        {!readOnly && (
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={errors.length > 0 || !draft.name.trim()}
            onClick={() => save.mutate()}
          >
            保存
          </Button>
        )}
      </div>

      {editingRule && (
        <RuleDialog
          rule={editingRule.rule}
          isNew={editingRule.index === null}
          targets={targets}
          rulesets={rulesets}
          hasMatchAlready={hasMatch && editingRule.rule.type !== 'match'}
          onSave={commitRule}
          onClose={() => setEditingRule(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  规则一行                                   */
/* -------------------------------------------------------------------------- */

function RuleRow({
  rule,
  targets,
  rulesetById,
  readOnly = false,
  onEdit,
  onDelete,
}: {
  rule: RuleEntry;
  targets: RuleTarget[];
  rulesetById: Map<string, Ruleset>;
  readOnly?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { kind, body, missing } = describeRule(rule, rulesetById);
  const targetLabel = targets.find((item) => item.key === rule.target)?.label ?? rule.target;
  const isMatch = rule.type === 'match';

  return (
    <div
      className={cn(
        'group flex items-center gap-2.5 rounded-lg border bg-surface px-2.5 py-2 transition',
        missing ? 'border-danger/45' : 'border-border hover:border-border-strong',
      )}
    >
      {/*
        窄屏下这一行放不开：固定宽的类型 chip 和目标组会把内容挤成一个字。
        手机上改成两行——第一行是类型和内容，第二行是去向。
      */}
      <button
        type="button"
        onClick={onEdit}
        disabled={readOnly}
        className="flex min-w-0 flex-1 flex-col gap-1 text-left disabled:cursor-default sm:flex-row sm:items-center sm:gap-2.5"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Chip tone={isMatch ? 'warn' : 'accent'} className="shrink-0 justify-center sm:w-16">
            {kind}
          </Chip>
          <span
            className={cn(
              'min-w-0 flex-1 truncate font-mono text-xs',
              missing ? 'text-danger' : isMatch ? 'text-muted' : 'text-fg-2',
            )}
          >
            {body}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 sm:contents">
          <span className="shrink-0 text-2xs text-muted">走</span>
          <span className="min-w-0 truncate text-xs sm:w-32 sm:shrink-0">{targetLabel}</span>
        </span>
      </button>

      {/* MATCH 是必需的，不给删；只读模式下所有规则都不给删 */}
      {isMatch || readOnly ? (
        <span className="w-6 shrink-0" />
      ) : (
        <button
          type="button"
          title="删除这条规则"
          onClick={onDelete}
          className="hover-reveal w-6 shrink-0 rounded p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-danger/12 hover:text-danger focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 策略组卡片                                   */
/* -------------------------------------------------------------------------- */

function GroupCard({
  group,
  index,
  definition,
  setDefinition,
}: {
  group: Group;
  index: number;
  definition: Definition;
  setDefinition: (next: Definition) => void;
}) {
  const patch = (changes: Partial<Group>): void => {
    const groups = [...definition.groups];
    groups[index] = { ...group, ...changes } as Group;
    setDefinition({ ...definition, groups });
  };

  const renameKey = (newKey: string): void => {
    const oldKey = group.key;
    const groups = definition.groups.map((item, i) =>
      i === index
        ? { ...item, key: newKey }
        : { ...item, include: item.include.map((ref) => (ref === oldKey ? newKey : ref)) },
    );
    // 键改了，指向它的规则也要一起改，否则整批规则全变成悬空引用
    const rules = definition.rules.map((rule) =>
      rule.target === oldKey ? { ...rule, target: newKey } : rule,
    );
    setDefinition({ ...definition, groups, rules });
  };

  const others = definition.groups.filter((other) => other.key !== group.key);

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="grid grid-cols-2 items-end gap-2 lg:grid-cols-[1fr_9rem_8rem_9rem_auto]">
        <Field label="显示名">
          <Input value={group.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label="引用键">
          <Input
            value={group.key}
            className="font-mono text-xs"
            onChange={(event) => renameKey(event.target.value)}
          />
        </Field>
        <Field label="类型">
          <Select value={group.type} onChange={(event) => patch({ type: event.target.value as Group['type'] })}>
            {PROXY_GROUP_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="包含节点">
          <Select
            value={group.nodes.mode}
            onChange={(event) => {
              const mode = event.target.value;
              patch({
                nodes:
                  mode === 'filter'
                    ? { mode: 'filter', filter: { tagMode: 'any' } }
                    : mode === 'nodeIds'
                      ? { mode: 'nodeIds', ids: [] }
                      : { mode: mode as 'all' | 'none' },
              });
            }}
          >
            {Object.entries(NODE_SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <button
          type="button"
          title="删除这一组"
          onClick={() =>
            setDefinition({ ...definition, groups: definition.groups.filter((_, i) => i !== index) })
          }
          className="mb-2 rounded p-1 text-muted transition hover:bg-danger/12 hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-border/60 pt-2.5">
        <span className="text-2xs text-muted">成员还包含</span>
        {others.map((other) => (
          <CheckLabel
            key={other.key}
            checked={group.include.includes(other.key)}
            onChange={(checked) =>
              patch({
                include: checked
                  ? [...group.include, other.key]
                  : group.include.filter((ref) => ref !== other.key),
              })
            }
          >
            {other.name}
          </CheckLabel>
        ))}
        {(['DIRECT', 'REJECT'] as const).map((outbound) => (
          <CheckLabel
            key={outbound}
            checked={group.extra.includes(outbound)}
            onChange={(checked) =>
              patch({
                extra: checked
                  ? [...group.extra, outbound]
                  : group.extra.filter((item) => item !== outbound),
              })
            }
          >
            <span className="font-mono">{outbound}</span>
          </CheckLabel>
        ))}
        {group.extra.length > 0 && (
          <CheckLabel
            checked={group.extraFirst === true}
            onChange={(checked) => patch({ extraFirst: checked })}
            className="text-muted"
          >
            排到最前（直连组要勾，否则默认走代理）
          </CheckLabel>
        )}
      </div>
    </div>
  );
}
