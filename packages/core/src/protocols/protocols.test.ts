import { describe, expect, it } from 'vitest';
import { nodeToClash, nodeToUri, parseNodeUri } from './index.js';
import type { ProxyConfig } from '../types.js';

/** 解析 -> 序列化 -> 再解析，配置必须完全一致 */
function roundTrip(uri: string): ProxyConfig {
  const first = parseNodeUri(uri);
  const second = parseNodeUri(nodeToUri(first));
  expect(second.config).toEqual(first.config);
  return first.config;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('vless', () => {
  const reality =
    'vless://b831381d-6324-4d53-ad4f-8cda48b30811@1.2.3.4:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=PUBKEY123&sid=ab12&type=tcp&flow=xtls-rprx-vision#%E9%A6%99%E6%B8%AF%20A';

  it('解析 reality 节点', () => {
    const node = parseNodeUri(reality);
    expect(node.name).toBe('香港 A');
    expect(node.config).toMatchObject({
      type: 'vless',
      server: '1.2.3.4',
      port: 443,
      uuid: 'b831381d-6324-4d53-ad4f-8cda48b30811',
      flow: 'xtls-rprx-vision',
      tls: {
        enabled: true,
        sni: 'www.microsoft.com',
        fingerprint: 'chrome',
        reality: { publicKey: 'PUBKEY123', shortId: 'ab12' },
      },
      transport: { network: 'tcp' },
    });
  });

  it('reality 节点可往返', () => {
    roundTrip(reality);
  });

  it('ws + tls 的 path 和 Host 头都要保住', () => {
    const uri =
      'vless://uuid-1@cdn.example.com:443?encryption=none&security=tls&sni=edge.example.com&type=ws&path=%2Fray%3Fed%3D2048&host=edge.example.com#WS';
    const config = roundTrip(uri);
    expect(config).toMatchObject({
      transport: { network: 'ws', path: '/ray?ed=2048', headers: { Host: 'edge.example.com' } },
      tls: { enabled: true, sni: 'edge.example.com' },
    });
  });

  it('生成的 clash 片段用 servername 而不是 sni', () => {
    const clash = nodeToClash(parseNodeUri(reality));
    expect(clash).toMatchObject({
      type: 'vless',
      servername: 'www.microsoft.com',
      'client-fingerprint': 'chrome',
      'reality-opts': { 'public-key': 'PUBKEY123', 'short-id': 'ab12' },
      tls: true,
    });
    expect(clash).not.toHaveProperty('sni');
  });

  it('grpc 的 serviceName 要落到 grpc-opts', () => {
    const node = parseNodeUri(
      'vless://uuid-2@g.example.com:443?encryption=none&security=tls&type=grpc&serviceName=mysvc#G',
    );
    expect(nodeToClash(node)).toMatchObject({
      network: 'grpc',
      'grpc-opts': { 'grpc-service-name': 'mysvc' },
    });
  });

  it('type=tcp&headerType=http 映射到 clash 的 http 而不是 h2', () => {
    const node = parseNodeUri(
      'vless://uuid-3@h.example.com:80?encryption=none&type=tcp&headerType=http&host=a.com,b.com&path=%2Fone#H',
    );
    expect(node.config).toMatchObject({
      transport: { network: 'http', host: ['a.com', 'b.com'], path: ['/one'] },
    });
    expect(nodeToClash(node)).toMatchObject({ network: 'http' });
  });

  it('type=http 是 HTTP/2，映射到 clash 的 h2', () => {
    const node = parseNodeUri(
      'vless://uuid-4@h2.example.com:443?encryption=none&security=tls&type=http&host=a.com&path=%2Ftwo#H2',
    );
    expect(node.config).toMatchObject({ transport: { network: 'h2', host: ['a.com'], path: '/two' } });
    expect(nodeToClash(node)).toMatchObject({
      network: 'h2',
      'h2-opts': { host: ['a.com'], path: '/two' },
    });
  });

  it('不支持的传输方式要报错而不是静默丢字段', () => {
    expect(() => parseNodeUri('vless://uuid-5@k.example.com:443?encryption=none&type=kcp#K')).toThrowError(
      /不支持的传输方式/,
    );
  });
});

describe('vmess', () => {
  const json = {
    v: '2',
    ps: '日本节点',
    add: 'jp.example.com',
    port: '443',
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    aid: '0',
    scy: 'auto',
    net: 'ws',
    type: 'none',
    host: 'jp.example.com',
    path: '/vm',
    tls: 'tls',
  };
  const uri = `vmess://${b64(JSON.stringify(json))}`;

  it('解析 base64 JSON 形态', () => {
    const node = parseNodeUri(uri);
    expect(node.name).toBe('日本节点');
    expect(node.config).toMatchObject({
      type: 'vmess',
      server: 'jp.example.com',
      port: 443,
      alterId: 0,
      cipher: 'auto',
      transport: { network: 'ws', path: '/vm', headers: { Host: 'jp.example.com' } },
      tls: { enabled: true, sni: 'jp.example.com' },
    });
  });

  it('可往返', () => {
    roundTrip(uri);
  });

  it('端口和 aid 是数字类型也要吃下', () => {
    const node = parseNodeUri(`vmess://${b64(JSON.stringify({ ...json, port: 8443, aid: 2 }))}`);
    expect(node.config).toMatchObject({ port: 8443, alterId: 2 });
  });
});

describe('trojan', () => {
  const uri =
    'trojan://my%3Apassword@tj.example.com:443?sni=tj.example.com&type=ws&path=%2Ftj&allowInsecure=1#TJ';

  it('密码里的冒号不能丢', () => {
    expect(parseNodeUri(uri).config).toMatchObject({
      type: 'trojan',
      password: 'my:password',
      tls: { enabled: true, sni: 'tj.example.com', skipCertVerify: true },
      transport: { network: 'ws', path: '/tj' },
    });
  });

  it('可往返', () => {
    roundTrip(uri);
  });

  it('clash 片段不写 tls 字段（trojan 自带 TLS），用 sni', () => {
    const clash = nodeToClash(parseNodeUri(uri));
    expect(clash).not.toHaveProperty('tls');
    expect(clash).toMatchObject({ sni: 'tj.example.com', 'skip-cert-verify': true });
  });
});

describe('shadowsocks', () => {
  it('SIP002 形态', () => {
    const uri = `ss://${b64('aes-256-gcm:mypass')}@ss.example.com:8388#SS`;
    expect(roundTrip(uri)).toMatchObject({
      type: 'ss',
      cipher: 'aes-256-gcm',
      password: 'mypass',
      port: 8388,
    });
  });

  it('旧格式：整段 base64', () => {
    const node = parseNodeUri(`ss://${b64('chacha20-ietf-poly1305:pw@old.example.com:1234')}#Legacy`);
    expect(node.name).toBe('Legacy');
    expect(node.config).toMatchObject({
      type: 'ss',
      cipher: 'chacha20-ietf-poly1305',
      password: 'pw',
      server: 'old.example.com',
      port: 1234,
    });
  });

  it('明文 userinfo 形态', () => {
    expect(parseNodeUri('ss://aes-128-gcm:plain%40pw@p.example.com:443#P').config).toMatchObject({
      cipher: 'aes-128-gcm',
      password: 'plain@pw',
    });
  });

  it('obfs 插件翻译成 clash 的 plugin-opts', () => {
    const uri = `ss://${b64('aes-256-gcm:pw')}@o.example.com:443?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dwww.bing.com#O`;
    const node = parseNodeUri(uri);
    expect(node.config).toMatchObject({ plugin: 'obfs', pluginOpts: { mode: 'http', host: 'www.bing.com' } });
    expect(nodeToClash(node)).toMatchObject({
      plugin: 'obfs',
      'plugin-opts': { mode: 'http', host: 'www.bing.com' },
    });
    roundTrip(uri);
  });
});

describe('hysteria2', () => {
  const uri =
    'hysteria2://pass123@hy.example.com:8443?sni=hy.example.com&insecure=1&obfs=salamander&obfs-password=obfspw&mport=8443-9000#HY2';

  it('解析 obfs 与端口跳跃', () => {
    expect(roundTrip(uri)).toMatchObject({
      type: 'hysteria2',
      password: 'pass123',
      ports: '8443-9000',
      obfs: 'salamander',
      obfsPassword: 'obfspw',
      tls: { enabled: true, sni: 'hy.example.com', skipCertVerify: true },
    });
  });

  it('hy2:// 是同一个协议', () => {
    expect(parseNodeUri('hy2://p@a.com:443#X').config.type).toBe('hysteria2');
  });

  it('pinSHA256 落到 clash 的 fingerprint，而不是 client-fingerprint', () => {
    const clash = nodeToClash(parseNodeUri('hysteria2://p@a.com:443?pinSHA256=ABCDEF#X'));
    expect(clash['fingerprint']).toBe('ABCDEF');
    expect(clash).not.toHaveProperty('client-fingerprint');
  });
});

describe('tuic', () => {
  it('v5 的 uuid:password', () => {
    const uri =
      'tuic://11111111-2222-3333-4444-555555555555:tpass@tuic.example.com:443?sni=tuic.example.com&alpn=h3&congestion_control=bbr&udp_relay_mode=native#TUIC';
    expect(roundTrip(uri)).toMatchObject({
      type: 'tuic',
      uuid: '11111111-2222-3333-4444-555555555555',
      password: 'tpass',
      congestionController: 'bbr',
      udpRelayMode: 'native',
      tls: { alpn: ['h3'] },
    });
  });

  it('v4 的单 token', () => {
    const node = parseNodeUri('tuic://sometoken@t4.example.com:443#T4');
    expect(node.config).toMatchObject({ token: 'sometoken' });
    expect(node.config).not.toHaveProperty('uuid');
  });
});

describe('anytls / http / socks5', () => {
  it('anytls', () => {
    expect(roundTrip('anytls://pw@any.example.com:443?sni=any.example.com&insecure=1#Any')).toMatchObject({
      type: 'anytls',
      password: 'pw',
    });
  });

  it('socks5 带认证', () => {
    expect(roundTrip('socks5://user:p%40ss@s5.example.com:1080#S5')).toMatchObject({
      type: 'socks5',
      username: 'user',
      password: 'p@ss',
      port: 1080,
    });
  });

  it('https 代理默认开 tls 和 443 端口', () => {
    const node = parseNodeUri('https://u:p@proxy.example.com');
    expect(node.config).toMatchObject({ type: 'http', port: 443, tls: { enabled: true } });
    expect(nodeToClash(node)).toMatchObject({ type: 'http', tls: true });
  });

  it('socks5h 当成 socks5', () => {
    expect(parseNodeUri('socks5h://a.com:1080').config.type).toBe('socks5');
  });
});

describe('错误处理', () => {
  it('端口非法要报错', () => {
    expect(() => parseNodeUri('vless://u@a.com:99999?encryption=none#X')).toThrowError(/端口/);
  });

  it('缺 uuid 要报错', () => {
    expect(() => parseNodeUri('vless://a.com:443?encryption=none#X')).toThrowError(/uuid/);
  });

  it('未知协议要报错', () => {
    expect(() => parseNodeUri('ssr://whatever')).toThrowError(/暂不支持的协议/);
  });
});
