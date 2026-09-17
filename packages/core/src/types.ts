import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/*                                  协议类型                                   */
/* -------------------------------------------------------------------------- */

export const NODE_TYPES = [
  'vless',
  'vmess',
  'trojan',
  'ss',
  'hysteria2',
  'tuic',
  'anytls',
  'http',
  'socks5',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** 可以从 `host:port:user:pass` 这类纯文本推导出来的协议 */
export const PLAINTEXT_TYPES = ['socks5', 'http'] as const;
export type PlaintextType = (typeof PLAINTEXT_TYPES)[number];

/* -------------------------------------------------------------------------- */
/*                                 共用配置片段                                 */
/* -------------------------------------------------------------------------- */

/**
 * TLS 相关参数。对 hysteria2 / tuic / anytls 这类强制 TLS 的协议，`enabled` 恒为 true。
 * `fingerprint` 是 uTLS 指纹（chrome/firefox/safari/randomized），不是证书 pin。
 */
export const tlsOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  sni: z.string().optional(),
  alpn: z.array(z.string()).optional(),
  fingerprint: z.string().optional(),
  skipCertVerify: z.boolean().optional(),
  reality: z
    .object({
      publicKey: z.string(),
      shortId: z.string().optional(),
    })
    .optional(),
});
export type TlsOptions = z.infer<typeof tlsOptionsSchema>;

export const NETWORKS = ['tcp', 'ws', 'grpc', 'h2', 'http'] as const;
export type Network = (typeof NETWORKS)[number];

/** 传输层。用 network 作判别字段，避免 ws 参数和 grpc 参数混在一起。 */
export const transportSchema = z.discriminatedUnion('network', [
  z.object({ network: z.literal('tcp') }),
  z.object({
    network: z.literal('ws'),
    path: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    maxEarlyData: z.number().int().optional(),
    earlyDataHeaderName: z.string().optional(),
  }),
  z.object({
    network: z.literal('grpc'),
    serviceName: z.string().optional(),
  }),
  z.object({
    network: z.literal('h2'),
    host: z.array(z.string()).optional(),
    path: z.string().optional(),
  }),
  z.object({
    network: z.literal('http'),
    host: z.array(z.string()).optional(),
    path: z.array(z.string()).optional(),
    method: z.string().optional(),
  }),
]);
export type Transport = z.infer<typeof transportSchema>;

export const defaultTransport: Transport = { network: 'tcp' };
export const defaultTls = (): TlsOptions => ({ enabled: false });

const hostPort = {
  server: z.string().min(1),
  port: z.number().int().min(1).max(65535),
};

/* -------------------------------------------------------------------------- */
/*                                各协议配置定义                                */
/* -------------------------------------------------------------------------- */

export const vlessConfigSchema = z.object({
  type: z.literal('vless'),
  ...hostPort,
  uuid: z.string().min(1),
  /** xtls-rprx-vision 等；空字符串视为未设置 */
  flow: z.string().optional(),
  tls: tlsOptionsSchema,
  transport: transportSchema,
  udp: z.boolean().optional(),
  packetEncoding: z.enum(['none', 'packetaddr', 'xudp']).optional(),
});

export const vmessConfigSchema = z.object({
  type: z.literal('vmess'),
  ...hostPort,
  uuid: z.string().min(1),
  alterId: z.number().int().min(0).default(0),
  cipher: z.string().default('auto'),
  tls: tlsOptionsSchema,
  transport: transportSchema,
  udp: z.boolean().optional(),
  packetEncoding: z.enum(['none', 'packetaddr', 'xudp']).optional(),
});

export const trojanConfigSchema = z.object({
  type: z.literal('trojan'),
  ...hostPort,
  password: z.string().min(1),
  tls: tlsOptionsSchema,
  transport: transportSchema,
  udp: z.boolean().optional(),
});

export const shadowsocksConfigSchema = z.object({
  type: z.literal('ss'),
  ...hostPort,
  cipher: z.string().min(1),
  password: z.string(),
  udp: z.boolean().optional(),
  plugin: z.string().optional(),
  /** obfs-local / v2ray-plugin 的参数，原样透传给内核 */
  pluginOpts: z.record(z.string(), z.unknown()).optional(),
});

export const hysteria2ConfigSchema = z.object({
  type: z.literal('hysteria2'),
  ...hostPort,
  password: z.string(),
  /** 端口跳跃，如 "443,8443-8460" */
  ports: z.string().optional(),
  obfs: z.string().optional(),
  obfsPassword: z.string().optional(),
  /** 带宽上限，单位 Mbps */
  up: z.string().optional(),
  down: z.string().optional(),
  /** 证书 pin（sha256），对应链接里的 pinSHA256。注意这和 tls.fingerprint（uTLS 指纹）不是一回事 */
  pinSha256: z.string().optional(),
  tls: tlsOptionsSchema,
});

export const tuicConfigSchema = z.object({
  type: z.literal('tuic'),
  ...hostPort,
  /** TUIC v5 用 uuid+password；v4 用 token */
  uuid: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
  congestionController: z.string().optional(),
  udpRelayMode: z.enum(['native', 'quic']).optional(),
  reduceRtt: z.boolean().optional(),
  disableSni: z.boolean().optional(),
  tls: tlsOptionsSchema,
});

export const anytlsConfigSchema = z.object({
  type: z.literal('anytls'),
  ...hostPort,
  password: z.string(),
  udp: z.boolean().optional(),
  tls: tlsOptionsSchema,
});

export const httpConfigSchema = z.object({
  type: z.literal('http'),
  ...hostPort,
  username: z.string().optional(),
  password: z.string().optional(),
  tls: tlsOptionsSchema,
});

export const socks5ConfigSchema = z.object({
  type: z.literal('socks5'),
  ...hostPort,
  username: z.string().optional(),
  password: z.string().optional(),
  udp: z.boolean().optional(),
  tls: tlsOptionsSchema,
});

export const proxyConfigSchema = z.discriminatedUnion('type', [
  vlessConfigSchema,
  vmessConfigSchema,
  trojanConfigSchema,
  shadowsocksConfigSchema,
  hysteria2ConfigSchema,
  tuicConfigSchema,
  anytlsConfigSchema,
  httpConfigSchema,
  socks5ConfigSchema,
]);

export type ProxyConfig = z.infer<typeof proxyConfigSchema>;
export type VlessConfig = z.infer<typeof vlessConfigSchema>;
export type VmessConfig = z.infer<typeof vmessConfigSchema>;
export type TrojanConfig = z.infer<typeof trojanConfigSchema>;
export type ShadowsocksConfig = z.infer<typeof shadowsocksConfigSchema>;
export type Hysteria2Config = z.infer<typeof hysteria2ConfigSchema>;
export type TuicConfig = z.infer<typeof tuicConfigSchema>;
export type AnytlsConfig = z.infer<typeof anytlsConfigSchema>;
export type HttpConfig = z.infer<typeof httpConfigSchema>;
export type Socks5Config = z.infer<typeof socks5ConfigSchema>;

/** 基于 QUIC/UDP 的协议，TCP 握手测延迟对它们无意义 */
export const UDP_BASED_TYPES: ReadonlySet<NodeType> = new Set(['hysteria2', 'tuic']);

/* -------------------------------------------------------------------------- */
/*                                   节点                                     */
/* -------------------------------------------------------------------------- */

/** 解析器的产物：还没有 id，只有名字和配置 */
export interface ParsedNode {
  name: string;
  config: ProxyConfig;
}

/** 生成器的输入：已入库、带 id 的节点 */
export interface NodeRecord {
  id: string;
  name: string;
  config: ProxyConfig;
}

export type LatencyStatus = 'ok' | 'timeout' | 'refused' | 'error' | 'unsupported';
export type LatencyMethod = 'tcp' | 'proxy';

/* -------------------------------------------------------------------------- */
/*                               节点筛选条件                                   */
/* -------------------------------------------------------------------------- */

/** 订阅的动态节点选择、以及策略组的节点来源，共用这套筛选条件 */
export const nodeFilterSchema = z.object({
  /** 名称/服务器地址关键词，不区分大小写 */
  keyword: z.string().optional(),
  /** 正则，匹配节点名。与 keyword 是「与」关系 */
  namePattern: z.string().optional(),
  /** 排除名称匹配此正则的节点 */
  excludePattern: z.string().optional(),
  types: z.array(z.enum(NODE_TYPES)).optional(),
  /** 标签 id；tagMode 决定是「任一」还是「全部」 */
  tagIds: z.array(z.string()).optional(),
  tagMode: z.enum(['any', 'all']).default('any'),
  excludeTagIds: z.array(z.string()).optional(),
  /** 只要最近一次测速低于该值（ms）的节点 */
  maxDelayMs: z.number().int().positive().optional(),
  /** 只要最近一次测速成功的节点；从没测过的节点视为不满足 */
  onlyAlive: z.boolean().optional(),
});
export type NodeFilter = z.infer<typeof nodeFilterSchema>;

/** 订阅里节点集合的来源 */
export const nodeSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('manual'), nodeIds: z.array(z.string()) }),
  z.object({ mode: z.literal('filter'), filter: nodeFilterSchema }),
]);
export type NodeSelection = z.infer<typeof nodeSelectionSchema>;

/* -------------------------------------------------------------------------- */
/*                                  规则集                                     */
/* -------------------------------------------------------------------------- */

export const RULESET_BEHAVIORS = ['domain', 'ipcidr', 'classical'] as const;
export type RulesetBehavior = (typeof RULESET_BEHAVIORS)[number];

export const RULESET_FORMATS = ['yaml', 'text', 'mrs'] as const;
export type RulesetFormat = (typeof RULESET_FORMATS)[number];

export interface RulesetRecord {
  id: string;
  name: string;
  description?: string | null;
  kind: 'remote' | 'inline';
  behavior: RulesetBehavior;
  format: RulesetFormat;
  /** kind === 'remote' */
  url?: string | null;
  /** kind === 'inline'，一行一条规则 */
  content?: string | null;
}

/* -------------------------------------------------------------------------- */
/*                                 规则模板                                    */
/* -------------------------------------------------------------------------- */

export const PROXY_GROUP_TYPES = [
  'select',
  'url-test',
  'fallback',
  'load-balance',
  'relay',
] as const;
export type ProxyGroupType = (typeof PROXY_GROUP_TYPES)[number];

/** Clash 内置出口，可以直接出现在策略组成员里 */
export const BUILTIN_OUTBOUNDS = ['DIRECT', 'REJECT', 'PASS', 'COMPATIBLE'] as const;
export type BuiltinOutbound = (typeof BUILTIN_OUTBOUNDS)[number];

/** 策略组里的节点从哪来 */
export const groupNodeSourceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('filter'), filter: nodeFilterSchema }),
  z.object({ mode: z.literal('nodeIds'), ids: z.array(z.string()) }),
]);
export type GroupNodeSource = z.infer<typeof groupNodeSourceSchema>;

export const proxyGroupSchema = z.object({
  /** 模板内部引用用的稳定 key，规则的 target 指向它。不会出现在最终配置里 */
  key: z.string().min(1),
  /** 最终写进配置的组名，允许 emoji 和中文 */
  name: z.string().min(1),
  type: z.enum(PROXY_GROUP_TYPES),
  nodes: groupNodeSourceSchema,
  /** 引用其他策略组的 key，排在节点前面 */
  include: z.array(z.string()).default([]),
  /** 追加的内置出口 */
  extra: z.array(z.enum(BUILTIN_OUTBOUNDS)).default([]),
  /**
   * 把 extra 排到成员列表最前面。Clash 拿第一个成员当默认选中项，
   * 所以「全球直连」这类组必须让 DIRECT 排第一，否则默认就走代理了。
   */
  extraFirst: z.boolean().optional(),
  /** url-test / fallback / load-balance 用 */
  url: z.string().optional(),
  interval: z.number().int().positive().optional(),
  tolerance: z.number().int().positive().optional(),
  lazy: z.boolean().optional(),
  strategy: z.enum(['consistent-hashing', 'round-robin', 'sticky-sessions']).optional(),
  /** 组图标 */
  icon: z.string().optional(),
  /** 隐藏在客户端 UI 中 */
  hidden: z.boolean().optional(),
});
export type ProxyGroupDef = z.infer<typeof proxyGroupSchema>;

export const ruleEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ruleset'),
    rulesetId: z.string(),
    target: z.string(),
    noResolve: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('literal'),
    /** 完整的规则前半段，如 "DOMAIN-SUFFIX,example.com" */
    value: z.string().min(1),
    target: z.string(),
    noResolve: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('geoip'),
    value: z.string().min(1),
    target: z.string(),
    noResolve: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('geosite'),
    value: z.string().min(1),
    target: z.string(),
  }),
  z.object({ type: z.literal('match'), target: z.string() }),
]);
export type RuleEntry = z.infer<typeof ruleEntrySchema>;

export const profileGeneralSchema = z.object({
  mode: z.enum(['rule', 'global', 'direct']).default('rule'),
  logLevel: z.enum(['silent', 'error', 'warning', 'info', 'debug']).default('info'),
  mixedPort: z.number().int().min(0).max(65535).default(7890),
  allowLan: z.boolean().default(false),
  ipv6: z.boolean().default(false),
  unifiedDelay: z.boolean().default(true),
  tcpConcurrent: z.boolean().default(true),
  findProcessMode: z.enum(['off', 'strict', 'always']).default('strict'),
  globalClientFingerprint: z.string().optional(),
  /** 是否写入防 DNS 泄露的 dns 段 */
  dnsEnabled: z.boolean().default(true),
  /** 覆盖默认 dns 段的原始 YAML 片段，留空用内置预设 */
  dnsOverride: z.string().optional(),
});
export type ProfileGeneral = z.infer<typeof profileGeneralSchema>;

export const ruleProfileDefinitionSchema = z.object({
  general: profileGeneralSchema,
  groups: z.array(proxyGroupSchema),
  rules: z.array(ruleEntrySchema),
});
export type RuleProfileDefinition = z.infer<typeof ruleProfileDefinitionSchema>;

export interface RuleProfileRecord {
  id: string;
  name: string;
  description?: string | null;
  definition: RuleProfileDefinition;
}

/* -------------------------------------------------------------------------- */
/*                                   订阅                                      */
/* -------------------------------------------------------------------------- */

export const SUB_FORMATS = ['clash', 'base64', 'auto'] as const;
export type SubFormat = (typeof SUB_FORMATS)[number];

/** 实际落地的输出目标，`auto` 会被解析成其中之一 */
export type SubTarget = 'clash' | 'base64';

export const subscriptionOptionsSchema = z.object({
  /** 给所有节点名加统一前缀 */
  namePrefix: z.string().optional(),
  /** 输出前按最近延迟升序排 */
  sortByDelay: z.boolean().default(false),
  /** 强制所有节点开启 udp */
  forceUdp: z.boolean().default(false),
  /** 强制所有节点 skip-cert-verify */
  forceSkipCertVerify: z.boolean().default(false),
  /** 写进响应头，客户端据此决定多久拉一次 */
  updateIntervalHours: z.number().int().positive().default(24),
});
export type SubscriptionOptions = z.infer<typeof subscriptionOptionsSchema>;
