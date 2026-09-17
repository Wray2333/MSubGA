import type { HttpConfig, ParsedNode, PlaintextType, Socks5Config } from '../types.js';
import { defaultTls } from '../types.js';
import { fail, parsePort, stripBrackets } from '../protocols/shared.js';

/**
 * `host:port:user:pass` 这类纯文本节点。除了冒号，也吃空格、逗号、制表符和竖线分隔。
 * 密码放在最后，允许包含分隔符本身。
 */
const LINE_RE =
  /^\s*(?<host>\[[^\]]+\]|[^\s,:|]+)[\s,:|]+(?<port>\d{1,5})(?:[\s,:|]+(?<user>[^\s,:|]+)(?:[\s,:|]+(?<pass>.+?))?)?\s*$/;

/** user:pass@host:port */
const AT_RE = /^\s*(?<cred>[^@]*)@(?<hostport>\S+)\s*$/;

function build(
  type: PlaintextType,
  server: string,
  port: number,
  username?: string,
  password?: string,
): ParsedNode {
  const tls = defaultTls();
  const config: HttpConfig | Socks5Config =
    type === 'http'
      ? { type: 'http', server, port, tls }
      : { type: 'socks5', server, port, tls, udp: true };
  if (username) config.username = username;
  if (password) config.password = password;
  return { name: `${server}:${port}`, config };
}

export function parsePlaintextNode(line: string, type: PlaintextType): ParsedNode {
  const raw = line.trim();
  if (!raw) fail('空行', raw);

  const at = AT_RE.exec(raw);
  if (at?.groups) {
    const cred = at.groups['cred'] ?? '';
    const hostport = at.groups['hostport'] ?? '';
    const colon = cred.indexOf(':');
    const username = colon === -1 ? cred || undefined : cred.slice(0, colon);
    const password = colon === -1 ? undefined : cred.slice(colon + 1);

    const sep = hostport.lastIndexOf(':');
    if (sep === -1) fail('缺少端口', raw);
    const server = stripBrackets(hostport.slice(0, sep));
    if (!server) fail('缺少服务器地址', raw);
    return build(type, server, parsePort(hostport.slice(sep + 1), raw), username, password);
  }

  const match = LINE_RE.exec(raw);
  if (!match?.groups) fail('无法识别的节点格式', raw);
  const server = stripBrackets(match.groups['host'] ?? '');
  if (!server) fail('缺少服务器地址', raw);
  return build(
    type,
    server,
    parsePort(match.groups['port'] ?? '', raw),
    match.groups['user'],
    match.groups['pass'],
  );
}
