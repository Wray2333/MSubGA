import type { ProxyConfig, TuicConfig } from '../types.js';
import {
  buildUri,
  compact,
  fail,
  parsePort,
  parseTlsFromQuery,
  parseUrlLike,
  pick,
  pickBool,
  splitFragment,
  tlsToClash,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

function assertTuic(config: ProxyConfig): asserts config is TuicConfig {
  if (config.type !== 'tuic') throw new TypeError(`期望 tuic 配置，实际是 ${config.type}`);
}

/**
 * tuic://<uuid>:<password>@<host>:<port>?sni=&alpn=h3&congestion_control=bbr#名称
 * v4 只有一个 token，写成 tuic://<token>@host:port
 */
export const tuicAdapter: ProtocolAdapter = {
  type: 'tuic',
  schemes: ['tuic'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const u = parseUrlLike(body);
    if (!u.host) fail('tuic 链接缺少服务器地址', uri);

    const config: TuicConfig = {
      type: 'tuic',
      server: u.host,
      port: parsePort(u.port || '443', uri),
      tls: parseTlsFromQuery(u.query, { forceEnabled: true }),
    };

    if (u.password) {
      config.uuid = u.username;
      config.password = u.password;
    } else if (u.username) {
      // 没有冒号说明是 v4 的 token
      config.token = u.username;
    } else {
      fail('tuic 链接缺少 uuid/token', uri);
    }

    const cc = pick(u.query, 'congestion_control', 'congestion-controller', 'congestion');
    if (cc) config.congestionController = cc;
    const mode = pick(u.query, 'udp_relay_mode', 'udp-relay-mode');
    if (mode === 'native' || mode === 'quic') config.udpRelayMode = mode;
    const reduceRtt = pickBool(u.query, 'reduce_rtt', 'reduce-rtt');
    if (reduceRtt !== undefined) config.reduceRtt = reduceRtt;
    const disableSni = pickBool(u.query, 'disable_sni', 'disable-sni');
    if (disableSni !== undefined) config.disableSni = disableSni;

    return { name: name || `${u.host}:${config.port}`, config };
  },

  toUri(name, config) {
    assertTuic(config);
    const query = new URLSearchParams();
    if (config.tls.sni) query.set('sni', config.tls.sni);
    if (config.tls.alpn?.length) query.set('alpn', config.tls.alpn.join(','));
    if (config.tls.skipCertVerify) query.set('allow_insecure', '1');
    if (config.congestionController) query.set('congestion_control', config.congestionController);
    if (config.udpRelayMode) query.set('udp_relay_mode', config.udpRelayMode);
    if (config.reduceRtt) query.set('reduce_rtt', '1');
    if (config.disableSni) query.set('disable_sni', '1');

    const userinfo = config.token
      ? encodeURIComponent(config.token)
      : `${encodeURIComponent(config.uuid ?? '')}:${encodeURIComponent(config.password ?? '')}`;
    return buildUri('tuic', userinfo, config.server, config.port, query, name);
  },

  toClash(name, config) {
    assertTuic(config);
    return compact({
      name,
      type: 'tuic',
      server: config.server,
      port: config.port,
      uuid: config.uuid,
      password: config.password,
      token: config.token,
      'congestion-controller': config.congestionController,
      'udp-relay-mode': config.udpRelayMode,
      'reduce-rtt': config.reduceRtt,
      'disable-sni': config.disableSni,
      ...tlsToClash(config.tls, { sniKey: 'sni', emitTlsFlag: false, supportsUtls: false }),
    }) as ClashProxy;
  },
};
