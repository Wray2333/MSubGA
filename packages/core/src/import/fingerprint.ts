import type { ProxyConfig } from '../types.js';

/** 递归排序对象 key，让语义相同的配置产生同一份 JSON */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) out[key] = canonicalize(item);
    return out;
  }
  return value;
}

/** FNV-1a 64 位。够短、好调试，也不会把密码明文写进索引列 */
function fnv1a64(input: string): string {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i) & 0xff);
    hash = (hash * prime) & mask;
    const high = input.charCodeAt(i) >> 8;
    if (high) {
      hash ^= BigInt(high);
      hash = (hash * prime) & mask;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * 节点指纹：对整份配置（不含名称）做规范化后哈希。
 * 任何一个配置字段变了就是另一个节点；名称改了不影响，
 * 所以重复导入同一批链接不会覆盖用户改过的名字。
 */
export function fingerprintConfig(config: ProxyConfig): string {
  return fnv1a64(JSON.stringify(canonicalize(config)));
}
