import type {
  ProfileGeneral,
  ProxyGroupDef,
  RuleEntry,
  RuleProfileDefinition,
  RuleProfileRecord,
} from '../types.js';

const TEST_URL = 'https://www.gstatic.com/generate_204';

const general: ProfileGeneral = {
  mode: 'rule',
  logLevel: 'info',
  mixedPort: 7890,
  allowLan: false,
  ipv6: false,
  unifiedDelay: true,
  tcpConcurrent: true,
  findProcessMode: 'strict',
  dnsEnabled: true,
};

/** 所有模板共用的两个基础组：手动选择 + 自动测速 */
const proxyGroup = (): ProxyGroupDef => ({
  key: 'PROXY',
  name: '🚀 节点选择',
  type: 'select',
  nodes: { mode: 'all' },
  include: ['AUTO'],
  extra: ['DIRECT'],
});

const autoGroup = (): ProxyGroupDef => ({
  key: 'AUTO',
  name: '♻️ 自动选择',
  type: 'url-test',
  nodes: { mode: 'all' },
  include: [],
  extra: [],
  url: TEST_URL,
  interval: 300,
  tolerance: 50,
  lazy: true,
});

/** 服务分流组：默认跟随 PROXY，也能单独切直连 */
const serviceGroup = (key: string, name: string): ProxyGroupDef => ({
  key,
  name,
  type: 'select',
  nodes: { mode: 'all' },
  include: ['PROXY', 'AUTO'],
  extra: ['DIRECT'],
});

/** 默认直连的服务组：DIRECT 必须排第一，否则客户端默认选中的是代理 */
const directFirstGroup = (key: string, name: string): ProxyGroupDef => ({
  key,
  name,
  type: 'select',
  nodes: { mode: 'none' },
  include: ['PROXY'],
  extra: ['DIRECT'],
  extraFirst: true,
});

const directGroup = (): ProxyGroupDef => directFirstGroup('CN', '🎯 全球直连');

const rejectGroup = (): ProxyGroupDef => ({
  key: 'ADS',
  name: '🛑 广告拦截',
  type: 'select',
  nodes: { mode: 'none' },
  include: [],
  extra: ['REJECT', 'DIRECT'],
});

const rs = (rulesetId: string, target: string): RuleEntry => ({ type: 'ruleset', rulesetId, target });

/**
 * 内网相关的规则，三个模板都要，而且必须排最前：
 * 直连 IP 没有域名可匹配，排在域名规则后面等于白排。
 */
const lanRules = (target: string): RuleEntry[] => [
  rs('ls-lancidr', target),
  rs('ls-private', target),
  rs('ls-applications', target),
];

/* -------------------------------------------------------------------------- */

const globalProxy: RuleProfileDefinition = {
  general,
  groups: [proxyGroup(), autoGroup()],
  rules: [...lanRules('DIRECT'), { type: 'match', target: 'PROXY' }],
};

const cnDirect: RuleProfileDefinition = {
  general,
  groups: [proxyGroup(), autoGroup(), rejectGroup(), directGroup()],
  rules: [
    ...lanRules('CN'),
    rs('ls-reject', 'ADS'),
    rs('ls-direct', 'CN'),
    rs('ls-cncidr', 'CN'),
    { type: 'match', target: 'PROXY' },
  ],
};

const ruleBased: RuleProfileDefinition = {
  general,
  groups: [
    proxyGroup(),
    autoGroup(),
    serviceGroup('TELEGRAM', '✈️ 电报消息'),
    serviceGroup('GOOGLE', '🔍 谷歌服务'),
    directFirstGroup('APPLE', '🍎 苹果服务'),
    rejectGroup(),
    directGroup(),
    {
      key: 'FINAL',
      name: '🐟 漏网之鱼',
      type: 'select',
      nodes: { mode: 'all' },
      include: ['PROXY', 'AUTO'],
      extra: ['DIRECT'],
    },
  ],
  rules: [
    ...lanRules('CN'),
    rs('ls-reject', 'ADS'),
    rs('ls-icloud', 'APPLE'),
    rs('ls-apple', 'APPLE'),
    rs('ls-google', 'GOOGLE'),
    rs('ls-telegramcidr', 'TELEGRAM'),
    rs('ls-proxy', 'PROXY'),
    rs('ls-gfw', 'PROXY'),
    rs('ls-greatfire', 'PROXY'),
    rs('ls-tld-not-cn', 'PROXY'),
    rs('ls-direct', 'CN'),
    rs('ls-cncidr', 'CN'),
    { type: 'match', target: 'FINAL' },
  ],
};

export const BUILTIN_PROFILES: readonly RuleProfileRecord[] = [
  {
    id: 'profile-rules',
    name: '规则分流（推荐）',
    description: 'Loyalsoldier 经典布局：广告拦截、苹果谷歌电报各自成组，国内直连，其余走代理',
    definition: ruleBased,
  },
  {
    id: 'profile-cn-direct',
    name: '国内直连 + 去广告',
    description: '只区分国内外：国内域名和 IP 直连，广告拒绝，其余全部走代理',
    definition: cnDirect,
  },
  {
    id: 'profile-global',
    name: '全局代理',
    description: '除内网外全部走代理，不做任何分流',
    definition: globalProxy,
  },
];
