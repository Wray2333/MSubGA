import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import { BUILTIN_OUTBOUNDS, PROXY_GROUP_TYPES, type RuleProfileDefinition } from '@msubga/core';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SortableList, moveItem } from '../components/SortableList';
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui';
import { api, type Ruleset, type ValidationIssue } from '../lib/api';

export interface ProfileDraft {
  id: string | null;
  name: string;
  description: string;
  definition: RuleProfileDefinition;
}

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

  const definition = draft.definition;
  const rulesetById = useMemo(() => new Map(rulesets.map((item) => [item.id, item])), [rulesets]);
  const groupKeys = definition.groups.map((group) => group.key);
  const targets = [...groupKeys, ...BUILTIN_OUTBOUNDS];

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

  const setDefinition = (next: RuleProfileDefinition): void => {
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

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      wide
      title={draft.id ? '编辑规则模板' : '新建规则模板'}
      description="策略组决定流量能去哪；规则从上往下匹配，第一条命中的生效"
      footer={
        <>
          <span className="mr-auto text-xs">
            {errors.length > 0 ? (
              <span className="text-danger">{errors.length} 个错误，修掉才能保存</span>
            ) : warnings.length > 0 ? (
              <span className="text-warn">{warnings.length} 个提醒</span>
            ) : (
              <span className="text-ok">校验通过</span>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="模板名称">
            <Input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="说明（可选）">
            <Input
              value={draft.description}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
            />
          </Field>
        </div>

        {issues.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-border bg-surface p-3 text-xs">
            {issues.map((issue, index) => (
              <li
                key={`${issue.path}-${index}`}
                className={issue.level === 'error' ? 'flex gap-1.5 text-danger' : 'flex gap-1.5 text-warn'}
              >
                {issue.level === 'error' ? (
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                )}
                <span className="shrink-0 font-mono text-muted">{issue.path}</span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}

        <Tabs defaultValue="visual">
          <TabsList>
            <TabsTrigger value="visual">可视化</TabsTrigger>
            <TabsTrigger value="raw">高级（JSON）</TabsTrigger>
          </TabsList>

          <TabsContent value="visual" className="space-y-5">
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-medium">策略组</h3>
                <span className="mr-auto text-xs text-muted">第一个成员是客户端里的默认选中项</span>
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
                  <Plus className="h-3 w-3" />
                  加一组
                </Button>
              </div>

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
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-medium">规则</h3>
                <span className="mr-auto text-xs text-muted">从上往下匹配，MATCH 必须排在最后</span>
                <Button
                  size="sm"
                  onClick={() => {
                    // 新规则插在 MATCH 前面，否则一加就违反「MATCH 必须最后」
                    const rules = [...definition.rules];
                    const at = rules.findIndex((rule) => rule.type === 'match');
                    const fresh = {
                      type: 'literal' as const,
                      value: 'DOMAIN-SUFFIX,example.com',
                      target: definition.groups[0]?.key ?? 'DIRECT',
                    };
                    rules.splice(at === -1 ? rules.length : at, 0, fresh);
                    setDefinition({ ...definition, rules });
                  }}
                >
                  <Plus className="h-3 w-3" />
                  加一条
                </Button>
              </div>

              <SortableList
                items={definition.rules}
                getId={(_rule, index) => `rule-${index}`}
                onReorder={(from, to) =>
                  setDefinition({ ...definition, rules: moveItem(definition.rules, from, to) })
                }
                renderItem={(rule, index) => (
                  <RuleRow
                    rule={rule}
                    index={index}
                    targets={targets}
                    rulesets={rulesets}
                    rulesetById={rulesetById}
                    definition={definition}
                    setDefinition={setDefinition}
                  />
                )}
              />
            </section>
          </TabsContent>

          <TabsContent value="raw" className="space-y-2">
            <p className="text-xs text-muted">
              直接改底层结构。改完失焦即生效；JSON 不合法时不会覆盖可视化里的内容。
            </p>
            <div className="overflow-hidden rounded-md border border-border">
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
    </Modal>
  );
}

type Definition = RuleProfileDefinition;
type Group = Definition['groups'][number];

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

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="grid grid-cols-[1fr_1fr_8rem_9rem_auto] items-end gap-2">
        <Field label="显示名">
          <Input value={group.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label="引用键">
          <Input value={group.key} onChange={(event) => renameKey(event.target.value)} />
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
          className="mb-1.5 text-muted transition hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-muted">成员还包含：</span>
        {definition.groups
          .filter((other) => other.key !== group.key)
          .map((other) => (
            <label key={other.key} className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                className="h-3 w-3 accent-[var(--color-accent)]"
                checked={group.include.includes(other.key)}
                onChange={(event) =>
                  patch({
                    include: event.target.checked
                      ? [...group.include, other.key]
                      : group.include.filter((ref) => ref !== other.key),
                  })
                }
              />
              {other.name}
            </label>
          ))}
        {(['DIRECT', 'REJECT'] as const).map((outbound) => (
          <label key={outbound} className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              className="h-3 w-3 accent-[var(--color-accent)]"
              checked={group.extra.includes(outbound)}
              onChange={(event) =>
                patch({
                  extra: event.target.checked
                    ? [...group.extra, outbound]
                    : group.extra.filter((item) => item !== outbound),
                })
              }
            />
            {outbound}
          </label>
        ))}
        {group.extra.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1 text-muted">
            <input
              type="checkbox"
              className="h-3 w-3 accent-[var(--color-accent)]"
              checked={group.extraFirst === true}
              onChange={(event) => patch({ extraFirst: event.target.checked })}
            />
            排到最前（直连组要勾这个，否则默认走代理）
          </label>
        )}
      </div>
    </div>
  );
}

type Rule = Definition['rules'][number];

const RULE_TYPE_LABEL: Record<Rule['type'], string> = {
  ruleset: '规则集',
  literal: '自定义规则',
  geoip: 'GEOIP',
  geosite: 'GEOSITE',
  match: '兜底 MATCH',
};

function RuleRow({
  rule,
  index,
  targets,
  rulesets,
  rulesetById,
  definition,
  setDefinition,
}: {
  rule: Rule;
  index: number;
  targets: string[];
  rulesets: Ruleset[];
  rulesetById: Map<string, Ruleset>;
  definition: Definition;
  setDefinition: (next: Definition) => void;
}) {
  const replace = (next: Rule): void => {
    const rules = [...definition.rules];
    rules[index] = next;
    setDefinition({ ...definition, rules });
  };

  const changeType = (type: Rule['type']): void => {
    const target = rule.target;
    if (type === 'match') replace({ type: 'match', target });
    else if (type === 'ruleset') replace({ type: 'ruleset', rulesetId: rulesets[0]?.id ?? '', target });
    else if (type === 'literal') replace({ type: 'literal', value: 'DOMAIN-SUFFIX,example.com', target });
    else replace({ type, value: type === 'geoip' ? 'CN' : 'cn', target });
  };

  const missing = rule.type === 'ruleset' && !rulesetById.has(rule.rulesetId);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
      <Select
        className="w-32 shrink-0"
        value={rule.type}
        onChange={(event) => changeType(event.target.value as Rule['type'])}
      >
        {Object.entries(RULE_TYPE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      {rule.type === 'ruleset' ? (
        <Select
          className={missing ? 'flex-1 border-danger' : 'flex-1'}
          value={rule.rulesetId}
          onChange={(event) => replace({ ...rule, rulesetId: event.target.value })}
        >
          {missing && <option value={rule.rulesetId}>规则集已被删除（{rule.rulesetId}）</option>}
          {rulesets.map((ruleset) => (
            <option key={ruleset.id} value={ruleset.id}>
              {ruleset.name}
            </option>
          ))}
        </Select>
      ) : rule.type === 'match' ? (
        <span className="flex-1 text-xs text-muted">未被前面任何规则命中的流量</span>
      ) : (
        <Input
          className="flex-1"
          value={rule.value}
          onChange={(event) => replace({ ...rule, value: event.target.value })}
        />
      )}

      <span className="shrink-0 text-xs text-muted">走</span>
      <Select
        className="w-40 shrink-0"
        value={rule.target}
        onChange={(event) => replace({ ...rule, target: event.target.value })}
      >
        {targets.map((target) => (
          <option key={target} value={target}>
            {target}
          </option>
        ))}
      </Select>

      {rule.type === 'match' ? (
        <span className="w-6 shrink-0" />
      ) : (
        <button
          type="button"
          title="删除这条规则"
          onClick={() =>
            setDefinition({ ...definition, rules: definition.rules.filter((_, i) => i !== index) })
          }
          className="w-6 shrink-0 text-muted transition hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
