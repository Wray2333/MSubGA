import type { RulesetBehavior, RulesetRecord } from '../types.js';

/**
 * 内置规则集来自 Loyalsoldier/clash-rules。
 * 文件在 release 分支，内容是 YAML 的 payload 列表，所以 format 统一是 yaml。
 *
 * 注意体积：这套是文本格式，reject 5.4MB、direct 2.3MB，客户端首次加载要拉将近 9MB。
 * 换成二进制的 .mrs 只要几十 KB，但那套没有这么完整的国内分流数据。
 */
const BASE = 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release';

function rule(
  id: string,
  name: string,
  file: string,
  behavior: RulesetBehavior,
  description: string,
): RulesetRecord {
  return {
    id,
    name,
    description,
    kind: 'remote',
    behavior,
    format: 'yaml',
    url: `${BASE}/${file}.txt`,
    content: null,
  };
}

export const BUILTIN_RULESETS: readonly RulesetRecord[] = [
  // ——— 必须直连的 ———
  rule('ls-lancidr', '局域网 IP', 'lancidr', 'ipcidr', 'RFC1918 内网段、回环、链路本地'),
  rule('ls-private', '内网域名', 'private', 'domain', '路由器后台等内网域名'),
  rule('ls-applications', '本地应用', 'applications', 'classical', '按进程名匹配，如 frpc、syncthing'),

  // ——— 拦截 ———
  rule('ls-reject', '广告拦截', 'reject', 'domain', '广告与追踪域名，体积最大的一份'),

  // ——— 按服务 ———
  rule('ls-apple', 'Apple', 'apple', 'domain', '苹果服务域名'),
  rule('ls-icloud', 'iCloud', 'icloud', 'domain', 'iCloud 相关域名'),
  rule('ls-google', 'Google', 'google', 'domain', 'Google 全家桶'),
  rule('ls-telegramcidr', 'Telegram IP', 'telegramcidr', 'ipcidr', 'Telegram 的 IP 段'),

  // ——— 走代理 ———
  rule('ls-proxy', '代理域名', 'proxy', 'domain', '常见需要代理的域名合集'),
  rule('ls-gfw', 'GFW 列表', 'gfw', 'domain', '被墙域名列表'),
  rule('ls-greatfire', 'GreatFire', 'greatfire', 'domain', 'GreatFire 收录的被封域名'),
  rule('ls-tld-not-cn', '非中国域名', 'tld-not-cn', 'domain', '非 .cn 顶级域，兜底走代理'),

  // ——— 国内直连 ———
  rule('ls-direct', '国内域名', 'direct', 'domain', '中国大陆域名合集'),
  rule('ls-cncidr', '国内 IP', 'cncidr', 'ipcidr', '中国大陆 IP 段'),
];

export const BUILTIN_RULESET_IDS: ReadonlySet<string> = new Set(
  BUILTIN_RULESETS.map((rs) => rs.id),
);
