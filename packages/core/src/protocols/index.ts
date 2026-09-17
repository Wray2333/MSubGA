import type { NodeType, ParsedNode, ProxyConfig } from '../types.js';
import { anytlsAdapter } from './anytls.js';
import { hysteria2Adapter } from './hysteria2.js';
import { httpAdapter, socks5Adapter } from './simple.js';
import { shadowsocksAdapter } from './shadowsocks.js';
import { ParseError, fail, type ClashProxy, type ProtocolAdapter } from './shared.js';
import { trojanAdapter } from './trojan.js';
import { tuicAdapter } from './tuic.js';
import { vlessAdapter } from './vless.js';
import { vmessAdapter } from './vmess.js';

export const adapters: readonly ProtocolAdapter[] = [
  vlessAdapter,
  vmessAdapter,
  trojanAdapter,
  shadowsocksAdapter,
  hysteria2Adapter,
  tuicAdapter,
  anytlsAdapter,
  httpAdapter,
  socks5Adapter,
];

const bySchemeMap = new Map<string, ProtocolAdapter>();
const byTypeMap = new Map<NodeType, ProtocolAdapter>();
for (const adapter of adapters) {
  byTypeMap.set(adapter.type, adapter);
  for (const scheme of adapter.schemes) bySchemeMap.set(scheme, adapter);
}

export const SUPPORTED_SCHEMES: readonly string[] = [...bySchemeMap.keys()].sort();

export function getAdapterByScheme(scheme: string): ProtocolAdapter | undefined {
  return bySchemeMap.get(scheme.toLowerCase());
}

export function getAdapter(type: NodeType): ProtocolAdapter {
  const adapter = byTypeMap.get(type);
  if (!adapter) throw new TypeError(`没有为协议 ${type} 注册适配器`);
  return adapter;
}

/** 从一行文本里取出 scheme，取不到返回 undefined */
export function schemeOf(uri: string): string | undefined {
  const at = uri.indexOf('://');
  if (at <= 0) return undefined;
  const scheme = uri.slice(0, at).toLowerCase();
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) ? scheme : undefined;
}

export function isSupportedUri(uri: string): boolean {
  const scheme = schemeOf(uri.trim());
  return scheme !== undefined && bySchemeMap.has(scheme);
}

/** 解析单条节点链接；解析不了抛 ParseError */
export function parseNodeUri(uri: string): ParsedNode {
  const trimmed = uri.trim();
  const scheme = schemeOf(trimmed);
  if (!scheme) fail('不是合法的节点链接', trimmed);
  const adapter = bySchemeMap.get(scheme);
  if (!adapter) fail(`暂不支持的协议: ${scheme}`, trimmed);
  return adapter.parseUri(trimmed);
}

export function nodeToUri(node: { name: string; config: ProxyConfig }): string {
  return getAdapter(node.config.type).toUri(node.name, node.config);
}

export function nodeToClash(node: { name: string; config: ProxyConfig }): ClashProxy {
  return getAdapter(node.config.type).toClash(node.name, node.config);
}

export { ParseError };
export type { ClashProxy, ProtocolAdapter };
export * from './shared.js';
