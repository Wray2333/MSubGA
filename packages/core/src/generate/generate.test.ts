import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { BUILTIN_PROFILES, BUILTIN_RULESETS } from '../presets/index.js';
import { parseNodeUri } from '../protocols/index.js';
import { base64Decode } from '../protocols/shared.js';
import { ruleEntrySchema } from '../types.js';
import type { RuleProfileDefinition, RulesetRecord, SubscriptionOptions } from '../types.js';
import { generateBase64Subscription } from './base64.js';
import { generateClashConfig } from './clash.js';
import type { EvaluableNode } from './select.js';
import { hasErrors, validateProfile, validateRulePayload } from './validate.js';

const defaultOptions: SubscriptionOptions = {
  sortByDelay: false,
  forceUdp: false,
  forceSkipCertVerify: false,
  updateIntervalHours: 24,
};

function node(id: string, name: string, uri: string, extra: Partial<EvaluableNode> = {}): EvaluableNode {
  return { id, name, config: parseNodeUri(uri).config, tagIds: [], ...extra };
}

const sampleNodes: EvaluableNode[] = [
  node('n1', '香港 01', 'vless://u1@hk.example.com:443?encryption=none&security=tls&sni=hk.example.com#x', {
    lastDelayMs: 120,
    lastStatus: 'ok',
    tagIds: ['tag-hk'],
  }),
  node('n2', '日本 01', 'trojan://pw@jp.example.com:443?sni=jp.example.com#x', {
    lastDelayMs: 80,
    lastStatus: 'ok',
    tagIds: ['tag-jp'],
  }),
  node('n3', '落地机', 'socks5://user:pass@1.2.3.4:1080#x', {
    lastStatus: 'timeout',
    tagIds: [],
  }),
];

const rulesets = [...BUILTIN_RULESETS];
const rulesetIds = new Set(rulesets.map((r) => r.id));

describe('内置预置', () => {
  it.each(BUILTIN_PROFILES.map((p) => [p.name, p] as const))('模板「%s」自身校验无错', (_name, profile) => {
    const issues = validateProfile(profile.definition, { rulesetIds, nodes: sampleNodes });
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it.each(BUILTIN_PROFILES.map((p) => [p.name, p] as const))('模板「%s」能生成合法 YAML', (_name, profile) => {
    const { yaml, proxyCount } = generateClashConfig({
      nodes: sampleNodes,
      profile: profile.definition,
      rulesets,
      options: defaultOptions,
      title: profile.name,
    });
    expect(proxyCount).toBe(3);

    const doc = parse(yaml) as Record<string, any>;
    expect(doc['proxies']).toHaveLength(3);
    expect(doc['rules'].at(-1)).toMatch(/^MATCH,/);
    expect(doc['mode']).toBe('rule');
    expect(doc['dns']['enhanced-mode']).toBe('fake-ip');

    // 每个 proxy-group 的成员必须都能在 proxies / 其他组 / 内置出口里找到
    const known = new Set<string>([
      ...doc['proxies'].map((p: { name: string }) => p.name),
      ...doc['proxy-groups'].map((g: { name: string }) => g.name),
      'DIRECT',
      'REJECT',
      'PASS',
      'COMPATIBLE',
    ]);
    for (const group of doc['proxy-groups']) {
      expect(group.proxies.length).toBeGreaterThan(0);
      for (const member of group.proxies) expect(known).toContain(member);
    }

    // 每条 RULE-SET 引用的 provider 必须真的定义了
    const providers = new Set(Object.keys(doc['rule-providers'] ?? {}));
    for (const rule of doc['rules'] as string[]) {
      if (rule.startsWith('RULE-SET,')) expect(providers).toContain(rule.split(',')[1]);
    }
  });

  it('全球直连组把 DIRECT 排在第一位', () => {
    const profile = BUILTIN_PROFILES.find((p) => p.id === 'profile-rules')!;
    const { yaml } = generateClashConfig({
      nodes: sampleNodes,
      profile: profile.definition,
      rulesets,
      options: defaultOptions,
    });
    const doc = parse(yaml) as Record<string, any>;
    const direct = doc['proxy-groups'].find((g: { name: string }) => g.name === '🎯 全球直连');
    expect(direct.proxies[0]).toBe('DIRECT');
  });

  it('同一个规则集被多条规则引用时只注册一次 provider', () => {
    const profile = BUILTIN_PROFILES.find((p) => p.id === 'profile-rules')!;
    const { yaml } = generateClashConfig({
      nodes: sampleNodes,
      profile: profile.definition,
      rulesets,
      options: defaultOptions,
    });
    const doc = parse(yaml) as Record<string, any>;
    const referenced = (doc['rules'] as string[])
      .filter((r) => r.startsWith('RULE-SET,'))
      .map((r) => r.split(',')[1]);
    expect(new Set(referenced).size).toBe(Object.keys(doc['rule-providers']).length);
  });
});

/* -------------------------------------------------------------------------- */

const minimalProfile = (overrides: Partial<RuleProfileDefinition> = {}): RuleProfileDefinition => ({
  general: BUILTIN_PROFILES[0]!.definition.general,
  groups: [
    { key: 'PROXY', name: '代理', type: 'select', nodes: { mode: 'all' }, include: [], extra: [] },
  ],
  rules: [{ type: 'match', target: 'PROXY' }],
  ...overrides,
});

describe('校验器', () => {
  it('缺少 MATCH 要报错', () => {
    const issues = validateProfile(minimalProfile({ rules: [] }), { rulesetIds });
    expect(issues.some((i) => i.message.includes('MATCH'))).toBe(true);
    expect(hasErrors(issues)).toBe(true);
  });

  it('MATCH 不在最后要报错', () => {
    const issues = validateProfile(
      minimalProfile({
        rules: [
          { type: 'match', target: 'PROXY' },
          { type: 'literal', matcher: 'DOMAIN', payload: 'a.com', target: 'PROXY' },
        ],
      }),
      { rulesetIds },
    );
    expect(issues.some((i) => i.message.includes('最后一条'))).toBe(true);
  });

  it('规则指向不存在的组要报错', () => {
    const issues = validateProfile(
      minimalProfile({ rules: [{ type: 'match', target: 'NOPE' }] }),
      { rulesetIds },
    );
    expect(issues.some((i) => i.message.includes('不存在的策略组'))).toBe(true);
  });

  it('引用已删除的规则集要报错', () => {
    const issues = validateProfile(
      minimalProfile({
        rules: [
          { type: 'ruleset', rulesetId: 'rs-gone', target: 'PROXY' },
          { type: 'match', target: 'PROXY' },
        ],
      }),
      { rulesetIds },
    );
    expect(issues.some((i) => i.message.includes('已被删除的规则集'))).toBe(true);
  });

  it('策略组循环引用要报错', () => {
    const issues = validateProfile(
      minimalProfile({
        groups: [
          { key: 'A', name: 'A', type: 'select', nodes: { mode: 'none' }, include: ['B'], extra: [] },
          { key: 'B', name: 'B', type: 'select', nodes: { mode: 'none' }, include: ['A'], extra: [] },
        ],
        rules: [{ type: 'match', target: 'A' }],
      }),
      { rulesetIds },
    );
    expect(issues.some((i) => i.message.includes('循环引用'))).toBe(true);
  });

  it('组名重复要报错（Clash 要求全局唯一）', () => {
    const issues = validateProfile(
      minimalProfile({
        groups: [
          { key: 'A', name: '同名', type: 'select', nodes: { mode: 'all' }, include: [], extra: [] },
          { key: 'B', name: '同名', type: 'select', nodes: { mode: 'all' }, include: [], extra: [] },
        ],
        rules: [{ type: 'match', target: 'A' }],
      }),
      { rulesetIds },
    );
    expect(issues.some((i) => i.message.includes('名称重复'))).toBe(true);
  });

  it('空策略组要报错', () => {
    const issues = validateProfile(
      minimalProfile({
        groups: [
          { key: 'PROXY', name: '空组', type: 'select', nodes: { mode: 'none' }, include: [], extra: [] },
        ],
      }),
      { rulesetIds, nodes: sampleNodes },
    );
    expect(issues.some((i) => i.message.includes('一个成员都没有'))).toBe(true);
  });

  it('校验不过时生成器直接拒绝出配置', () => {
    expect(() =>
      generateClashConfig({
        nodes: sampleNodes,
        profile: minimalProfile({ rules: [] }),
        rulesets,
        options: defaultOptions,
      }),
    ).toThrowError(/校验不通过/);
  });
});

describe('订阅选项', () => {
  const profile = BUILTIN_PROFILES.find((p) => p.id === 'profile-global')!.definition;

  const gen = (options: Partial<SubscriptionOptions>) =>
    parse(
      generateClashConfig({
        nodes: sampleNodes,
        profile,
        rulesets,
        options: { ...defaultOptions, ...options },
      }).yaml,
    ) as Record<string, any>;

  it('按延迟排序时，没测过/超时的排最后', () => {
    const names = gen({ sortByDelay: true })['proxies'].map((p: { name: string }) => p.name);
    expect(names).toEqual(['日本 01', '香港 01', '落地机']);
  });

  it('名称前缀加到每个节点上，策略组成员也跟着变', () => {
    const doc = gen({ namePrefix: '[A] ' });
    expect(doc['proxies'][0].name).toBe('[A] 香港 01');
    expect(doc['proxy-groups'][0].proxies).toContain('[A] 香港 01');
  });

  it('强制 udp 只作用于支持 udp 的协议', () => {
    const proxies = gen({ forceUdp: true })['proxies'] as { type: string; udp?: boolean }[];
    expect(proxies.find((p) => p.type === 'vless')?.udp).toBe(true);
    expect(proxies.find((p) => p.type === 'socks5')?.udp).toBe(true);
  });

  it('强制跳过证书校验', () => {
    const proxies = gen({ forceSkipCertVerify: true })['proxies'] as Record<string, unknown>[];
    expect(proxies.find((p) => p['type'] === 'vless')?.['skip-cert-verify']).toBe(true);
  });

  it('重名节点自动加后缀，Clash 才不会拒绝加载', () => {
    const dup = [sampleNodes[0]!, { ...sampleNodes[1]!, name: '香港 01' }];
    const doc = parse(
      generateClashConfig({ nodes: dup, profile, rulesets, options: defaultOptions }).yaml,
    ) as Record<string, any>;
    expect(doc['proxies'].map((p: { name: string }) => p.name)).toEqual(['香港 01', '香港 01 #2']);
  });
});

describe('内联规则集', () => {
  const inline: RulesetRecord = {
    id: 'rs-custom',
    name: '我的规则',
    kind: 'inline',
    behavior: 'classical',
    format: 'text',
    content: ['DOMAIN-SUFFIX,example.com', '# 注释行', '', 'IP-CIDR,10.0.0.0/8'].join('\n'),
  };

  it('classical 内联规则展开成字面量规则，不产生 rule-provider', () => {
    const { yaml } = generateClashConfig({
      nodes: sampleNodes,
      profile: minimalProfile({
        rules: [
          { type: 'ruleset', rulesetId: 'rs-custom', target: 'PROXY' },
          { type: 'match', target: 'PROXY' },
        ],
      }),
      rulesets: [inline],
      options: defaultOptions,
    });
    const doc = parse(yaml) as Record<string, any>;
    expect(doc['rule-providers']).toBeUndefined();
    expect(doc['rules']).toEqual([
      'DOMAIN-SUFFIX,example.com,代理',
      'IP-CIDR,10.0.0.0/8,代理',
      'MATCH,代理',
    ]);
  });

  it('domain 行为下 +. 前缀转成 DOMAIN-SUFFIX', () => {
    const { yaml } = generateClashConfig({
      nodes: sampleNodes,
      profile: minimalProfile({
        rules: [
          { type: 'ruleset', rulesetId: 'rs-d', target: 'PROXY' },
          { type: 'match', target: 'PROXY' },
        ],
      }),
      rulesets: [{ ...inline, id: 'rs-d', behavior: 'domain', content: '+.a.com\nb.com' }],
      options: defaultOptions,
    });
    expect((parse(yaml) as Record<string, any>)['rules']).toEqual([
      'DOMAIN-SUFFIX,a.com,代理',
      'DOMAIN,b.com,代理',
      'MATCH,代理',
    ]);
  });

  it('ipcidr 行为下自动补 no-resolve', () => {
    const { yaml } = generateClashConfig({
      nodes: sampleNodes,
      profile: minimalProfile({
        rules: [
          { type: 'ruleset', rulesetId: 'rs-i', target: 'PROXY' },
          { type: 'match', target: 'PROXY' },
        ],
      }),
      rulesets: [{ ...inline, id: 'rs-i', behavior: 'ipcidr', content: '1.1.1.0/24\n2606:4700::/32' }],
      options: defaultOptions,
    });
    expect((parse(yaml) as Record<string, any>)['rules']).toEqual([
      'IP-CIDR,1.1.1.0/24,代理,no-resolve',
      'IP-CIDR6,2606:4700::/32,代理,no-resolve',
      'MATCH,代理',
    ]);
  });
});

describe('base64 订阅', () => {
  it('解码后是一行一条的节点链接，且能再被解析回来', () => {
    const result = generateBase64Subscription({ nodes: sampleNodes, options: defaultOptions });
    expect(result.proxyCount).toBe(3);
    expect(result.skipped).toEqual([]);

    const lines = base64Decode(result.content).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => parseNodeUri(line).config.type)).toEqual(['vless', 'trojan', 'socks5']);
    expect(parseNodeUri(lines[0]!).name).toBe('香港 01');
  });

  it('没有节点时报错而不是吐个空订阅', () => {
    expect(() => generateBase64Subscription({ nodes: [], options: defaultOptions })).toThrowError(
      /一个节点都没有/,
    );
  });
});

describe('rule-provider 的键', () => {
  const withRuleset = (rs: RulesetRecord) =>
    parse(
      generateClashConfig({
        nodes: sampleNodes,
        profile: minimalProfile({
          rules: [
            { type: 'ruleset', rulesetId: rs.id, target: 'PROXY' },
            { type: 'match', target: 'PROXY' },
          ],
        }),
        rulesets: [rs],
        options: defaultOptions,
      }).yaml,
    ) as Record<string, any>;

  const remote = (id: string, name: string): RulesetRecord => ({
    id,
    name,
    kind: 'remote',
    behavior: 'domain',
    format: 'mrs',
    url: 'https://example.com/x.mrs',
    content: null,
  });

  it('中文名原样当键，不再退化成 ruleset-xxx 这种看不懂的 slug', () => {
    const doc = withRuleset(remote('rs-cn-ip', '国内 IP'));
    expect(Object.keys(doc['rule-providers'])).toEqual(['国内 IP']);
    expect(doc['rules'][0]).toBe('RULE-SET,国内 IP,代理');
  });

  it('path 用 id 而不是名字，磁盘上不会出现非 ASCII 文件名', () => {
    const doc = withRuleset(remote('rs-cn-ip', '国内 IP'));
    expect(doc['rule-providers']['国内 IP'].path).toBe('./ruleset/rs-cn-ip.mrs');
  });

  it('名字里的逗号必须处理掉，否则 RULE-SET 那一行会被切错位', () => {
    const doc = withRuleset(remote('rs-x', '国内,国外'));
    const rule = doc['rules'][0] as string;
    // 切出来必须正好是 RULE-SET / 键 / 目标 三段
    expect(rule.split(',')).toHaveLength(3);
    expect(rule.split(',')[2]).toBe('代理');
    expect(Object.keys(doc['rule-providers'])[0]).toBe('国内 国外');
  });

  it('两个规则集重名时后者加 id 后缀，不会互相覆盖', () => {
    const doc = parse(
      generateClashConfig({
        nodes: sampleNodes,
        profile: minimalProfile({
          rules: [
            { type: 'ruleset', rulesetId: 'a', target: 'PROXY' },
            { type: 'ruleset', rulesetId: 'b', target: 'PROXY' },
            { type: 'match', target: 'PROXY' },
          ],
        }),
        rulesets: [remote('a', '同名'), remote('b', '同名')],
        options: defaultOptions,
      }).yaml,
    ) as Record<string, any>;
    expect(Object.keys(doc['rule-providers'])).toEqual(['同名', '同名 (b)']);
  });
});

describe('规则的 matcher + payload 结构', () => {
  const withRules = (rules: RuleProfileDefinition['rules']) =>
    parse(
      generateClashConfig({
        nodes: sampleNodes,
        profile: minimalProfile({ rules }),
        rulesets,
        options: defaultOptions,
      }).yaml,
    ) as Record<string, any>;

  it('拼成 匹配类型,内容,目标', () => {
    const doc = withRules([
      { type: 'literal', matcher: 'DOMAIN-SUFFIX', payload: 'example.com', target: 'PROXY' },
      { type: 'match', target: 'PROXY' },
    ]);
    expect(doc['rules'][0]).toBe('DOMAIN-SUFFIX,example.com,代理');
  });

  it('IP 类规则默认补 no-resolve，非 IP 类一定不补', () => {
    const doc = withRules([
      { type: 'literal', matcher: 'GEOIP', payload: 'CN', target: 'PROXY' },
      { type: 'literal', matcher: 'IP-CIDR', payload: '10.0.0.0/8', target: 'PROXY' },
      { type: 'literal', matcher: 'GEOSITE', payload: 'cn', target: 'PROXY' },
      { type: 'literal', matcher: 'DOMAIN', payload: 'a.com', target: 'PROXY' },
      { type: 'match', target: 'PROXY' },
    ]);
    expect(doc['rules'][0]).toBe('GEOIP,CN,代理,no-resolve');
    expect(doc['rules'][1]).toBe('IP-CIDR,10.0.0.0/8,代理,no-resolve');
    // GEOSITE 和 DOMAIN 是域名匹配，带 no-resolve 内核会报错
    expect(doc['rules'][2]).toBe('GEOSITE,cn,代理');
    expect(doc['rules'][3]).toBe('DOMAIN,a.com,代理');
  });

  it('IP 类规则可以显式关掉 no-resolve', () => {
    const doc = withRules([
      { type: 'literal', matcher: 'GEOIP', payload: 'CN', target: 'PROXY', noResolve: false },
      { type: 'match', target: 'PROXY' },
    ]);
    expect(doc['rules'][0]).toBe('GEOIP,CN,代理');
  });
});

describe('老结构的规则要能继续加载', () => {
  it('把 value 字符串拆成 matcher + payload', () => {
    const parsed = ruleEntrySchema.parse({
      type: 'literal',
      value: 'DOMAIN-SUFFIX,example.com',
      target: 'PROXY',
    });
    expect(parsed).toEqual({
      type: 'literal',
      matcher: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      target: 'PROXY',
    });
  });

  it('独立的 geoip / geosite 类型折叠成 matcher', () => {
    expect(ruleEntrySchema.parse({ type: 'geoip', value: 'CN', target: 'X' })).toMatchObject({
      type: 'literal',
      matcher: 'GEOIP',
      payload: 'CN',
    });
    expect(ruleEntrySchema.parse({ type: 'geosite', value: 'cn', target: 'X' })).toMatchObject({
      type: 'literal',
      matcher: 'GEOSITE',
      payload: 'cn',
    });
  });
});

describe('规则内容格式校验', () => {
  it.each([
    ['DOMAIN-SUFFIX', 'example.com', null],
    ['DOMAIN-SUFFIX', 'nodots', '域名至少要有一个点'],
    ['IP-CIDR', '10.0.0.0/8', null],
    ['IP-CIDR', '10.0.0.0', '要带掩码位，例如 192.168.1.0/24'],
    ['GEOIP', 'CN', null],
    ['GEOIP', '86', '国家代码是两位字母，如 CN'],
    ['DST-PORT', '443', null],
    ['DST-PORT', '1000-2000', null],
    ['DST-PORT', '2000-1000', '区间的起始值比结束值大'],
    ['DST-PORT', '70000', '端口要在 1-65535 之间'],
    ['NETWORK', 'udp', null],
    ['NETWORK', 'quic', '只能填 tcp 或 udp'],
    ['IP-ASN', '13335', null],
    ['IP-ASN', 'AS13335', 'ASN 只能是数字'],
  ] as const)('%s / %s', (matcher, payload, expected) => {
    expect(validateRulePayload(matcher, payload)).toBe(expected);
  });

  it('内容里带逗号要拦住——它会把规则行切错位', () => {
    expect(validateRulePayload('DOMAIN', 'a.com,b.com')).toMatch(/逗号/);
  });

  it('正则写错要报出来', () => {
    expect(validateRulePayload('DOMAIN-REGEX', '[unclosed')).toMatch(/正则不合法/);
    expect(validateRulePayload('DOMAIN-REGEX', '^.*\.example\.com$')).toBeNull();
  });

  it('格式错的规则会让整个模板校验不通过', () => {
    const issues = validateProfile(
      minimalProfile({
        rules: [
          { type: 'literal', matcher: 'NETWORK', payload: 'quic', target: 'PROXY' },
          { type: 'match', target: 'PROXY' },
        ],
      }),
      { rulesetIds },
    );
    expect(issues.some((issue) => issue.message.includes('只能填 tcp 或 udp'))).toBe(true);
  });
});

describe('内置模板必须覆盖内网地址', () => {
  it.each(BUILTIN_PROFILES.map((p) => [p.name, p] as const))(
    '模板「%s」把局域网 IP 段放在第一条',
    (_name, profile) => {
      // 直连 IP 没有域名可匹配，域名类规则全都落空。
      // 少了这条，访问 192.168.x / 172.16-31.x / 10.x 会一路掉到 MATCH 走代理。
      expect(profile.definition.rules[0]).toMatchObject({
        type: 'ruleset',
        rulesetId: 'ls-lancidr',
      });
    },
  );

  it.each(BUILTIN_PROFILES.map((p) => [p.name, p] as const))(
    '模板「%s」生成出来的第一条规则是局域网直连',
    (_name, profile) => {
      const doc = parse(
        generateClashConfig({
          nodes: sampleNodes,
          profile: profile.definition,
          rulesets,
          options: defaultOptions,
        }).yaml,
      ) as Record<string, any>;

      const rule = doc['rules'][0] as string;
      expect(rule).toMatch(/^RULE-SET,局域网 IP,/);
      // IP 类规则要带 no-resolve，否则每个域名都要先解析一次才能判断
      expect(rule.endsWith(',no-resolve')).toBe(true);

      // 目标必须是直连，不能是代理组
      const target = rule.split(',')[2];
      const group = doc['proxy-groups'].find((g: { name: string }) => g.name === target);
      const members: string[] = group ? group.proxies : [target];
      expect(members[0]).toBe('DIRECT');
    },
  );

  it('局域网规则集按 IP 段匹配，内网域名另有一条按域名匹配', () => {
    const lan = BUILTIN_RULESETS.find((item) => item.id === 'ls-lancidr');
    expect(lan).toMatchObject({ behavior: 'ipcidr', kind: 'remote', format: 'yaml' });
    expect(lan?.url).toContain('/lancidr.txt');

    const priv = BUILTIN_RULESETS.find((item) => item.id === 'ls-private');
    expect(priv).toMatchObject({ behavior: 'domain' });
  });

  it('所有内置规则集都指向 Loyalsoldier 的 release 分支', () => {
    for (const ruleset of BUILTIN_RULESETS) {
      expect(ruleset.kind).toBe('remote');
      expect(ruleset.format).toBe('yaml');
      expect(ruleset.url).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/Loyalsoldier\/clash-rules\/release\/[\w-]+\.txt$/,
      );
    }
  });

  it('模板引用的规则集必须都存在', () => {
    const ids = new Set(BUILTIN_RULESETS.map((item) => item.id));
    for (const profile of BUILTIN_PROFILES) {
      for (const rule of profile.definition.rules) {
        if (rule.type === 'ruleset') expect(ids).toContain(rule.rulesetId);
      }
    }
  });
});

describe('规则集地址改写 (rulesetUrl)', () => {
  const profile = BUILTIN_PROFILES.find((p) => p.definition.rules.some((r) => r.type === 'ruleset'))!;

  function providersOf(input: Partial<Parameters<typeof generateClashConfig>[0]> = {}) {
    const { yaml } = generateClashConfig({
      nodes: sampleNodes,
      profile: profile.definition,
      rulesets,
      options: defaultOptions,
      ...input,
    });
    return (parse(yaml) as Record<string, any>)['rule-providers'] as Record<string, any>;
  }

  it('不传时用规则集自己的 URL，且不写 proxy', () => {
    const providers = providersOf();
    const urls = Object.values(providers).map((p) => p.url as string);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('https://raw.githubusercontent.com/'))).toBe(true);
    // 指向上游时不能钉 DIRECT，否则本来靠代理才拉得到的人会被改坏
    expect(Object.values(providers).every((p) => p.proxy === undefined)).toBe(true);
  });

  it('传了就全部改写成服务端地址', () => {
    const providers = providersOf({
      rulesetUrl: (rs) => `https://msubga.example.com/sub/TOKEN/rules/${rs.id}.${rs.format}`,
    });
    const urls = Object.values(providers).map((p) => p.url as string);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('https://msubga.example.com/sub/TOKEN/rules/'))).toBe(true);
    // 一个都不许漏，漏一个客户端就卡在那一条上
    expect(urls.some((u) => u.includes('githubusercontent'))).toBe(false);
  });

  it('返回 undefined 的那个退回原 URL，其余照常改写', () => {
    const first = rulesets.find((rs) => rs.kind === 'remote')!;
    const providers = providersOf({
      rulesetUrl: (rs) => (rs.id === first.id ? undefined : `https://cache.local/${rs.id}`),
    });
    const entry = Object.values(providers).find((p) => p.url === first.url);
    expect(entry).toBeDefined();
    expect(Object.values(providers).some((p) => (p.url as string).startsWith('https://cache.local/'))).toBe(
      true,
    );
  });

  /*
   * 这条是实测逼出来的：只改 url 不够。内核拉 provider 也要过一遍自己的规则，
   * 而那时规则还没加载，请求全落到 MATCH 被丢进代理组——正好是还没就绪的链路。
   * 实测 14 个 provider 全部 `pull error: EOF`，加上 proxy: DIRECT 后
   * 34 万条规则一次加载完。
   */
  it('可以给 provider 指定出口，用来绕开「拉规则要先有规则」的死循环', () => {
    const providers = providersOf({
      rulesetUrl: (rs) => ({ url: `https://msubga.example.com/rules/${rs.id}`, proxy: 'DIRECT' }),
    });
    const entries = Object.values(providers);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((p) => p.proxy === 'DIRECT')).toBe(true);
    expect(entries.every((p) => (p.url as string).startsWith('https://msubga.example.com/'))).toBe(true);
  });

  it('只给 url 不给 proxy 时不写 proxy 键', () => {
    const providers = providersOf({
      rulesetUrl: (rs) => ({ url: `https://cache.local/${rs.id}` }),
    });
    expect(Object.values(providers).every((p) => !('proxy' in p))).toBe(true);
  });

  it('behavior / format / path 不受改写影响', () => {
    const before = providersOf();
    const after = providersOf({ rulesetUrl: (rs) => `https://cache.local/${rs.id}` });
    for (const [key, value] of Object.entries(before)) {
      expect(after[key].behavior).toBe(value.behavior);
      expect(after[key].format).toBe(value.format);
      expect(after[key].path).toBe(value.path);
      expect(after[key].interval).toBe(value.interval);
    }
  });
});
