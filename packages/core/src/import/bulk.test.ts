import { describe, expect, it } from 'vitest';
import { parseBulk } from './bulk.js';
import { fingerprintConfig } from './fingerprint.js';
import { parsePlaintextNode } from './plaintext.js';
import { parseNodeUri } from '../protocols/index.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('纯文本节点', () => {
  it.each([
    ['1.2.3.4:8080:user:pass', '1.2.3.4', 8080, 'user', 'pass'],
    ['1.2.3.4:8080', '1.2.3.4', 8080, undefined, undefined],
    ['user:pass@1.2.3.4:8080', '1.2.3.4', 8080, 'user', 'pass'],
    ['1.2.3.4,8080,user,pass', '1.2.3.4', 8080, 'user', 'pass'],
    ['1.2.3.4\t8080\tuser\tpass', '1.2.3.4', 8080, 'user', 'pass'],
    ['proxy.example.com 3128 alice s3cret', 'proxy.example.com', 3128, 'alice', 's3cret'],
  ])('吃下 %s', (line, server, port, username, password) => {
    const node = parsePlaintextNode(line, 'socks5');
    expect(node.config).toMatchObject({ type: 'socks5', server, port });
    expect((node.config as { username?: string }).username).toBe(username);
    expect((node.config as { password?: string }).password).toBe(password);
  });

  it('密码里含冒号时，最后一段整体当密码', () => {
    const node = parsePlaintextNode('1.2.3.4:8080:user:pa:ss:word', 'socks5');
    expect(node.config).toMatchObject({ password: 'pa:ss:word' });
  });

  it('按 http 解析时类型跟着变', () => {
    expect(parsePlaintextNode('1.2.3.4:8080:u:p', 'http').config.type).toBe('http');
  });

  it('端口缺失要报错', () => {
    expect(() => parsePlaintextNode('just-a-hostname', 'socks5')).toThrowError();
  });

  it('端口越界要报错', () => {
    expect(() => parsePlaintextNode('1.2.3.4:70000:u:p', 'socks5')).toThrowError(/端口/);
  });
});

describe('批量导入', () => {
  it('混合链接和纯文本，各按各的规则解析', () => {
    const text = [
      '# 这是注释',
      'vless://uuid-a@a.example.com:443?encryption=none&security=tls#A',
      '1.2.3.4:1080:user:pass',
      '',
      'trojan://pw@b.example.com:443#B',
    ].join('\n');

    const result = parseBulk(text, { defaultPlainType: 'socks5' });
    expect(result.failures).toEqual([]);
    expect(result.candidates.map((c) => c.config.type)).toEqual(['vless', 'socks5', 'trojan']);
    expect(result.candidates.map((c) => c.name)).toEqual(['A', '1.2.3.4:1080', 'B']);
  });

  it('整段 base64 自动解码', () => {
    const inner = 'vless://u1@a.com:443?encryption=none#A\nvless://u2@b.com:443?encryption=none#B';
    const result = parseBulk(b64(inner), { defaultPlainType: 'socks5' });
    expect(result.decodedBase64).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });

  it('批内重复按指纹去掉，只留第一条', () => {
    const line = 'vless://u1@a.com:443?encryption=none#A';
    const result = parseBulk([line, line, `${line}B`].join('\n'), { defaultPlainType: 'socks5' });
    // 第三条只是名字不同，指纹一样，也算重复
    expect(result.candidates).toHaveLength(1);
    expect(result.duplicatesInBatch).toBe(2);
  });

  it('坏行不中断，带行号收集进 failures', () => {
    const text = [
      'vless://ok@a.com:443?encryption=none#OK',
      'ssr://unsupported',
      'vless://u@a.com:99999?encryption=none#BadPort',
      '完全不是节点',
    ].join('\n');

    const result = parseBulk(text, { defaultPlainType: 'socks5' });
    expect(result.candidates).toHaveLength(1);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.map((f) => f.line)).toEqual([2, 3, 4]);
    expect(result.failures[0]?.reason).toMatch(/暂不支持的协议/);
    expect(result.failures[1]?.reason).toMatch(/端口/);
  });

  it('名称前缀会加到每个节点上', () => {
    const result = parseBulk('vless://u@a.com:443?encryption=none#A', {
      defaultPlainType: 'socks5',
      namePrefix: '[机场1] ',
    });
    expect(result.candidates[0]?.name).toBe('[机场1] A');
  });
});

describe('指纹', () => {
  it('改名不影响指纹', () => {
    const a = parseNodeUri('vless://u@a.com:443?encryption=none#名字一');
    const b = parseNodeUri('vless://u@a.com:443?encryption=none#名字二');
    expect(fingerprintConfig(a.config)).toBe(fingerprintConfig(b.config));
  });

  it('主机名大小写不同也算同一个节点', () => {
    const a = parseNodeUri('vless://u@A.Example.COM:443?encryption=none#X');
    const b = parseNodeUri('vless://u@a.example.com:443?encryption=none#X');
    expect(fingerprintConfig(a.config)).toBe(fingerprintConfig(b.config));
  });

  it('任一配置字段变了就是另一个节点', () => {
    const a = parseNodeUri('vless://u@a.com:443?encryption=none&type=ws&path=%2Fx#X');
    const b = parseNodeUri('vless://u@a.com:443?encryption=none&type=ws&path=%2Fy#X');
    expect(fingerprintConfig(a.config)).not.toBe(fingerprintConfig(b.config));
  });
});
