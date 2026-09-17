import { mkdirSync } from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect';
import { DATA_DIR, DB_PATH, MIGRATIONS_DIR } from '../config.js';
import * as schema from './schema.js';
import { CompatDatabase } from './sqlite.js';

mkdirSync(DATA_DIR, { recursive: true });

// 用 Node 内置 sqlite 的适配层，不引任何原生模块（原因见 sqlite.ts）
export const sqlite = new CompatDatabase(DB_PATH);
// WAL 让读写不互相阻塞：订阅出口在读的同时，测速任务还在写结果
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

/*
 * 这里没有用 drizzle-orm/better-sqlite3 的 drizzle()，而是自己拼装。
 * 原因：那个模块顶部有 `import Client from "better-sqlite3"`，只为支持
 * 「传路径让它自己建连接」这条我们用不到的路径，但会让整个进程硬依赖那个原生包。
 * session / dialect / db / migrator 这几个子模块都不碰它，拼起来即可。
 */
const dialect = new SQLiteSyncDialect({});
const session = new BetterSQLiteSession(sqlite as never, dialect, undefined, {});

export const db = new BaseSQLiteDatabase('sync', dialect, session, undefined) as BaseSQLiteDatabase<
  'sync',
  { changes: number; lastInsertRowid: number | bigint },
  typeof schema
>;
export type Db = typeof db;

export function runMigrations(): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

export { schema };
export * from './schema.js';
