import type { ProxyConfig, ShadowsocksConfig } from '../types.js';
import {
  base64Decode,
  base64Encode,
  compact,
  fail,
  parsePort,
  safeDecode,
  splitFragment,
  stripBrackets,
  wrapHost,
  type ClashProxy,
  type ProtocolAdapter,
} from './shared.js';

function assertSs(config: ProxyConfig): asserts config is ShadowsocksConfig {
  if (config.type !== 'ss') throw new TypeError(`期望 ss 配置，实际是 ${config.type}`);
}

type PluginInfo = { plugin: string; pluginOpts: Record<string, unknown> };

/** 把 SIP003 的 `name;k=v;k=v` 插件串翻译成 clash 的 plugin / plugin-opts */
function parsePluginString(raw: string): PluginInfo | undefined {
  const parts = raw.split(';').filter(Boolean);
  const name = parts[0];
  if (!name) return undefined;

  const kv: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) kv[part] = 'true';
    else kv[part.slice(0, eq)] = part.slice(eq + 1);
  }

  switch (name) {
    case 'obfs':
    case 'obfs-local':
    case 'simple-obfs':
      return {
        plugin: 'obfs',
        pluginOpts: compact({ mode: kv['obfs'], host: kv['obfs-host'] }),
      };
    case 'v2ray-plugin':
      return {
        plugin: 'v2ray-plugin',
        pluginOpts: compact({
          mode: kv['mode'] ?? 'websocket',
          tls: 'tls' in kv ? true : undefined,
          host: kv['host'],
          path: kv['path'],
          mux: kv['mux'] === 'true' ? true : undefined,
        }),
      };
    case 'shadow-tls':
      return {
        plugin: 'shadow-tls',
        pluginOpts: compact({
          host: kv['host'],
          password: kv['password'],
          version: kv['version'] ? Number.parseInt(kv['version'], 10) : undefined,
        }),
      };
    default:
      // 不认识的插件原样透传，交给内核去报错，好过在这里丢信息
      return { plugin: name, pluginOpts: kv };
  }
}

function buildPluginString(plugin: string, opts: Record<string, unknown>): string {
  const segments: string[] = [];
  switch (plugin) {
    case 'obfs':
      segments.push('obfs-local');
      if (opts['mode']) segments.push(`obfs=${String(opts['mode'])}`);
      if (opts['host']) segments.push(`obfs-host=${String(opts['host'])}`);
      break;
    case 'v2ray-plugin':
      segments.push('v2ray-plugin');
      if (opts['mode']) segments.push(`mode=${String(opts['mode'])}`);
      if (opts['tls'] === true) segments.push('tls');
      if (opts['host']) segments.push(`host=${String(opts['host'])}`);
      if (opts['path']) segments.push(`path=${String(opts['path'])}`);
      if (opts['mux'] === true) segments.push('mux=true');
      break;
    default:
      segments.push(plugin);
      for (const [key, value] of Object.entries(opts)) {
        segments.push(value === true ? key : `${key}=${String(value)}`);
      }
  }
  return segments.join(';');
}

function splitCreds(creds: string, uri: string): { cipher: string; password: string } {
  const colon = creds.indexOf(':');
  if (colon === -1) fail('ss 链接里的加密方式和密码格式不对', uri);
  return { cipher: creds.slice(0, colon), password: creds.slice(colon + 1) };
}

/**
 * 两种形态都要吃下：
 *   SIP002  ss://<base64url(method:password)>@host:port/?plugin=...#名称
 *   旧格式   ss://<base64(method:password@host:port)>#名称
 */
export const shadowsocksAdapter: ProtocolAdapter = {
  type: 'ss',
  schemes: ['ss'],

  parseUri(uri) {
    const { body, name } = splitFragment(uri);
    const rest = body.slice(body.indexOf('://') + 3);
    if (!rest) fail('ss 链接内容为空', uri);

    let creds: string;
    let hostSection: string;

    const atIndex = rest.lastIndexOf('@');
    if (atIndex !== -1) {
      const userinfo = rest.slice(0, atIndex);
      hostSection = rest.slice(atIndex + 1);
      // base64 字符表里没有冒号，所以有冒号就是明文的 method:password
      creds = userinfo.includes(':') ? safeDecode(userinfo) : base64Decode(userinfo);
    } else {
      const decoded = base64Decode(rest);
      const at = decoded.lastIndexOf('@');
      if (at === -1) fail('ss 链接解码后缺少 @ 分隔符', uri);
      creds = decoded.slice(0, at);
      hostSection = decoded.slice(at + 1);
    }

    let url: URL;
    try {
      url = new URL(`http://${hostSection}`);
    } catch {
      return fail('ss 链接的服务器地址不合法', uri);
    }

    const { cipher, password } = splitCreds(creds, uri);
    const config: ShadowsocksConfig = {
      type: 'ss',
      server: stripBrackets(url.hostname),
      port: parsePort(url.port, uri),
      cipher,
      password,
      udp: true,
    };

    const pluginRaw = url.searchParams.get('plugin');
    if (pluginRaw) {
      const info = parsePluginString(safeDecode(pluginRaw));
      if (info) {
        config.plugin = info.plugin;
        if (Object.keys(info.pluginOpts).length) config.pluginOpts = info.pluginOpts;
      }
    }

    return { name: name || `${config.server}:${config.port}`, config };
  },

  toUri(name, config) {
    assertSs(config);
    const userinfo = base64Encode(`${config.cipher}:${config.password}`, true);
    const query = new URLSearchParams();
    if (config.plugin) {
      query.set('plugin', buildPluginString(config.plugin, config.pluginOpts ?? {}));
    }
    const search = query.toString();
    const frag = name ? `#${encodeURIComponent(name)}` : '';
    return `ss://${userinfo}@${wrapHost(config.server)}:${config.port}${search ? `?${search}` : ''}${frag}`;
  },

  toClash(name, config) {
    assertSs(config);
    return compact({
      name,
      type: 'ss',
      server: config.server,
      port: config.port,
      cipher: config.cipher,
      password: config.password,
      udp: config.udp,
      plugin: config.plugin,
      'plugin-opts': config.pluginOpts,
    }) as ClashProxy;
  },
};
