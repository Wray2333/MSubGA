import type { HttpConfig, ProxyConfig, Socks5Config } from '../types.js';
import { defaultTls } from '../types.js';
import {
  compact,
  fail,
  parsePort,
  parseUrlLike,
  pickBool,
  splitFragment,
  wrapHost,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

/**
 * HTTP / HTTPS / SOCKS5 代理。这类节点多来自代理服务商，
 * 链接形态就是 `scheme://user:pass@host:port`，也常以纯文本 host:port:user:pass 出现
 * （纯文本由 import/plaintext.ts 负责）。
 */

function buildUserinfo(username?: string, password?: string): string {
  if (!username) return '';
  const user = encodeURIComponent(username);
  return password ? `${user}:${encodeURIComponent(password)}` : user;
}

function serialize(
  scheme: string,
  config: HttpConfig | Socks5Config,
  name: string,
): string {
  const auth = buildUserinfo(config.username, config.password);
  const query = new URLSearchParams();
  if (config.tls.skipCertVerify) query.set('allowInsecure', '1');
  if (config.tls.sni) query.set('sni', config.tls.sni);
  const search = query.toString();
  const frag = name ? `#${encodeURIComponent(name)}` : '';
  return `${scheme}://${auth ? `${auth}@` : ''}${wrapHost(config.server)}:${config.port}${search ? `?${search}` : ''}${frag}`;
}

export const httpAdapter: ProtocolAdapter = {
  type: 'http',
  schemes: ['http', 'https'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const u = parseUrlLike(body);
    if (!u.host) fail('http 代理链接缺少服务器地址', uri);
    const tls = defaultTls();
    tls.enabled = u.scheme === 'https';
    const insecure = pickBool(u.query, 'allowInsecure', 'insecure', 'skip-cert-verify');
    if (insecure !== undefined) tls.skipCertVerify = insecure;
    const sni = u.query.get('sni');
    if (sni) tls.sni = sni;

    const config: HttpConfig = {
      type: 'http',
      server: u.host,
      port: parsePort(u.port || (tls.enabled ? '443' : '80'), uri),
      tls,
    };
    if (u.username) config.username = u.username;
    if (u.password) config.password = u.password;

    return { name: name || `${u.host}:${config.port}`, config };
  },

  toUri(name, config) {
    if (config.type !== 'http') throw new TypeError(`期望 http 配置，实际是 ${config.type}`);
    return serialize(config.tls.enabled ? 'https' : 'http', config, name);
  },

  toClash(name, config) {
    if (config.type !== 'http') throw new TypeError(`期望 http 配置，实际是 ${config.type}`);
    return compact({
      name,
      type: 'http',
      server: config.server,
      port: config.port,
      username: config.username,
      password: config.password,
      tls: config.tls.enabled || undefined,
      sni: config.tls.sni,
      'skip-cert-verify': config.tls.skipCertVerify,
    }) as ClashProxy;
  },
};

export const socks5Adapter: ProtocolAdapter = {
  type: 'socks5',
  schemes: ['socks5', 'socks', 'socks5h'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const u = parseUrlLike(body);
    if (!u.host) fail('socks5 链接缺少服务器地址', uri);
    const tls = defaultTls();
    const insecure = pickBool(u.query, 'allowInsecure', 'insecure', 'skip-cert-verify');
    if (insecure !== undefined) tls.skipCertVerify = insecure;
    const sni = u.query.get('sni');
    if (sni) tls.sni = sni;

    const config: Socks5Config = {
      type: 'socks5',
      server: u.host,
      port: parsePort(u.port, uri),
      tls,
      udp: true,
    };
    if (u.username) config.username = u.username;
    if (u.password) config.password = u.password;

    return { name: name || `${u.host}:${config.port}`, config };
  },

  toUri(name, config) {
    if (config.type !== 'socks5') throw new TypeError(`期望 socks5 配置，实际是 ${config.type}`);
    return serialize('socks5', config, name);
  },

  toClash(name, config) {
    if (config.type !== 'socks5') throw new TypeError(`期望 socks5 配置，实际是 ${config.type}`);
    return compact({
      name,
      type: 'socks5',
      server: config.server,
      port: config.port,
      username: config.username,
      password: config.password,
      udp: config.udp,
      tls: config.tls.enabled || undefined,
      'skip-cert-verify': config.tls.skipCertVerify,
    }) as ClashProxy;
  },
};
