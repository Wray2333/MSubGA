import type {
  GroupNodeSource,
  LatencyStatus,
  NodeFilter,
  NodeSelection,
  ProxyConfig,
} from '../types.js';

/** 生成器眼里的节点：配置之外还要带上标签和最近一次测速结果，筛选条件用得到 */
export interface EvaluableNode {
  id: string;
  name: string;
  config: ProxyConfig;
  tagIds?: readonly string[];
  lastDelayMs?: number | null;
  lastStatus?: LatencyStatus | null;
}

export class GenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerateError';
  }
}

function compile(pattern: string, field: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    throw new GenerateError(`${field} 不是合法的正则: ${pattern}（${(error as Error).message}）`);
  }
}

export function matchesFilter(node: EvaluableNode, filter: NodeFilter): boolean {
  if (filter.keyword) {
    const needle = filter.keyword.toLowerCase();
    const haystack = `${node.name}\n${node.config.server}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (filter.namePattern && !compile(filter.namePattern, 'namePattern').test(node.name)) return false;
  if (filter.excludePattern && compile(filter.excludePattern, 'excludePattern').test(node.name)) return false;

  if (filter.types?.length && !filter.types.includes(node.config.type)) return false;

  const tagIds = node.tagIds ?? [];
  if (filter.tagIds?.length) {
    const hit =
      filter.tagMode === 'all'
        ? filter.tagIds.every((id) => tagIds.includes(id))
        : filter.tagIds.some((id) => tagIds.includes(id));
    if (!hit) return false;
  }
  if (filter.excludeTagIds?.length && filter.excludeTagIds.some((id) => tagIds.includes(id))) {
    return false;
  }

  // 没测过的节点一律不满足「存活」和「延迟上限」——宁可漏掉也不要把死节点塞进订阅
  if (filter.onlyAlive && node.lastStatus !== 'ok') return false;
  if (filter.maxDelayMs !== undefined) {
    if (node.lastStatus !== 'ok') return false;
    if (node.lastDelayMs === null || node.lastDelayMs === undefined) return false;
    if (node.lastDelayMs > filter.maxDelayMs) return false;
  }

  return true;
}

export function filterNodes(nodes: readonly EvaluableNode[], filter: NodeFilter): EvaluableNode[] {
  return nodes.filter((node) => matchesFilter(node, filter));
}

/** 按 id 列表取节点，顺序跟着 ids 走，找不到的直接跳过 */
function pickByIds(nodes: readonly EvaluableNode[], ids: readonly string[]): EvaluableNode[] {
  const index = new Map(nodes.map((node) => [node.id, node]));
  const out: EvaluableNode[] = [];
  for (const id of ids) {
    const node = index.get(id);
    if (node) out.push(node);
  }
  return out;
}

/** 策略组里的节点来源求值 */
export function selectNodes(
  nodes: readonly EvaluableNode[],
  source: GroupNodeSource,
): EvaluableNode[] {
  switch (source.mode) {
    case 'all':
      return [...nodes];
    case 'none':
      return [];
    case 'filter':
      return filterNodes(nodes, source.filter);
    case 'nodeIds':
      return pickByIds(nodes, source.ids);
  }
}

/** 订阅的节点选择求值 */
export function resolveSelection(
  nodes: readonly EvaluableNode[],
  selection: NodeSelection,
): EvaluableNode[] {
  return selection.mode === 'manual'
    ? pickByIds(nodes, selection.nodeIds)
    : filterNodes(nodes, selection.filter);
}

/**
 * Clash 要求 proxies 和 proxy-groups 里的名字全局唯一，
 * 而用户完全可能给两个节点起同一个名字。重名的从第二个开始加后缀。
 */
export function uniquifyNames<T extends { name: string }>(items: readonly T[]): T[] {
  const used = new Set<string>();
  return items.map((item) => {
    let name = item.name.trim() || 'unnamed';
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name} #${n}`)) n++;
      name = `${name} #${n}`;
    }
    used.add(name);
    return { ...item, name };
  });
}
