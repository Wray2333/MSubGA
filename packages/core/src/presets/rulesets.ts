import type { RulesetRecord } from '../types.js';

/**
 * 内置规则集全部指向 MetaCubeX/meta-rules-dat 的 .mrs 文件。
 * .mrs 是二进制格式，体积比 yaml 小一个数量级，mihomo 加载也快得多。
 */
const MRS_BASE = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo';

function geosite(id: string, name: string, file: string, description: string): RulesetRecord {
  return {
    id,
    name,
    description,
    kind: 'remote',
    behavior: 'domain',
    format: 'mrs',
    url: `${MRS_BASE}/geosite/${file}.mrs`,
    content: null,
  };
}

function geoip(id: string, name: string, file: string, description: string): RulesetRecord {
  return {
    id,
    name,
    description,
    kind: 'remote',
    behavior: 'ipcidr',
    format: 'mrs',
    url: `${MRS_BASE}/geoip/${file}.mrs`,
    content: null,
  };
}

export const BUILTIN_RULESETS: readonly RulesetRecord[] = [
  geosite('rs-ads', '广告拦截', 'category-ads-all', '常见广告与追踪域名合集'),
  geosite('rs-private', '私有网络', 'private', '内网域名，通常直连'),
  geosite('rs-cn-domain', '国内域名', 'cn', '中国大陆域名合集'),
  geoip('rs-cn-ip', '国内 IP', 'cn', '中国大陆 IP 段'),
  geosite('rs-google', 'Google', 'google', 'Google 全家桶'),
  geosite('rs-github', 'GitHub', 'github', 'GitHub 及其 CDN'),
  geosite('rs-telegram', 'Telegram', 'telegram', 'Telegram 域名'),
  geosite('rs-openai', 'OpenAI', 'openai', 'ChatGPT / OpenAI API'),
  geosite('rs-youtube', 'YouTube', 'youtube', 'YouTube 域名'),
  geosite('rs-netflix', 'Netflix', 'netflix', 'Netflix 域名'),
  geosite('rs-spotify', 'Spotify', 'spotify', 'Spotify 域名'),
  geosite('rs-twitter', 'X / Twitter', 'twitter', 'X（原 Twitter）域名'),
  geosite('rs-microsoft', 'Microsoft', 'microsoft', '微软服务与 Office'),
  geosite('rs-apple', 'Apple', 'apple', '苹果服务'),
  geosite('rs-games', '游戏平台', 'category-games', 'Steam / Epic / PSN 等'),
  geosite('rs-abroad', '海外域名', 'geolocation-!cn', '非中国大陆域名合集'),
];

export const BUILTIN_RULESET_IDS: ReadonlySet<string> = new Set(
  BUILTIN_RULESETS.map((rs) => rs.id),
);
