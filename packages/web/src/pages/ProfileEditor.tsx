import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import {
  BUILTIN_OUTBOUNDS,
  PROXY_GROUP_TYPES,
  type RuleEntry,
  type RuleProfileDefinition,
} from '@msubga/core';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SortableList, moveItem } from '../components/SortableList';
import {
  Button,
  CheckLabel,
  Chip,
  Field,
  Input,
  Modal,
  SectionTitle,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui';
import { api, type Ruleset, type ValidationIssue } from '../lib/api';
import { cn } from '../lib/utils';
import { RuleDialog, describeRule, type RuleTarget } from './RuleDialog';

export interface ProfileDraft {
  id: string | null;
  name: string;
  description: string;
  definition: RuleProfileDefinition;
}

type Definition = RuleProfileDefinition;
type Group = Definition['groups'][number];

const NODE_SOURCE_LABEL: Record<string, string> = {
  all: '全部节点',
  none: '不含节点',
  filter: '按条件筛选',
  nodeIds: '指定节点',
};

export function ProfileEditor({
  draft,
  rulesets,
  onChange,
  onClose,
  onSaved,
}: {
  draft: ProfileDraft;
  rulesets: Ruleset[];
  onChange: (draft: ProfileDraft) => void;
  onClose: () => void;
  onSaved: () => void;
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
      // 新建和更新返回的形状不一样，这里只关心成功与否，统一吞掉返回值
      if (draft.id) await api.profiles.update(draft.id, payload);
      else await api.profiles.create(payload);
    },
    onSuccess: onSaved,
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
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={draft.id ? '编辑规则模板' : '新建规则模板'}
      description="策略组决定流量能去哪；规则从上往下匹配，第一条命中的生效"
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-xs">
            {errors.length > 0 ? (
              <>
                <AlertCircle className="size-3.5 text-danger" />
                <span className="text-danger">{errors.length} 个错误，修掉才能保存</span>
              </>
            ) : warnings.length > 0 ? (
              <>
                <TriangleAlert className="size-3.5 text-warn" />
                <span className="text-warn">{warnings.length} 个提醒</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5 text-ok" />
                <span className="text-muted">校验通过</span>
              </>
            )}
          </span>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={errors.length > 0 || !draft.name.trim()}
            onClick={() => save.mutate()}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="模板名称">
            <Input
              value={draft.name}
              placeholder="例如：家里的分流"
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="说明（可选）">
            <Input
              value={draft.description}
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
            <TabsTrigger value="raw">高级（JSON）</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="pt-3">
            <SectionTitle title="分流规则" hint="拖动左侧手柄调整顺序，点一行即可编辑">
              <Button
                size="sm"
                variant="primary"
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
                    onEdit={() => setEditingRule({ index, rule })}
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
                    const parsed = JSON.parse(rawText) as RuleProfileDefinition;
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
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  规则一行                                   */
/* -------------------------------------------------------------------------- */

function RuleRow({
  rule,
  targets,
  rulesetById,
  onEdit,
  onDelete,
}: {
  rule: RuleEntry;
  targets: RuleTarget[];
  rulesetById: Map<string, Ruleset>;
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
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <Chip tone={isMatch ? 'warn' : 'accent'} className="w-16 shrink-0 justify-center">
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
        <span className="shrink-0 text-2xs text-muted">走</span>
        <span className="w-32 shrink-0 truncate text-xs">{targetLabel}</span>
      </button>

      {/* MATCH 是必需的，不给删 */}
      {isMatch ? (
        <span className="w-6 shrink-0" />
      ) : (
        <button
          type="button"
          title="删除这条规则"
          onClick={onDelete}
          className="w-6 shrink-0 rounded p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-danger/12 hover:text-danger focus-visible:opacity-100"
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
