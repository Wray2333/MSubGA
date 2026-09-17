import type { NodeType, Network, Transport, TlsOptions } from '../types.js';
import { defaultTls } from '../types.js';

/* -------------------------------------------------------------------------- */
/*                                  错误类型                                   */
/* -------------------------------------------------------------------------- */

export class ParseError extends Error {
  readonly input: string;
  constructor(message: string, input: string) {
    super(message);
    this.name = 'ParseError';
    this.input = input;
  }
}

export function fail(message: string, input: string): never {
  throw new ParseError(message, input);
}

/* -------------------------------------------------------------------------- */
/*                                  base64                                     */
/* -------------------------------------------------------------------------- */

/** 兼容 url-safe 变体和缺失的 padding；用 atob 而非 Buffer，这样 core 在浏览器里也能跑 */
export function base64Decode(input: string): string {
  const normalized = input.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export function base64Encode(input: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const out = btoa(binary);
  return urlSafe ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
}

/** 判断一段文本整体看起来像不像 base64（用于识别整包 base64 的订阅内容） */
export function looksLikeBase64(input: string): boolean {
  const s = input.replace(/\s/g, '');
  if (s.length < 8) return false;
  return /^[A-Za-z0-9+/\-_]+={0,2}$/.test(s);
}

export function tryBase64Decode(input: string): string | null {
  if (!looksLikeBase64(input)) return null;
  try {
    const decoded = base64Decode(input);
    // 解出来带控制字符说明不是文本，判定失败
    if (/[\u0000-\u0008\u000E-\u001F]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                                 URI 基础解析                                 */
/* -------------------------------------------------------------------------- */

/** 取出 `#` 后面的节点名，返回剩余部分。名字可能被 URL 编码过。 */
export function splitFragment(uri: string): { body: string; name: string } {
  const hashAt = uri.indexOf('#');
  if (hashAt === -1) return { body: uri, name: '' };
  const raw = uri.slice(hashAt + 1);
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* 编码坏了就用原文 */
  }
  return { body: uri.slice(0, hashAt), name: name.trim() };
}

export function parsePort(raw: string, input: string): number {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`端口不合法: ${raw}`, input);
  }
  return port;
}

/** 去掉 IPv6 地址外面的方括号 */
export function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** 给 IPv6 地址补上方括号，便于拼回 URI */
export function wrapHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * 用 URL 解析 `scheme://userinfo@host:port/path?query#frag`。
 * 借 WHATWG URL 做实际解析，但换成自定义 scheme——见函数体里的注释。
 */
export function parseUrlLike(uri: string): {
  scheme: string;
  username: string;
  password: string;
  host: string;
  port: string;
  pathname: string;
  query: URLSearchParams;
  hash: string;
} {
  const schemeAt = uri.indexOf('://');
  if (schemeAt === -1) fail('缺少协议前缀', uri);
  const scheme = uri.slice(0, schemeAt).toLowerCase();
  const rest = uri.slice(schemeAt + 3);
  let url: URL;
  try {
    // 必须用非特殊 scheme：换成 http:// 的话 WHATWG URL 会把 :80 当默认端口抹掉，
    // 所有 80 端口的节点都会丢端口。
    url = new URL(`msubga://${rest}`);
  } catch {
    // URL 构造失败绝大多数是端口写错，单独报出来比「格式不合法」有用得多
    const authority = (rest.split(/[/?#]/)[0] ?? '').replace(/^[^@]*@/, '');
    const badPort = /:(\d+)$/.exec(authority.replace(/^\[[^\]]*\]/, ''));
    if (badPort) fail(`端口不合法: ${badPort[1]}`, uri);
    return fail('URI 格式不合法', uri);
  }
  return {
    scheme,
    username: safeDecode(url.username),
    password: safeDecode(url.password),
    // 非特殊 scheme 不会规范化大小写，这里自己来，否则同一台主机会算出两个指纹
    host: stripBrackets(url.hostname).toLowerCase(),
    port: url.port,
    pathname: url.pathname,
    query: url.searchParams,
    hash: url.hash.slice(1),
  };
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 读取第一个存在的 query key，兼容各家客户端的别名 */
export function pick(query: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = query.get(key);
    if (value !== null && value !== '') return value;
  }
  return undefined;
}

export function pickBool(query: URLSearchParams, ...keys: string[]): boolean | undefined {
  const value = pick(query, ...keys);
  if (value === undefined) return undefined;
  return value === '1' || value.toLowerCase() === 'true';
}

export function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((s) => safeDecode(s).trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/* -------------------------------------------------------------------------- */
/*                            query <-> TLS / 传输层                            */
/* -------------------------------------------------------------------------- */

export function parseTlsFromQuery(
  query: URLSearchParams,
  options: { forceEnabled?: boolean } = {},
): TlsOptions {
  const security = (pick(query, 'security') ?? '').toLowerCase();
  const isReality = security === 'reality';
  const enabled = options.forceEnabled === true || isReality || security === 'tls' || security === 'xtls';

  const tls: TlsOptions = { enabled };
  // 只认显式的 sni/peer/servername。`host` 在 ws/h2 里是传输层的 Host 头，
  // 拿它当 SNI 会在 CDN 中转场景下解析错。
  const sni = pick(query, 'sni', 'peer', 'servername');
  if (sni) tls.sni = sni;

  const alpn = splitList(pick(query, 'alpn'));
  if (alpn) tls.alpn = alpn;

  const fp = pick(query, 'fp', 'client-fingerprint');
  if (fp) tls.fingerprint = fp;

  const insecure = pickBool(query, 'allowInsecure', 'insecure', 'skip-cert-verify');
  if (insecure !== undefined) tls.skipCertVerify = insecure;

  if (isReality) {
    const publicKey = pick(query, 'pbk', 'public-key');
    if (publicKey) {
      tls.reality = { publicKey };
      const shortId = pick(query, 'sid', 'short-id');
      if (shortId) tls.reality.shortId = shortId;
    }
  }
  return tls;
}

export function tlsToQuery(tls: TlsOptions, query: URLSearchParams): void {
  if (tls.reality) {
    query.set('security', 'reality');
    query.set('pbk', tls.reality.publicKey);
    if (tls.reality.shortId) query.set('sid', tls.reality.shortId);
  } else if (tls.enabled) {
    query.set('security', 'tls');
  } else {
    query.set('security', 'none');
  }
  if (tls.sni) query.set('sni', tls.sni);
  if (tls.alpn?.length) query.set('alpn', tls.alpn.join(','));
  if (tls.fingerprint) query.set('fp', tls.fingerprint);
  if (tls.skipCertVerify) query.set('allowInsecure', '1');
}

/**
 * URI 的 `type` 参数到 clash `network` 的映射。
 * 注意 xray 的 `type=http` 指 HTTP/2（clash 的 h2），而 `type=tcp&headerType=http`
 * 才是 TCP 上的 HTTP 伪装（clash 的 http）。两者不能混。
 */
export function parseTransportFromQuery(query: URLSearchParams, input: string): Transport {
  const raw = (pick(query, 'type', 'network', 'net') ?? 'tcp').toLowerCase();
  const headerType = (pick(query, 'headerType') ?? '').toLowerCase();

  switch (raw) {
    case 'ws':
    case 'websocket': {
      const transport: Transport = { network: 'ws' };
      const path = pick(query, 'path');
      if (path) transport.path = path;
      const host = pick(query, 'host');
      if (host) transport.headers = { Host: host };
      const ed = pick(query, 'ed');
      if (ed) transport.maxEarlyData = Number.parseInt(ed, 10) || undefined;
      const edh = pick(query, 'eh');
      if (edh) transport.earlyDataHeaderName = edh;
      return transport;
    }
    case 'grpc': {
      const transport: Transport = { network: 'grpc' };
      const serviceName = pick(query, 'serviceName', 'servicename', 'path');
      if (serviceName) transport.serviceName = serviceName;
      return transport;
    }
    case 'http':
    case 'h2': {
      const transport: Transport = { network: 'h2' };
      const path = pick(query, 'path');
      if (path) transport.path = path;
      const host = splitList(pick(query, 'host'));
      if (host) transport.host = host;
      return transport;
    }
    case 'tcp':
    case 'raw': {
      if (headerType === 'http') {
        const transport: Transport = { network: 'http' };
        const host = splitList(pick(query, 'host'));
        if (host) transport.host = host;
        const path = splitList(pick(query, 'path'));
        if (path) transport.path = path;
        return transport;
      }
      return { network: 'tcp' };
    }
    default:
      return fail(`暂不支持的传输方式: ${raw}`, input);
  }
}

export function transportToQuery(transport: Transport, query: URLSearchParams): void {
  switch (transport.network) {
    case 'tcp':
      query.set('type', 'tcp');
      break;
    case 'ws':
      query.set('type', 'ws');
      if (transport.path) query.set('path', transport.path);
      if (transport.headers?.['Host']) query.set('host', transport.headers['Host']);
      if (transport.maxEarlyData) query.set('ed', String(transport.maxEarlyData));
      if (transport.earlyDataHeaderName) query.set('eh', transport.earlyDataHeaderName);
      break;
    case 'grpc':
      query.set('type', 'grpc');
      if (transport.serviceName) query.set('serviceName', transport.serviceName);
      break;
    case 'h2':
      query.set('type', 'http');
      if (transport.path) query.set('path', transport.path);
      if (transport.host?.length) query.set('host', transport.host.join(','));
      break;
    case 'http':
      query.set('type', 'tcp');
      query.set('headerType', 'http');
      if (transport.host?.length) query.set('host', transport.host.join(','));
      if (transport.path?.length) query.set('path', transport.path.join(','));
      break;
  }
}

/* -------------------------------------------------------------------------- */
/*                              -> Clash 片段生成                               */
/* -------------------------------------------------------------------------- */

export type ClashProxy = Record<string, unknown>;

/** 丢掉值为 undefined 的键，保持生成的 YAML 干净 */
export function compact(obj: ClashProxy): ClashProxy {
  const out: ClashProxy = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * TLS 相关字段。`sniKey` 区分两类协议：vless/vmess 用 `servername`，
 * trojan/hysteria2/tuic/anytls/http 用 `sni`。
 */
export function tlsToClash(
  tls: TlsOptions,
  options: { sniKey: 'servername' | 'sni'; emitTlsFlag?: boolean; supportsUtls?: boolean },
): ClashProxy {
  const out: ClashProxy = {};
  if (options.emitTlsFlag !== false) out['tls'] = tls.enabled || Boolean(tls.reality);
  if (tls.sni) out[options.sniKey] = tls.sni;
  if (tls.alpn?.length) out['alpn'] = tls.alpn;
  if (tls.skipCertVerify !== undefined) out['skip-cert-verify'] = tls.skipCertVerify;
  if (options.supportsUtls !== false && tls.fingerprint) out['client-fingerprint'] = tls.fingerprint;
  if (tls.reality) {
    out['reality-opts'] = compact({
      'public-key': tls.reality.publicKey,
      'short-id': tls.reality.shortId,
    });
  }
  return out;
}

export function transportToClash(transport: Transport): ClashProxy {
  switch (transport.network) {
    case 'tcp':
      return {};
    case 'ws':
      return {
        network: 'ws',
        'ws-opts': compact({
          path: transport.path,
          headers: transport.headers,
          'max-early-data': transport.maxEarlyData,
          'early-data-header-name': transport.earlyDataHeaderName,
        }),
      };
    case 'grpc':
      return {
        network: 'grpc',
        'grpc-opts': compact({ 'grpc-service-name': transport.serviceName }),
      };
    case 'h2':
      return {
        network: 'h2',
        'h2-opts': compact({ host: transport.host, path: transport.path }),
      };
    case 'http':
      return {
        network: 'http',
        'http-opts': compact({ host: transport.host, path: transport.path }),
      };
  }
}

/* -------------------------------------------------------------------------- */
/*                                 适配器接口                                   */
/* -------------------------------------------------------------------------- */

export interface ParsedResult {
  name: string;
  config: import('../types.js').ProxyConfig;
}

export interface ProtocolAdapter {
  readonly type: NodeType;
  /** 该协议接受的 URI scheme（小写，不含 `://`） */
  readonly schemes: readonly string[];
  parseUri(uri: string): ParsedResult;
  toUri(name: string, config: import('../types.js').ProxyConfig): string;
  toClash(name: string, config: import('../types.js').ProxyConfig): ClashProxy;
}

export function buildUri(
  scheme: string,
  userinfo: string,
  host: string,
  port: number,
  query: URLSearchParams,
  name: string,
): string {
  const search = query.toString();
  const auth = userinfo ? `${userinfo}@` : '';
  const frag = name ? `#${encodeURIComponent(name)}` : '';
  return `${scheme}://${auth}${wrapHost(host)}:${port}${search ? `?${search}` : ''}${frag}`;
}

export function emptyTlsIfMissing(tls: TlsOptions | undefined): TlsOptions {
  return tls ?? defaultTls();
}

/** 把 network 枚举转成人类可读，用于报错信息 */
export function networkLabel(network: Network): string {
  return network;
}
