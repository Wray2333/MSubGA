import { BUILTIN_OUTBOUNDS, RULE_MATCHER_META, type RuleMatcher, type RuleProfileDefinition } from '../types.js';
import { selectNodes, type EvaluableNode } from './select.js';

export interface ValidationIssue {
  level: 'error' | 'warning';
  /** 出问题的位置，如 groups[2] / rules[5] */
  path: string;
  message: string;
}

export interface ValidationContext {
  /** 库里现存的规则集 id，用来查悬空引用 */
  rulesetIds: ReadonlySet<string>;
  /** 给了节点集才能校验「策略组求值后是不是空的」 */
  nodes?: readonly EvaluableNode[];
}

const BUILTIN = new Set<string>(BUILTIN_OUTBOUNDS);

/**
 * 模板校验。UI 保存时和生成订阅时都要跑——Clash 对这些问题一律拒绝加载整份配置，
 * 与其让用户在客户端那边看到一句看不懂的报错，不如在这里拦住。
 */
export function validateProfile(
  definition: RuleProfileDefinition,
  context: ValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { groups, rules } = definition;

  /* ---------------------------- 策略组自身 ---------------------------- */

  const keyToIndex = new Map<string, number>();
  const seenNames = new Map<string, number>();

  groups.forEach((group, index) => {
    const path = `groups[${index}]`;
    if (!group.key.trim()) issues.push({ level: 'error', path, message: '策略组 key 不能为空' });
    if (!group.name.trim()) issues.push({ level: 'error', path, message: '策略组名称不能为空' });

    if (keyToIndex.has(group.key)) {
      issues.push({
        level: 'error',
        path,
        message: `策略组 key 重复: ${group.key}（和 groups[${keyToIndex.get(group.key)}] 冲突）`,
      });
    } else {
      keyToIndex.set(group.key, index);
    }

    if (seenNames.has(group.name)) {
      issues.push({
        level: 'error',
        path,
        message: `策略组名称重复: ${group.name}。Clash 要求所有代理和策略组名全局唯一`,
      });
    } else {
      seenNames.set(group.name, index);
    }

    if (BUILTIN.has(group.name)) {
      issues.push({
        level: 'error',
        path,
        message: `策略组不能叫 ${group.name}，这是 Clash 的内置出口名`,
      });
    }

    if ((group.type === 'url-test' || group.type === 'fallback' || group.type === 'load-balance') && !group.url) {
      issues.push({
        level: 'warning',
        path,
        message: `${group.type} 类型的组没填测试 URL，客户端会用自己的默认值`,
      });
    }
  });

  /* ------------------------- include 引用与环 ------------------------- */

  groups.forEach((group, index) => {
    const path = `groups[${index}]`;
    for (const ref of group.include) {
      if (ref === group.key) {
        issues.push({ level: 'error', path, message: `策略组 ${group.key} 引用了自己` });
      } else if (!keyToIndex.has(ref)) {
        issues.push({ level: 'error', path, message: `引用了不存在的策略组: ${ref}` });
      }
    }
  });

  for (const cycle of findCycles(definition)) {
    issues.push({
      level: 'error',
      path: `groups[${keyToIndex.get(cycle[0] ?? '') ?? 0}]`,
      message: `策略组之间存在循环引用: ${cycle.join(' -> ')}`,
    });
  }

  /* ------------------------------ 规则 ------------------------------- */

  const matchIndexes: number[] = [];
  rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    if (!keyToIndex.has(rule.target) && !BUILTIN.has(rule.target)) {
      issues.push({
        level: 'error',
        path,
        message: `规则指向了不存在的策略组: ${rule.target}`,
      });
    }
    if (rule.type === 'ruleset' && !context.rulesetIds.has(rule.rulesetId)) {
      issues.push({
        level: 'error',
        path,
        message: `引用了已被删除的规则集: ${rule.rulesetId}`,
      });
    }
    if (rule.type === 'literal') {
      const problem = validateRulePayload(rule.matcher, rule.payload);
      if (problem) {
        issues.push({
          level: 'error',
          path,
          message: `${RULE_MATCHER_META[rule.matcher].label}：${problem}`,
        });
      }
    }
    if (rule.type === 'match') matchIndexes.push(index);
  });

  if (matchIndexes.length === 0) {
    issues.push({ level: 'error', path: 'rules', message: '缺少兜底规则 MATCH，未命中的流量无处可去' });
  } else if (matchIndexes.length > 1) {
    issues.push({
      level: 'error',
      path: `rules[${matchIndexes[1]}]`,
      message: `MATCH 只能有一条，现在有 ${matchIndexes.length} 条`,
    });
  } else if (matchIndexes[0] !== rules.length - 1) {
    issues.push({
      level: 'error',
      path: `rules[${matchIndexes[0]}]`,
      message: 'MATCH 必须是最后一条规则，它后面的规则永远不会被命中',
    });
  }

  /* ---------------------------- 空组检查 ----------------------------- */

  if (context.nodes) {
    groups.forEach((group, index) => {
      const count =
        selectNodes(context.nodes ?? [], group.nodes).length + group.include.length + group.extra.length;
      if (count === 0) {
        issues.push({
          level: 'error',
          path: `groups[${index}]`,
          message: `策略组「${group.name}」求值后一个成员都没有，Clash 会拒绝加载整份配置`,
        });
      }
    });
  }

  return issues;
}

/** DFS 三色标记找出 include 图里的环 */
function findCycles(definition: RuleProfileDefinition): string[][] {
  const edges = new Map<string, string[]>();
  for (const group of definition.groups) edges.set(group.key, group.include);

  const state = new Map<string, 'visiting' | 'done'>();
  const cycles: string[][] = [];
  const stack: string[] = [];

  const visit = (key: string): void => {
    const current = state.get(key);
    if (current === 'done') return;
    if (current === 'visiting') {
      const start = stack.indexOf(key);
      if (start !== -1) cycles.push([...stack.slice(start), key]);
      return;
    }
    state.set(key, 'visiting');
    stack.push(key);
    for (const next of edges.get(key) ?? []) {
      if (edges.has(next)) visit(next);
    }
    stack.pop();
    state.set(key, 'done');
  };

  for (const key of edges.keys()) visit(key);
  return cycles;
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `[${issue.level}] ${issue.path}: ${issue.message}`).join('\n');
}

/* -------------------------------------------------------------------------- */
/*                              规则内容的格式校验                               */
/* -------------------------------------------------------------------------- */

const PORT_RE = /^\d{1,5}(-\d{1,5})?$/;
const ASN_RE = /^\d+$/;
const COUNTRY_RE = /^[A-Za-z]{2,}$/;

/**
 * 校验单条规则的内容写得对不对。
 * 编辑器里即时提示用，生成配置前也再跑一遍——这些格式错内核是会直接拒绝加载整份配置的，
 * 与其让用户在客户端那边看到一句看不懂的报错，不如在这里就说清楚。
 * 返回 null 表示没问题。
 */
export function validateRulePayload(matcher: RuleMatcher, payload: string): string | null {
  const value = payload.trim();
  if (!value) return '内容不能为空';
  if (value.includes(',')) return '内容里不能有逗号，规则行是按逗号分段的';

  switch (matcher) {
    case 'DOMAIN':
    case 'DOMAIN-SUFFIX':
      if (!/^[a-zA-Z0-9.*_-]+$/.test(value)) return '看起来不像域名';
      if (!value.includes('.')) return '域名至少要有一个点';
      return null;

    case 'DOMAIN-REGEX':
    case 'PROCESS-NAME-REGEX':
      try {
        new RegExp(value);
        return null;
      } catch (error) {
        return `正则不合法：${(error as Error).message}`;
      }

    case 'IP-CIDR':
    case 'IP-CIDR6':
    case 'SRC-IP-CIDR':
      if (!value.includes('/')) return '要带掩码位，例如 192.168.1.0/24';
      return null;

    case 'IP-ASN':
      return ASN_RE.test(value) ? null : 'ASN 只能是数字';

    case 'GEOIP':
    case 'SRC-GEOIP':
      return COUNTRY_RE.test(value) ? null : '国家代码是两位字母，如 CN';

    case 'SRC-PORT':
    case 'DST-PORT':
    case 'IN-PORT': {
      if (!PORT_RE.test(value)) return '填单个端口或 1000-2000 这样的区间';
      const parts = value.split('-').map((part) => Number.parseInt(part, 10));
      if (parts.some((port) => port < 1 || port > 65535)) return '端口要在 1-65535 之间';
      if (parts.length === 2 && parts[0]! > parts[1]!) return '区间的起始值比结束值大';
      return null;
    }

    case 'NETWORK':
      return value === 'tcp' || value === 'udp' ? null : '只能填 tcp 或 udp';

    case 'UID':
      return ASN_RE.test(value) ? null : 'UID 只能是数字';

    default:
      return null;
  }
}
