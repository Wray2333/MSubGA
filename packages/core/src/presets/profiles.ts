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

/** 直连组：DIRECT 必须排第一，否则客户端默认选中的是代理 */
const directGroup = (): ProxyGroupDef => ({
  key: 'CN',
  name: '🎯 全球直连',
  type: 'select',
  nodes: { mode: 'none' },
  include: ['PROXY'],
  extra: ['DIRECT'],
  extraFirst: true,
});

const rejectGroup = (): ProxyGroupDef => ({
  key: 'ADS',
  name: '🛑 广告拦截',
  type: 'select',
  nodes: { mode: 'none' },
  include: [],
  extra: ['REJECT', 'DIRECT'],
});

const rs = (rulesetId: string, target: string): RuleEntry => ({ type: 'ruleset', rulesetId, target });

/* -------------------------------------------------------------------------- */

const globalProxy: RuleProfileDefinition = {
  general,
  groups: [proxyGroup(), autoGroup()],
  rules: [rs('rs-private', 'DIRECT'), { type: 'match', target: 'PROXY' }],
};

const cnDirect: RuleProfileDefinition = {
  general,
  groups: [proxyGroup(), autoGroup(), rejectGroup(), directGroup()],
  rules: [
    rs('rs-ads', 'ADS'),
    rs('rs-private', 'CN'),
    rs('rs-cn-domain', 'CN'),
    rs('rs-cn-ip', 'CN'),
    { type: 'match', target: 'PROXY' },
  ],
};

const ruleBased: RuleProfileDefinition = {
  general,
  groups: [
    proxyGroup(),
    autoGroup(),
    serviceGroup('AI', '🤖 AI 服务'),
    serviceGroup('MEDIA', '🎬 国际媒体'),
    serviceGroup('TELEGRAM', '✈️ 电报消息'),
    serviceGroup('MICROSOFT', 'Ⓜ️ 微软服务'),
    serviceGroup('APPLE', '🍎 苹果服务'),
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
    rs('rs-ads', 'ADS'),
    rs('rs-private', 'CN'),
    rs('rs-openai', 'AI'),
    rs('rs-telegram', 'TELEGRAM'),
    rs('rs-youtube', 'MEDIA'),
    rs('rs-netflix', 'MEDIA'),
    rs('rs-spotify', 'MEDIA'),
    rs('rs-github', 'PROXY'),
    rs('rs-google', 'PROXY'),
    rs('rs-twitter', 'PROXY'),
    rs('rs-microsoft', 'MICROSOFT'),
    rs('rs-apple', 'APPLE'),
    rs('rs-cn-domain', 'CN'),
    rs('rs-cn-ip', 'CN'),
    { type: 'match', target: 'FINAL' },
  ],
};

export const BUILTIN_PROFILES: readonly RuleProfileRecord[] = [
  {
    id: 'profile-rules',
    name: '规则分流（推荐）',
    description: '按服务分流：广告拦截、AI、流媒体、微软苹果各自成组，国内直连，其余走代理',
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
