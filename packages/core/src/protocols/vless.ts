import type { ProxyConfig, VlessConfig } from '../types.js';
import {
  buildUri,
  compact,
  fail,
  parsePort,
  parseTlsFromQuery,
  parseTransportFromQuery,
  parseUrlLike,
  pick,
  splitFragment,
  tlsToClash,
  tlsToQuery,
  transportToClash,
  transportToQuery,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

function assertVless(config: ProxyConfig): asserts config is VlessConfig {
  if (config.type !== 'vless') throw new TypeError(`期望 vless 配置，实际是 ${config.type}`);
}

/** vless://<uuid>@<host>:<port>?encryption=none&security=tls&type=ws&path=/&host=cdn#名称 */
export const vlessAdapter: ProtocolAdapter = {
  type: 'vless',
  schemes: ['vless'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const u = parseUrlLike(body);
    if (!u.username) fail('vless 链接缺少 uuid', uri);
    if (!u.host) fail('vless 链接缺少服务器地址', uri);

    const config: VlessConfig = {
      type: 'vless',
      server: u.host,
      port: parsePort(u.port, uri),
      uuid: u.username,
      tls: parseTlsFromQuery(u.query),
      transport: parseTransportFromQuery(u.query, uri),
      udp: true,
    };

    const flow = pick(u.query, 'flow');
    if (flow) config.flow = flow;
    const packetEncoding = pick(u.query, 'packetEncoding');
    if (packetEncoding === 'none' || packetEncoding === 'packetaddr' || packetEncoding === 'xudp') {
      config.packetEncoding = packetEncoding;
    }

    return { name: name || `${u.host}:${config.port}`, config };
  },

  toUri(name, config) {
    assertVless(config);
    const query = new URLSearchParams();
    query.set('encryption', 'none');
    tlsToQuery(config.tls, query);
    transportToQuery(config.transport, query);
    if (config.flow) query.set('flow', config.flow);
    if (config.packetEncoding) query.set('packetEncoding', config.packetEncoding);
    return buildUri('vless', config.uuid, config.server, config.port, query, name);
  },

  toClash(name, config) {
    assertVless(config);
    return compact({
      name,
      type: 'vless',
      server: config.server,
      port: config.port,
      uuid: config.uuid,
      udp: config.udp,
      flow: config.flow || undefined,
      'packet-encoding': config.packetEncoding,
      ...tlsToClash(config.tls, { sniKey: 'servername' }),
      ...transportToClash(config.transport),
    }) as ClashProxy;
  },
};
