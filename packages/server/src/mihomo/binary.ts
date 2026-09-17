import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { MIHOMO_BIN_DIR, MIHOMO_PATH_ENV } from '../config.js';
import { SETTING_KEYS, getSetting, setSetting } from '../lib/settings.js';

const execFileAsync = promisify(execFile);

const RELEASE_API = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest';

export interface MihomoBinary {
  path: string;
  version: string;
}

export class MihomoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MihomoUnavailableError';
  }
}

/* -------------------------------------------------------------------------- */
/*                                 平台与资源名                                 */
/* -------------------------------------------------------------------------- */

const OS_MAP: Record<string, string> = {
  win32: 'windows',
  darwin: 'darwin',
  linux: 'linux',
  freebsd: 'freebsd',
};

const ARCH_MAP: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
  ia32: '386',
  arm: 'armv7',
};

function platformTriple(): { os: string; arch: string; ext: 'zip' | 'gz'; exe: string } {
  const os = OS_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!os || !arch) {
    throw new MihomoUnavailableError(
      `没有对应 ${process.platform}/${process.arch} 的 mihomo 预编译版本，请在设置里手动指定可执行文件路径`,
    );
  }
  return {
    os,
    arch,
    ext: os === 'windows' ? 'zip' : 'gz',
    exe: os === 'windows' ? '.exe' : '',
  };
}

/**
 * 从 release 资源里挑出该平台的那一个。
 * 必须排除 `-go1xx-`（按 Go 版本切分的构建）和 `-v1/-v2/-v3-`（按 CPU 指令集切分的构建），
 * 只取无后缀的通用版；老 CPU 跑不起来时再退到 `-compatible`。
 */
export function pickAssetName(assets: readonly string[], version: string, compatible = false): string | undefined {
  const { os, arch, ext } = platformTriple();
  const suffix = compatible ? '-compatible' : '';
  const want = `mihomo-${os}-${arch}${suffix}-${version}.${ext}`;
  return assets.find((name) => name === want);
}

/* -------------------------------------------------------------------------- */
/*                                   查找已有                                   */
/* -------------------------------------------------------------------------- */

/** 设置页填的路径 > MIHOMO_PATH 环境变量 > 之前下载到 data 目录里的 */
export function locateExisting(): string | undefined {
  const configured = getSetting(SETTING_KEYS.mihomoPath);
  if (configured && existsSync(configured)) return configured;
  if (MIHOMO_PATH_ENV && existsSync(MIHOMO_PATH_ENV)) return MIHOMO_PATH_ENV;

  const { exe } = platformTriple();
  const downloaded = join(MIHOMO_BIN_DIR, `mihomo${exe}`);
  if (existsSync(downloaded)) return downloaded;

  return undefined;
}

export async function probeVersion(binaryPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['-v'], { timeout: 10_000 });
    return /v\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? stdout.trim().split('\n')[0] ?? 'unknown';
  } catch (error) {
    throw new MihomoUnavailableError(
      `无法运行 mihomo (${binaryPath}): ${(error as Error).message}。` +
        '如果是 amd64 老 CPU，试试下载 compatible 版本。',
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                                    下载                                     */
/* -------------------------------------------------------------------------- */

export interface DownloadProgress {
  stage: 'query' | 'download' | 'extract' | 'verify' | 'done';
  message: string;
}

async function fetchLatestRelease(): Promise<{ version: string; assets: Map<string, string> }> {
  const response = await fetch(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MSubGA' },
  });
  if (!response.ok) {
    throw new MihomoUnavailableError(
      `查询 mihomo 最新版本失败: HTTP ${response.status}。网络不通的话，可以手动下载后在设置里指定路径。`,
    );
  }
  const body = (await response.json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };
  return {
    version: body.tag_name,
    assets: new Map(body.assets.map((a) => [a.name, a.browser_download_url])),
  };
}

function extractBinary(buffer: Buffer, assetName: string): Buffer {
  if (assetName.endsWith('.gz')) return gunzipSync(buffer);

  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find((e) => !e.isDirectory && /mihomo.*\.exe$/i.test(e.entryName));
  if (!entry) throw new MihomoUnavailableError(`压缩包 ${assetName} 里找不到 mihomo 可执行文件`);
  return entry.getData();
}

export async function downloadMihomo(
  onProgress: (progress: DownloadProgress) => void = () => {},
): Promise<MihomoBinary> {
  onProgress({ stage: 'query', message: '正在查询最新版本…' });
  const { version, assets } = await fetchLatestRelease();

  const names = [...assets.keys()];
  const assetName = pickAssetName(names, version) ?? pickAssetName(names, version, true);
  if (!assetName) {
    const { os, arch } = platformTriple();
    throw new MihomoUnavailableError(
      `${version} 这个版本里没有 ${os}-${arch} 的资源，请手动下载后在设置里指定路径`,
    );
  }

  onProgress({ stage: 'download', message: `正在下载 ${assetName}…` });
  const response = await fetch(assets.get(assetName)!, { headers: { 'User-Agent': 'MSubGA' } });
  if (!response.ok) {
    throw new MihomoUnavailableError(`下载 ${assetName} 失败: HTTP ${response.status}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());

  onProgress({ stage: 'extract', message: '正在解压…' });
  const binary = extractBinary(archive, assetName);

  mkdirSync(MIHOMO_BIN_DIR, { recursive: true });
  const { exe } = platformTriple();
  const target = join(MIHOMO_BIN_DIR, `mihomo${exe}`);
  writeFileSync(target, binary);
  if (process.platform !== 'win32') chmodSync(target, 0o755);

  onProgress({ stage: 'verify', message: '正在校验…' });
  const actualVersion = await probeVersion(target);

  setSetting(SETTING_KEYS.mihomoPath, target);
  setSetting(SETTING_KEYS.mihomoVersion, actualVersion);
  onProgress({ stage: 'done', message: `mihomo ${actualVersion} 就绪` });

  return { path: target, version: actualVersion };
}

/* -------------------------------------------------------------------------- */

/** 拿到可用的内核；allowDownload 为 false 时只查找已有的，不联网 */
export async function resolveMihomoBinary(allowDownload = true): Promise<MihomoBinary> {
  const existing = locateExisting();
  if (existing) {
    const version = getSetting(SETTING_KEYS.mihomoVersion) ?? (await probeVersion(existing));
    setSetting(SETTING_KEYS.mihomoVersion, version);
    return { path: existing, version };
  }
  if (!allowDownload) {
    throw new MihomoUnavailableError('还没有可用的 mihomo 内核，去设置页下载或手动指定路径');
  }
  return downloadMihomo();
}

/** 设置页展示用 */
export function describeBinary(): { path?: string; version?: string; ready: boolean } {
  const path = locateExisting();
  return {
    path,
    version: getSetting(SETTING_KEYS.mihomoVersion),
    ready: Boolean(path),
  };
}
