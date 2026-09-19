import {
  GenerateError,
  generateBase64Subscription,
  generateClashConfig,
  rulesetExtension,
  type RulesetRecord,
  type RulesetSource,
  type SubTarget,
} from '@msubga/core';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ruleProfiles, rulesets, type SubscriptionRow } from '../db/schema.js';
import { resolveSubscriptionNodes } from './nodeService.js';
import { getSetting, isRulesetProxyEnabled, SETTING_KEYS } from './settings.js';

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

/**
 * 把 rule-provider 的地址改写到本站的 /sub/:token/rules/ 出口。
 *
 * 同时把 proxy 钉成 DIRECT。这一条是必须的：内核拉 provider 也要过一遍自己的规则，
 * 而那时候规则恰恰还没加载，请求全落到 MATCH 上被丢进代理组——正好是还没就绪的
 * 那条链路，结果 14 个 provider 全部 pull error。客户端既然能直连下载订阅，
 * 就一定能直连拿到规则。
 *
 * 拼不出绝对地址（没设站点地址、也没有请求来源）时返回 undefined，
 * 生成器会退回规则集自己的 URL——总比写一个客户端访问不了的相对路径强。
 */
function rulesetUrlResolver(
  row: SubscriptionRow,
  requestOrigin?: string,
): ((ruleset: RulesetRecord) => RulesetSource | undefined) | undefined {
  if (!isRulesetProxyEnabled()) return undefined;

  const base = (getSetting(SETTING_KEYS.siteBaseUrl) || requestOrigin || '').replace(/\/+$/, '');
  if (!base) return undefined;

  return (ruleset) =>
    ruleset.kind === 'remote' && ruleset.url
      ? {
          url: `${base}/sub/${row.token}/rules/${encodeURIComponent(ruleset.id)}.${rulesetExtension(ruleset.format)}`,
          proxy: 'DIRECT',
        }
      : undefined;
}

export interface RenderOptions {
  /** 没设站点地址时用它兜底拼 rule-provider 的绝对地址 */
  requestOrigin?: string;
}

export function renderSubscription(
  row: SubscriptionRow,
  target: SubTarget,
  renderOptions: RenderOptions = {},
): RenderedSubscription {
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
    rulesetUrl: rulesetUrlResolver(row, renderOptions.requestOrigin),
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
