import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MIHOMO_RUN_DIR } from '../config.js';
import { resolveMihomoBinary } from './binary.js';

export interface CoreValidationResult {
  ok: boolean;
  /** 内核的原始输出，出错时直接展示给用户 */
  output: string;
}

/**
 * 拿真正的内核去校验生成出来的配置（mihomo -t）。
 * 这是「生成的订阅一定能被客户端加载」的最后一道保证——
 * 我们自己的校验器只看得到模板结构，看不到内核对字段的具体要求。
 */
export function validateConfigWithCore(yaml: string): Promise<CoreValidationResult> {
  return new Promise((resolve) => {
    void (async () => {
      let binaryPath: string;
      try {
        binaryPath = (await resolveMihomoBinary(false)).path;
      } catch (error) {
        resolve({ ok: false, output: `内核不可用: ${(error as Error).message}` });
        return;
      }

      mkdirSync(MIHOMO_RUN_DIR, { recursive: true });
      const file = join(MIHOMO_RUN_DIR, `validate-${randomBytes(6).toString('hex')}.yaml`);
      writeFileSync(file, yaml, 'utf8');

      execFile(
        binaryPath,
        ['-t', '-d', MIHOMO_RUN_DIR, '-f', file],
        { timeout: 30_000 },
        (error, stdout, stderr) => {
          rmSync(file, { force: true });
          const output = `${stdout}${stderr}`.trim();
          resolve({ ok: !error, output: output || (error ? String(error.message) : '配置合法') });
        },
      );
    })();
  });
}
