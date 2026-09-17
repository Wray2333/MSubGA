import type { ParsedNode, PlaintextType } from '../types.js';
import { isSupportedUri, parseNodeUri, schemeOf } from '../protocols/index.js';
import { ParseError, tryBase64Decode } from '../protocols/shared.js';
import { fingerprintConfig } from './fingerprint.js';
import { parsePlaintextNode } from './plaintext.js';

export interface BulkImportOptions {
  /** 纯文本节点（host:port:user:pass）按哪种协议解析 */
  defaultPlainType: PlaintextType;
  /** 给所有导入的节点名统一加前缀 */
  namePrefix?: string;
}

export interface ImportCandidate {
  /** 原始行号，从 1 开始 */
  line: number;
  raw: string;
  name: string;
  config: ParsedNode['config'];
  fingerprint: string;
}

export interface ImportFailure {
  line: number;
  raw: string;
  reason: string;
}

export interface BulkImportResult {
  candidates: ImportCandidate[];
  failures: ImportFailure[];
  /** 批内重复被丢掉的条数 */
  duplicatesInBatch: number;
  /** 输入整体是 base64 包，已自动解码 */
  decodedBase64: boolean;
}

function isComment(line: string): boolean {
  return line.startsWith('#') || line.startsWith('//') || line.startsWith(';');
}

function reasonOf(error: unknown): string {
  if (error instanceof ParseError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 批量解析粘贴进来的文本。
 * 整段是 base64 包时先解码；之后逐行判断是节点链接还是纯文本格式。
 * 解析失败的行不会中断流程，而是收集进 failures 带行号返回，让用户在预览里看到。
 */
export function parseBulk(text: string, options: BulkImportOptions): BulkImportResult {
  let source = text.trim();
  let decodedBase64 = false;

  if (source && !source.includes('://')) {
    const decoded = tryBase64Decode(source);
    if (decoded && decoded.includes('://')) {
      source = decoded.trim();
      decodedBase64 = true;
    }
  }

  const candidates: ImportCandidate[] = [];
  const failures: ImportFailure[] = [];
  const seen = new Set<string>();
  let duplicatesInBatch = 0;

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? '').trim();
    if (!raw || isComment(raw)) continue;
    const line = i + 1;

    let parsed: ParsedNode;
    try {
      if (isSupportedUri(raw)) {
        parsed = parseNodeUri(raw);
      } else {
        const scheme = schemeOf(raw);
        if (scheme) {
          failures.push({ line, raw, reason: `暂不支持的协议: ${scheme}` });
          continue;
        }
        parsed = parsePlaintextNode(raw, options.defaultPlainType);
      }
    } catch (error) {
      failures.push({ line, raw, reason: reasonOf(error) });
      continue;
    }

    const fingerprint = fingerprintConfig(parsed.config);
    if (seen.has(fingerprint)) {
      duplicatesInBatch++;
      continue;
    }
    seen.add(fingerprint);

    const name = options.namePrefix ? `${options.namePrefix}${parsed.name}` : parsed.name;
    candidates.push({ line, raw, name, config: parsed.config, fingerprint });
  }

  return { candidates, failures, duplicatesInBatch, decodedBase64 };
}
