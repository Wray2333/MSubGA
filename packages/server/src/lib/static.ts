import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { MiddlewareHandler } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 托管打包后的前端。SPA 路由（没有扩展名的路径）一律回 index.html。
 * 带 hash 的静态资源长缓存，index.html 不缓存，否则前端更新后用户还拿旧的。
 */
export function serveWebDist(rootDir: string): MiddlewareHandler {
  const root = resolve(rootDir);

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();

    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const ext = extname(pathname);

    // 目录穿越防护：拼完路径必须仍在 root 下
    const candidate = resolve(join(root, normalize(pathname)));
    const inRoot = candidate === root || candidate.startsWith(root + sep);

    if (ext && inRoot && existsSync(candidate) && statSync(candidate).isFile()) {
      return c.body(readFileSync(candidate), 200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': pathname === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
    }

    const indexPath = join(root, 'index.html');
    if (!ext && existsSync(indexPath)) {
      return c.body(readFileSync(indexPath), 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
    }

    return next();
  };
}
