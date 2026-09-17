import type { ProxyConfig, TrojanConfig } from '../types.js';
import {
  buildUri,
  compact,
  fail,
  parsePort,
  parseTlsFromQuery,
  parseTransportFromQuery,
  parseUrlLike,
  splitFragment,
  tlsToClash,
  tlsToQuery,
  transportToClash,
  transportToQuery,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

function assertTrojan(config: ProxyConfig): asserts config is TrojanConfig {
  if (config.type !== 'trojan') throw new TypeError(`期望 trojan 配置，实际是 ${config.type}`);
}

/** trojan://<password>@<host>:<port>?sni=&type=ws&path=#名称 —— trojan 恒定走 TLS */
export const trojanAdapter: ProtocolAdapter = {
  type: 'trojan',
  schemes: ['trojan'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const u = parseUrlLike(body);
    // 密码在 userinfo 里，可能被写成 user:pass 的形式（此时整段都是密码）
    const password = u.password ? `${u.username}:${u.password}` : u.username;
    if (!password) fail('trojan 链接缺少密码', uri);
    if (!u.host) fail('trojan 链接缺少服务器地址', uri);

    const config: TrojanConfig = {
      type: 'trojan',
      server: u.host,
      port: parsePort(u.port, uri),
      password,
      tls: parseTlsFromQuery(u.query, { forceEnabled: true }),
      transport: parseTransportFromQuery(u.query, uri),
      udp: true,
    };
    return { name: name || `${u.host}:${config.port}`, config };
  },

  toUri(name, config) {
    assertTrojan(config);
    const query = new URLSearchParams();
    tlsToQuery(config.tls, query);
    transportToQuery(config.transport, query);
    return buildUri('trojan', encodeURIComponent(config.password), config.server, config.port, query, name);
  },

  toClash(name, config) {
    assertTrojan(config);
    // trojan 的 TLS 是协议自带的，mihomo 的 trojan 结构体里没有 tls 字段，不能写
    return compact({
      name,
      type: 'trojan',
      server: config.server,
      port: config.port,
      password: config.password,
      udp: config.udp,
      ...tlsToClash(config.tls, { sniKey: 'sni', emitTlsFlag: false }),
      ...transportToClash(config.transport),
    }) as ClashProxy;
  },
};
