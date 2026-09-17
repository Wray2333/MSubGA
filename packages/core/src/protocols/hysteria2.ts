import type { Hysteria2Config, ProxyConfig } from '../types.js';
import {
  buildUri,
  compact,
  fail,
  parsePort,
  parseTlsFromQuery,
  parseUrlLike,
  pick,
  splitFragment,
  tlsToClash,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

function assertHy2(config: ProxyConfig): asserts config is Hysteria2Config {
  if (config.type !== 'hysteria2') throw new TypeError(`期望 hysteria2 配置，实际是 ${config.type}`);
}

/** hysteria2://<password>@<host>:<port>?sni=&insecure=1&obfs=salamander&obfs-password=&mport=443-500#名称 */
export const hysteria2Adapter: ProtocolAdapter = {
  type: 'hysteria2',
  schemes: ['hysteria2', 'hy2'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const u = parseUrlLike(body);
    // 密码里带冒号时 URL 会拆成 username:password，拼回去
    const password = u.password ? `${u.username}:${u.password}` : u.username;
    if (!u.host) fail('hysteria2 链接缺少服务器地址', uri);

    const config: Hysteria2Config = {
      type: 'hysteria2',
      server: u.host,
      port: parsePort(u.port || '443', uri),
      password,
      tls: parseTlsFromQuery(u.query, { forceEnabled: true }),
    };

    // 端口跳跃：不同客户端写成 mport / ports
    const ports = pick(u.query, 'mport', 'ports');
    if (ports) config.ports = ports;
    const obfs = pick(u.query, 'obfs');
    if (obfs && obfs.toLowerCase() !== 'none') {
      config.obfs = obfs;
      const obfsPassword = pick(u.query, 'obfs-password', 'obfsPassword', 'obfs_password');
      if (obfsPassword) config.obfsPassword = obfsPassword;
    }
    const up = pick(u.query, 'up', 'upmbps');
    if (up) config.up = up;
    const down = pick(u.query, 'down', 'downmbps');
    if (down) config.down = down;
    const pin = pick(u.query, 'pinSHA256', 'pinsha256');
    if (pin) config.pinSha256 = pin;

    return { name: name || `${u.host}:${config.port}`, config };
  },

  toUri(name, config) {
    assertHy2(config);
    const query = new URLSearchParams();
    if (config.tls.sni) query.set('sni', config.tls.sni);
    if (config.tls.skipCertVerify) query.set('insecure', '1');
    if (config.tls.alpn?.length) query.set('alpn', config.tls.alpn.join(','));
    if (config.ports) query.set('mport', config.ports);
    if (config.obfs) {
      query.set('obfs', config.obfs);
      if (config.obfsPassword) query.set('obfs-password', config.obfsPassword);
    }
    if (config.up) query.set('up', config.up);
    if (config.down) query.set('down', config.down);
    if (config.pinSha256) query.set('pinSHA256', config.pinSha256);
    return buildUri('hysteria2', encodeURIComponent(config.password), config.server, config.port, query, name);
  },

  toClash(name, config) {
    assertHy2(config);
    const tls = tlsToClash(config.tls, { sniKey: 'sni', emitTlsFlag: false, supportsUtls: false });
    return compact({
      name,
      type: 'hysteria2',
      server: config.server,
      port: config.port,
      ports: config.ports,
      password: config.password,
      up: config.up,
      down: config.down,
      obfs: config.obfs,
      'obfs-password': config.obfsPassword,
      // hysteria2 的 fingerprint 字段是证书 pin，不是 uTLS 指纹
      fingerprint: config.pinSha256,
      ...tls,
    }) as ClashProxy;
  },
};
