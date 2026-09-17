import {
  GenerateError,
  generateBase64Subscription,
  generateClashConfig,
  type RulesetRecord,
  type SubTarget,
} from '@msubga/core';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ruleProfiles, rulesets, type SubscriptionRow } from '../db/schema.js';
import { resolveSubscriptionNodes } from './nodeService.js';

export interface RenderedSubscription {
  target: SubTarget;
  body: string;
  /** base64 订阅的未编码原文，预览时给人看 */
  plain?: string;
  contentType: string;
  filename: string;
  proxyCount: number;
}

/** 认得出 clash 系客户端的 UA，其余一律当通用客户端发 base64 */
const CLASH_UA = /clash|mihomo|meta|stash|verge|flclash|clashx|shadowrocket-clash/i;

export function pickTarget(row: SubscriptionRow, userAgent: string, explicit?: string): SubTarget {
  if (explicit === 'clash' || explicit === 'base64') return explicit;
  if (row.format === 'clash' || row.format === 'base64') return row.format;
  return CLASH_UA.test(userAgent) ? 'clash' : 'base64';
}

function loadRulesets(): RulesetRecord[] {
  return db
    .select()
    .from(rulesets)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      kind: row.kind,
      behavior: row.behavior,
      format: row.format,
      url: row.url,
      content: row.content,
    }));
}

export function renderSubscription(row: SubscriptionRow, target: SubTarget): RenderedSubscription {
  const nodes = resolveSubscriptionNodes(row.selection);

  if (target === 'base64') {
    const result = generateBase64Subscription({ nodes, options: row.options });
    return {
      target,
      body: result.content,
      plain: result.plain,
      contentType: 'text/plain; charset=utf-8',
      filename: `${row.name}.txt`,
      proxyCount: result.proxyCount,
    };
  }

  if (!row.profileId) {
    throw new GenerateError('这条订阅要输出 Clash 配置，但没有绑定规则模板');
  }
  const profile = db.select().from(ruleProfiles).where(eq(ruleProfiles.id, row.profileId)).get();
  if (!profile) throw new GenerateError('订阅绑定的规则模板已经被删掉了');

  const result = generateClashConfig({
    nodes,
    profile: profile.definition,
    rulesets: loadRulesets(),
    options: row.options,
    title: row.name,
  });

  return {
    target,
    body: result.yaml,
    contentType: 'text/yaml; charset=utf-8',
    filename: `${row.name}.yaml`,
    proxyCount: result.proxyCount,
  };
}

/** 中文文件名要用 RFC 5987 的形式，否则某些客户端会存成乱码 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
