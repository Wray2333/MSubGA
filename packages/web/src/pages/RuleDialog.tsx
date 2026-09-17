import {
  RULE_MATCHERS,
  RULE_MATCHER_META,
  validateRulePayload,
  type RuleEntry,
  type RuleMatcher,
} from '@msubga/core';
import { useMemo, useState } from 'react';
import { Button, CheckLabel, Field, Input, Modal, Select } from '../components/ui';
import type { Ruleset } from '../lib/api';

/** 下拉里的两个特殊项，和普通匹配类型并列 */
const RULESET_OPTION = '__RULESET__';
const MATCH_OPTION = '__MATCH__';

const GROUP_ORDER = ['域名', 'IP', '端口', '来源', '进程', '其他'] as const;

export interface RuleTarget {
  key: string;
  label: string;
}

/** 规则在列表里怎么显示：匹配类型 / 内容 / 目标 */
export function describeRule(
  rule: RuleEntry,
  rulesetById: Map<string, Ruleset>,
): { kind: string; body: string; missing: boolean } {
  if (rule.type === 'match') return { kind: '兜底', body: '所有未命中的流量', missing: false };
  if (rule.type === 'ruleset') {
    const ruleset = rulesetById.get(rule.rulesetId);
    return {
      kind: '规则集',
      body: ruleset?.name ?? `已删除的规则集（${rule.rulesetId}）`,
      missing: !ruleset,
    };
  }
  return { kind: RULE_MATCHER_META[rule.matcher].label, body: rule.payload, missing: false };
}

function initialSelection(rule: RuleEntry): string {
  if (rule.type === 'match') return MATCH_OPTION;
  if (rule.type === 'ruleset') return RULESET_OPTION;
  return rule.matcher;
}

export function RuleDialog({
  rule,
  isNew,
  targets,
  rulesets,
  hasMatchAlready,
  onSave,
  onClose,
}: {
  rule: RuleEntry;
  isNew: boolean;
  targets: RuleTarget[];
  rulesets: Ruleset[];
  /** 模板里已经有一条 MATCH 了，就不让再加第二条 */
  hasMatchAlready: boolean;
  onSave: (rule: RuleEntry) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<string>(() => initialSelection(rule));
  const [payload, setPayload] = useState(rule.type === 'literal' ? rule.payload : '');
  const [rulesetId, setRulesetId] = useState(
    rule.type === 'ruleset' ? rule.rulesetId : (rulesets[0]?.id ?? ''),
  );
  const [target, setTarget] = useState(rule.target || (targets[0]?.key ?? 'DIRECT'));
  const [noResolve, setNoResolve] = useState(rule.type !== 'match' ? rule.noResolve !== false : true);

  const matcher = selection !== RULESET_OPTION && selection !== MATCH_OPTION
    ? (selection as RuleMatcher)
    : null;
  const meta = matcher ? RULE_MATCHER_META[matcher] : null;

  const grouped = useMemo(() => {
    const map = new Map<string, RuleMatcher[]>();
    for (const key of RULE_MATCHERS) {
      const group = RULE_MATCHER_META[key].group;
      map.set(group, [...(map.get(group) ?? []), key]);
    }
    return map;
  }, []);

  const payloadError = matcher ? validateRulePayload(matcher, payload) : null;
  const targetLabel = targets.find((item) => item.key === target)?.label ?? target;

  const built: RuleEntry | null = (() => {
    if (selection === MATCH_OPTION) return { type: 'match', target };
    if (selection === RULESET_OPTION) {
      if (!rulesetId) return null;
      return { type: 'ruleset', rulesetId, target, noResolve };
    }
    if (!matcher || payloadError) return null;
    return meta?.ipLike
      ? { type: 'literal', matcher, payload: payload.trim(), target, noResolve }
      : { type: 'literal', matcher, payload: payload.trim(), target };
  })();

  // 实时拼出最终会写进配置的那一行，所见即所得
  const preview = (() => {
    if (selection === MATCH_OPTION) return `MATCH,${targetLabel}`;
    const tail = (selection === RULESET_OPTION || meta?.ipLike) && noResolve ? ',no-resolve' : '';
    if (selection === RULESET_OPTION) {
      const name = rulesets.find((item) => item.id === rulesetId)?.name ?? '?';
      return `RULE-SET,${name},${targetLabel}${tail}`;
    }
    return `${matcher},${payload.trim() || '…'},${targetLabel}${tail}`;
  })();

  const canUseNoResolve = selection === RULESET_OPTION
    ? rulesets.find((item) => item.id === rulesetId)?.behavior === 'ipcidr'
    : Boolean(meta?.ipLike);

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={isNew ? '添加规则' : '编辑规则'}
      description="规则从上往下匹配，第一条命中的生效"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={built === null} onClick={() => built && onSave(built)}>
            {isNew ? '添加' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="规则类型">
          <Select value={selection} onChange={(event) => setSelection(event.target.value)}>
            <option value={RULESET_OPTION}>规则集（引用一整份现成的列表）</option>
            {!hasMatchAlready || selection === MATCH_OPTION ? (
              <option value={MATCH_OPTION}>兜底 MATCH（所有未命中的流量）</option>
            ) : null}
            {GROUP_ORDER.map((group) => (
              <optgroup key={group} label={group}>
                {(grouped.get(group) ?? []).map((key) => (
                  <option key={key} value={key}>
                    {RULE_MATCHER_META[key].label}（{key}）
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        {selection === RULESET_OPTION ? (
          <Field label="选择规则集" hint="远程规则集会写成 rule-provider，内联规则集会直接展开成规则行">
            <Select value={rulesetId} onChange={(event) => setRulesetId(event.target.value)}>
              {rulesets.length === 0 && <option value="">还没有规则集</option>}
              {rulesets.map((ruleset) => (
                <option key={ruleset.id} value={ruleset.id}>
                  {ruleset.name}（{ruleset.behavior}）
                </option>
              ))}
            </Select>
          </Field>
        ) : selection === MATCH_OPTION ? (
          <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-muted">
            兜底规则没有匹配内容。它必须排在最后一条，前面所有规则都没命中的流量会走到这里。
          </p>
        ) : (
          <Field label="匹配内容" hint={meta?.hint} error={payload ? payloadError : null}>
            <Input
              autoFocus
              value={payload}
              placeholder={meta?.placeholder}
              onChange={(event) => setPayload(event.target.value)}
            />
          </Field>
        )}

        <Field label="目标策略" hint="命中这条规则的流量走哪个策略组">
          <Select value={target} onChange={(event) => setTarget(event.target.value)}>
            {targets.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>

        {canUseNoResolve && (
          <CheckLabel checked={noResolve} onChange={setNoResolve}>
            加 no-resolve（IP 类规则建议开：不加的话内核要先把每个域名解析成 IP 才能判断，拖慢首包）
          </CheckLabel>
        )}

        <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="mb-1 text-2xs text-muted">最终会写进配置的这一行</div>
          <code className="block break-all font-mono text-xs text-fg-2">{preview}</code>
        </div>
      </div>
    </Modal>
  );
}
