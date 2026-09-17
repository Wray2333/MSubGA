import type { AnytlsConfig, ProxyConfig } from '../types.js';
import {
  buildUri,
  compact,
  fail,
  parsePort,
  parseTlsFromQuery,
  parseUrlLike,
  splitFragment,
  tlsToClash,
  tlsToQuery,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

function assertAnytls(config: ProxyConfig): asserts config is AnytlsConfig {
  if (config.type !== 'anytls') throw new TypeError(`期望 anytls 配置，实际是 ${config.type}`);
}

/** anytls://<password>@<host>:<port>?sni=&insecure=1#名称 */
export const anytlsAdapter: ProtocolAdapter = {
  type: 'anytls',
  schemes: ['anytls'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const u = parseUrlLike(body);
    const password = u.password ? `${u.username}:${u.password}` : u.username;
    if (!u.host) fail('anytls 链接缺少服务器地址', uri);

    const config: AnytlsConfig = {
      type: 'anytls',
      server: u.host,
      port: parsePort(u.port, uri),
      password,
      tls: parseTlsFromQuery(u.query, { forceEnabled: true }),
      udp: true,
    };
    return { name: name || `${u.host}:${config.port}`, config };
  },

  toUri(name, config) {
    assertAnytls(config);
    const query = new URLSearchParams();
    tlsToQuery(config.tls, query);
    query.delete('security');
    return buildUri('anytls', encodeURIComponent(config.password), config.server, config.port, query, name);
  },

  toClash(name, config) {
    assertAnytls(config);
    return compact({
      name,
      type: 'anytls',
      server: config.server,
      port: config.port,
      password: config.password,
      udp: config.udp,
      ...tlsToClash(config.tls, { sniKey: 'sni', emitTlsFlag: false }),
    }) as ClashProxy;
  },
};
