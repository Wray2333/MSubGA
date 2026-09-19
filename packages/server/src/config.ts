import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** src/ 和 dist/ 到仓库根的层级相同，两种运行方式都能落到同一个 data 目录 */
export const REPO_ROOT = resolve(here, '../../..');

export const DATA_DIR = process.env['MSUBGA_DATA_DIR']
  ? resolve(process.env['MSUBGA_DATA_DIR'])
  : join(REPO_ROOT, 'data');

export const DB_PATH = join(DATA_DIR, 'msubga.db');
/** 服务端缓存的规则集正文，一个规则集一个文件 */
export const RULESET_CACHE_DIR = join(DATA_DIR, 'rulesets');
export const MIHOMO_DIR = join(DATA_DIR, 'mihomo');
export const MIHOMO_BIN_DIR = join(MIHOMO_DIR, 'bin');
export const MIHOMO_RUN_DIR = join(MIHOMO_DIR, 'run');
export const MIGRATIONS_DIR = join(here, '..', 'drizzle');
/** 打包后前端静态文件的位置 */
export const WEB_DIST_DIR = join(REPO_ROOT, 'packages', 'web', 'dist');

export const PORT = Number.parseInt(process.env['PORT'] ?? '27981', 10);
export const HOST = process.env['HOST'] ?? '0.0.0.0';

/**
 * 对外访问地址，订阅链接按它拼。
 * 跑在反代后面时必须设置：服务自己只看得到 http://127.0.0.1:27981，
 * 拼出来的链接客户端根本访问不到。
 * 设置页里改过之后以库里的为准，这个环境变量只用于首次写入。
 */
export const BASE_URL_ENV = process.env['MSUBGA_BASE_URL'] ?? '';

/** 首次启动时用来设置管理员密码；之后改密码走设置页，这个环境变量就不再生效 */
export const INITIAL_PASSWORD = process.env['MSUBGA_PASSWORD'] ?? '';

/** 手动指定的 mihomo 可执行文件路径，优先级高于自动下载 */
export const MIHOMO_PATH_ENV = process.env['MIHOMO_PATH'] ?? '';

export const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';
