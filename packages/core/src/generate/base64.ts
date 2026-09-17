import { nodeToUri } from '../protocols/index.js';
import { base64Encode } from '../protocols/shared.js';
import type { SubscriptionOptions } from '../types.js';
import { applyNodeOptions } from './clash.js';
import { GenerateError, type EvaluableNode } from './select.js';

export interface Base64GenerateInput {
  nodes: readonly EvaluableNode[];
  options: SubscriptionOptions;
}

export interface Base64GenerateResult {
  /** 已经 base64 过的内容，可直接作为响应体 */
  content: string;
  /** 未编码的原始链接列表，预览时给人看 */
  plain: string;
  proxyCount: number;
  /** 序列化失败的节点，不中断生成 */
  skipped: { name: string; reason: string }[];
}

/**
 * v2rayN / Shadowrocket 这类客户端吃的格式：节点链接一行一条，整体 base64。
 * 不带任何规则——这个格式本身就没有规则的位置。
 */
export function generateBase64Subscription(input: Base64GenerateInput): Base64GenerateResult {
  const nodes = applyNodeOptions(input.nodes, input.options);
  if (nodes.length === 0) {
    throw new GenerateError('这条订阅当前一个节点都没有');
  }

  const uris: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const node of nodes) {
    try {
      uris.push(nodeToUri({ name: node.name, config: node.config }));
    } catch (error) {
      // 单个节点序列化失败不该让整条订阅挂掉
      skipped.push({ name: node.name, reason: (error as Error).message });
    }
  }

  if (uris.length === 0) {
    throw new GenerateError('所有节点都无法序列化成链接');
  }

  const plain = uris.join('\n');
  return { content: base64Encode(plain), plain, proxyCount: uris.length, skipped };
}
