import { stringify } from 'yaml';
import { nodeToClash, type ClashProxy } from '../protocols/index.js';
import { RULE_MATCHER_META } from '../types.js';
import type {
  ProxyConfig,
  RuleEntry,
  RulesetFormat,
  RuleProfileDefinition,
  RulesetRecord,
  SubscriptionOptions,
} from '../types.js';
import { GenerateError, selectNodes, uniquifyNames, type EvaluableNode } from './select.js';
import { formatIssues, hasErrors, validateProfile } from './validate.js';

/* -------------------------------------------------------------------------- */
/*                              节点侧的选项处理                                 */
/* -------------------------------------------------------------------------- */

const UDP_CAPABLE = new Set(['vless', 'vmess', 'trojan', 'ss', 'socks5', 'anytls']);

function delayRank(node: EvaluableNode): number {
  return node.lastStatus === 'ok' && typeof node.lastDelayMs === 'number'
    ? node.lastDelayMs
    : Number.MAX_SAFE_INTEGER;
}

/** 按订阅选项加工节点：排序、加前缀、强制 udp / 跳过证书校验 */
export function applyNodeOptions(
  nodes: readonly EvaluableNode[],
  options: SubscriptionOptions,
): EvaluableNode[] {
  let list = [...nodes];
  if (options.sortByDelay) {
    list = list.sort((a, b) => delayRank(a) - delayRank(b) || a.name.localeCompare(b.name));
  }

  const renamed = list.map((node) => {
    const config = structuredClone(node.config) as ProxyConfig;
    if (options.forceUdp && UDP_CAPABLE.has(config.type)) {
      (config as { udp?: boolean }).udp = true;
    }
    if (options.forceSkipCertVerify && 'tls' in config) {
      config.tls = { ...config.tls, skipCertVerify: true };
    }
    return {
      ...node,
      name: options.namePrefix ? `${options.namePrefix}${node.name}` : node.name,
      config,
    };
  });

  // Clash 要求名字全局唯一，重名的在这里打上后缀
  return uniquifyNames(renamed);
}

/* -------------------------------------------------------------------------- */
/*                                规则集 -> 规则                                */
/* -------------------------------------------------------------------------- */

/**
 * rule-provider 的键。mihomo 接受任意字符串作键，所以直接用规则集名，
 * 生成出来的 `RULE-SET,国内 IP,🎯 全球直连` 人看得懂。
 *
 * 唯一必须处理的是逗号：规则行本身是逗号分隔的，键里带逗号会把整行切错位。
 */
function providerKey(name: string, fallbackId: string): string {
  const cleaned = name
    .replace(/[,\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || `ruleset-${fallbackId}`;
}

/** provider 的 path 会落成磁盘文件名，用 id 而不是名字，避免非 ASCII 文件名在各平台上的差异 */
function providerPath(id: string, format: RulesetFormat): string {
  const ext = format === 'mrs' ? 'mrs' : format === 'yaml' ? 'yaml' : 'list';
  const safe = id.replace(/[^\w.-]+/g, '_');
  return `./ruleset/${safe}.${ext}`;
}

/** 内联规则集展开成一条条字面量规则。规则集不对外暴露 URL，只能这么塞进去 */
function expandInlineRuleset(ruleset: RulesetRecord, target: string): string[] {
  const lines = (ruleset.content ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line && !line.startsWith('#'));

  return lines.map((line) => {
    switch (ruleset.behavior) {
      case 'classical':
        // 已经是完整的规则前半段，补上目标即可
        return `${line},${target}`;
      case 'domain': {
        if (line.startsWith('+.')) return `DOMAIN-SUFFIX,${line.slice(2)},${target}`;
        if (line.startsWith('.')) return `DOMAIN-SUFFIX,${line.slice(1)},${target}`;
        return `DOMAIN,${line},${target}`;
      }
      case 'ipcidr': {
        const kind = line.includes(':') ? 'IP-CIDR6' : 'IP-CIDR';
        // IP 规则不加 no-resolve，内核会为每个域名先做一次 DNS 解析，拖慢首包
        return `${kind},${line},${target},no-resolve`;
      }
    }
  });
}

/* -------------------------------------------------------------------------- */
/*                                   DNS 预设                                  */
/* -------------------------------------------------------------------------- */

/**
 * 防泄露的 DNS 段：国内域名走国内 DoH，国外域名走国外 DoH。
 * proxy-server-nameserver 单独指定，避免代理服务器自己的域名走到国外 DNS 暴露行踪。
 */
export function defaultDns(ipv6: boolean): Record<string, unknown> {
  return {
    enable: true,
    ipv6,
    'prefer-h3': false,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter': [
      '*.lan',
      '*.local',
      '+.msftconnecttest.com',
      '+.msftncsi.com',
      'localhost.ptlogin2.qq.com',
      '+.srv.nintendo.net',
      '+.stun.playstation.net',
      '+.xboxlive.com',
    ],
    'default-nameserver': ['223.5.5.5', '119.29.29.29'],
    'proxy-server-nameserver': ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
    nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
    'nameserver-policy': {
      'geosite:cn,private': ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
      'geosite:geolocation-!cn': [
        'https://dns.cloudflare.com/dns-query',
        'https://dns.google/dns-query',
      ],
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                                  生成入口                                   */
/* -------------------------------------------------------------------------- */

export interface ClashGenerateInput {
  nodes: readonly EvaluableNode[];
  profile: RuleProfileDefinition;
  rulesets: readonly RulesetRecord[];
  options: SubscriptionOptions;
  /** 写进文件头注释，通常是订阅名 */
  title?: string;
  /** 跳过校验，只在明确知道自己在干什么时用 */
  skipValidation?: boolean;
}

export interface ClashGenerateResult {
  yaml: string;
  proxyCount: number;
}

function compactYaml(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function renderRule(
  rule: RuleEntry,
  target: string,
  rulesetById: ReadonlyMap<string, RulesetRecord>,
  ruleProviders: Record<string, unknown>,
  slugById: Map<string, string>,
): string[] {
  switch (rule.type) {
    case 'match':
      return [`MATCH,${target}`];
    case 'literal': {
      // no-resolve 只对 IP 类规则有意义，别的类型带上它内核会报错。
      // IP 类默认加，除非用户显式关掉——不加的话内核要为每个域名先做一次 DNS 解析。
      const ipLike = RULE_MATCHER_META[rule.matcher].ipLike;
      const noResolve = ipLike ? rule.noResolve !== false : false;
      return [`${rule.matcher},${rule.payload},${target}${noResolve ? ',no-resolve' : ''}`];
    }
    case 'ruleset': {
      const ruleset = rulesetById.get(rule.rulesetId);
      if (!ruleset) throw new GenerateError(`规则集 ${rule.rulesetId} 不存在`);
      if (ruleset.kind === 'inline') return expandInlineRuleset(ruleset, target);
      if (!ruleset.url) throw new GenerateError(`远程规则集「${ruleset.name}」没有填 URL`);

      // 同一个规则集被多条规则引用时只注册一次 provider
      let key = slugById.get(ruleset.id);
      if (!key) {
        key = providerKey(ruleset.name, ruleset.id);
        // 两个规则集重名时给后来的加上 id 后缀，否则后者会覆盖前者
        if (ruleProviders[key]) key = `${key} (${ruleset.id})`;
        slugById.set(ruleset.id, key);
        ruleProviders[key] = {
          type: 'http',
          behavior: ruleset.behavior,
          format: ruleset.format,
          url: ruleset.url,
          path: providerPath(ruleset.id, ruleset.format),
          interval: 86400,
        };
      }

      const noResolve = ruleset.behavior === 'ipcidr' && rule.noResolve !== false;
      return [`RULE-SET,${key},${target}${noResolve ? ',no-resolve' : ''}`];
    }
  }
}

export function generateClashConfig(input: ClashGenerateInput): ClashGenerateResult {
  const nodes = applyNodeOptions(input.nodes, input.options);
  const rulesetById = new Map(input.rulesets.map((rs) => [rs.id, rs]));

  if (!input.skipValidation) {
    const issues = validateProfile(input.profile, {
      rulesetIds: new Set(rulesetById.keys()),
      nodes,
    });
    if (hasErrors(issues)) {
      throw new GenerateError(`规则模板校验不通过，拒绝生成配置:\n${formatIssues(issues)}`);
    }
  }

  if (nodes.length === 0) {
    throw new GenerateError('这条订阅当前一个节点都没有，生成出来的配置无法使用');
  }

  const proxies: ClashProxy[] = nodes.map((node) =>
    nodeToClash({ name: node.name, config: node.config }),
  );

  const keyToName = new Map(input.profile.groups.map((group) => [group.key, group.name]));
  const resolveTarget = (target: string): string => keyToName.get(target) ?? target;

  const proxyGroups = input.profile.groups.map((group) =>
    compactYaml({
      name: group.name,
      type: group.type,
      proxies: group.extraFirst
        ? [
            ...group.extra,
            ...group.include.map(resolveTarget),
            ...selectNodes(nodes, group.nodes).map((node) => node.name),
          ]
        : [
            ...group.include.map(resolveTarget),
            ...selectNodes(nodes, group.nodes).map((node) => node.name),
            ...group.extra,
          ],
      url: group.url,
      interval: group.interval,
      tolerance: group.tolerance,
      lazy: group.lazy,
      strategy: group.strategy,
      icon: group.icon,
      hidden: group.hidden,
    }),
  );

  const ruleProviders: Record<string, unknown> = {};
  const slugById = new Map<string, string>();
  const rules: string[] = [];
  for (const rule of input.profile.rules) {
    rules.push(...renderRule(rule, resolveTarget(rule.target), rulesetById, ruleProviders, slugById));
  }

  const general = input.profile.general;
  const document = compactYaml({
    'mixed-port': general.mixedPort,
    'allow-lan': general.allowLan,
    mode: general.mode,
    'log-level': general.logLevel,
    ipv6: general.ipv6,
    'unified-delay': general.unifiedDelay,
    'tcp-concurrent': general.tcpConcurrent,
    'find-process-mode': general.findProcessMode,
    'global-client-fingerprint': general.globalClientFingerprint,
    profile: { 'store-selected': true, 'store-fake-ip': true },
    dns: general.dnsEnabled ? defaultDns(general.ipv6) : undefined,
    proxies,
    'proxy-groups': proxyGroups,
    'rule-providers': Object.keys(ruleProviders).length ? ruleProviders : undefined,
    rules,
  });

  const header =
    ['# 由 MSubGA 生成', input.title ? `# 订阅: ${input.title}` : '', `# 节点数: ${proxies.length}`]
      .filter(Boolean)
      .join('\n') + '\n';

  // lineWidth: 0 关掉折行，否则长 path / 长密码会被折断，客户端解析会出问题
  return { yaml: header + stringify(document, { lineWidth: 0 }), proxyCount: proxies.length };
}
