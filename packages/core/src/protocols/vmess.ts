import type { ProxyConfig, Transport, TlsOptions, VmessConfig } from '../types.js';
import {
  base64Decode,
  base64Encode,
  compact,
  fail,
  parsePort,
  parseTlsFromQuery,
  parseTransportFromQuery,
  parseUrlLike,
  pick,
  splitFragment,
  splitList,
  tlsToClash,
  transportToClash,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

function assertVmess(config: ProxyConfig): asserts config is VmessConfig {
  if (config.type !== 'vmess') throw new TypeError(`期望 vmess 配置，实际是 ${config.type}`);
}

/** v2rayN 分享格式的 JSON 结构，各字段都可能是字符串或数字 */
interface VmessJson {
  v?: string | number;
  ps?: string;
  add?: string;
  port?: string | number;
  id?: string;
  aid?: string | number;
  scy?: string;
  net?: string;
  type?: string;
  host?: string;
  path?: string;
  tls?: string;
  sni?: string;
  alpn?: string;
  fp?: string;
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function transportFromJson(json: VmessJson, uri: string): Transport {
  const net = (str(json.net) ?? 'tcp').toLowerCase();
  const headerType = (str(json.type) ?? 'none').toLowerCase();
  const host = str(json.host);
  const path = str(json.path);

  switch (net) {
    case 'ws':
    case 'websocket': {
      const transport: Transport = { network: 'ws' };
      if (path) transport.path = path;
      if (host) transport.headers = { Host: host };
      return transport;
    }
    case 'grpc': {
      const transport: Transport = { network: 'grpc' };
      // v2rayN 把 serviceName 塞在 path 里
      if (path) transport.serviceName = path;
      return transport;
    }
    case 'h2':
    case 'http': {
      const transport: Transport = { network: 'h2' };
      if (path) transport.path = path;
      const hosts = splitList(host);
      if (hosts) transport.host = hosts;
      return transport;
    }
    case 'tcp':
    case 'raw': {
      if (headerType === 'http') {
        const transport: Transport = { network: 'http' };
        const hosts = splitList(host);
        if (hosts) transport.host = hosts;
        const paths = splitList(path);
        if (paths) transport.path = paths;
        return transport;
      }
      return { network: 'tcp' };
    }
    default:
      return fail(`vmess 暂不支持的传输方式: ${net}`, uri);
  }
}

function tlsFromJson(json: VmessJson): TlsOptions {
  const enabled = (str(json.tls) ?? '').toLowerCase() === 'tls';
  const tls: TlsOptions = { enabled };
  if (!enabled) return tls;

  // 没给 sni 时退回 host：CDN 中转的节点靠 Host 头做 SNI，
  // 留空会让内核拿服务器 IP 当 SNI，握手必失败。
  const sni = str(json.sni) ?? str(json.host);
  if (sni) tls.sni = sni;
  const alpn = splitList(str(json.alpn));
  if (alpn) tls.alpn = alpn;
  const fp = str(json.fp);
  if (fp) tls.fingerprint = fp;
  return tls;
}

function parseJsonForm(payload: string, uri: string): { name: string; config: VmessConfig } | null {
  let decoded: string;
  try {
    decoded = base64Decode(payload);
  } catch {
    return null;
  }
  let json: VmessJson;
  try {
    json = JSON.parse(decoded) as VmessJson;
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;

  const server = str(json.add);
  const id = str(json.id);
  if (!server || !id) fail('vmess 链接缺少服务器地址或 uuid', uri);

  const config: VmessConfig = {
    type: 'vmess',
    server,
    port: parsePort(str(json.port) ?? '', uri),
    uuid: id,
    alterId: Number.parseInt(str(json.aid) ?? '0', 10) || 0,
    cipher: str(json.scy) ?? 'auto',
    tls: tlsFromJson(json),
    transport: transportFromJson(json, uri),
    udp: true,
  };
  return { name: str(json.ps) ?? `${server}:${config.port}`, config };
}

/** 少数客户端会吐出 vmess://uuid@host:port?…#name 这种 URI 形态 */
function parseUriForm(body: string, fragment: string, uri: string): { name: string; config: VmessConfig } {
  const u = parseUrlLike(body);
  if (!u.username) fail('vmess 链接既不是 base64 JSON，也不是合法的 URI 形态', uri);
  const config: VmessConfig = {
    type: 'vmess',
    server: u.host,
    port: parsePort(u.port, uri),
    uuid: u.username,
    alterId: Number.parseInt(pick(u.query, 'alterId', 'aid') ?? '0', 10) || 0,
    cipher: pick(u.query, 'encryption', 'scy') ?? 'auto',
    tls: parseTlsFromQuery(u.query),
    transport: parseTransportFromQuery(u.query, uri),
    udp: true,
  };
  return { name: fragment || `${u.host}:${config.port}`, config };
}

export const vmessAdapter: ProtocolAdapter = {
  type: 'vmess',
  schemes: ['vmess'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const payload = body.slice(body.indexOf('://') + 3);
    if (!payload) fail('vmess 链接内容为空', uri);

    const fromJson = parseJsonForm(payload, uri);
    if (fromJson) return fromJson;
    return parseUriForm(body, name, uri);
  },

  toUri(name, config) {
    assertVmess(config);
    const json: VmessJson = {
      v: '2',
      ps: name,
      add: config.server,
      port: String(config.port),
      id: config.uuid,
      aid: String(config.alterId),
      scy: config.cipher,
      net: 'tcp',
      type: 'none',
      tls: config.tls.enabled ? 'tls' : '',
    };

    switch (config.transport.network) {
      case 'tcp':
        break;
      case 'ws':
        json.net = 'ws';
        if (config.transport.path) json.path = config.transport.path;
        if (config.transport.headers?.['Host']) json.host = config.transport.headers['Host'];
        break;
      case 'grpc':
        json.net = 'grpc';
        if (config.transport.serviceName) json.path = config.transport.serviceName;
        break;
      case 'h2':
        json.net = 'h2';
        if (config.transport.path) json.path = config.transport.path;
        if (config.transport.host?.length) json.host = config.transport.host.join(',');
        break;
      case 'http':
        json.net = 'tcp';
        json.type = 'http';
        if (config.transport.host?.length) json.host = config.transport.host.join(',');
        if (config.transport.path?.length) json.path = config.transport.path.join(',');
        break;
    }

    if (config.tls.sni) json.sni = config.tls.sni;
    if (config.tls.alpn?.length) json.alpn = config.tls.alpn.join(',');
    if (config.tls.fingerprint) json.fp = config.tls.fingerprint;

    return `vmess://${base64Encode(JSON.stringify(json))}`;
  },

  toClash(name, config) {
    assertVmess(config);
    return compact({
      name,
      type: 'vmess',
      server: config.server,
      port: config.port,
      uuid: config.uuid,
      alterId: config.alterId,
      cipher: config.cipher,
      udp: config.udp,
      'packet-encoding': config.packetEncoding,
      ...tlsToClash(config.tls, { sniKey: 'servername' }),
      ...transportToClash(config.transport),
    }) as ClashProxy;
  },
};
