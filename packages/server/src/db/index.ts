import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DATA_DIR, DB_PATH, MIGRATIONS_DIR } from '../config.js';
import * as schema from './schema.js';

mkdirSync(DATA_DIR, { recursive: true });

export const sqlite = new Database(DB_PATH);
// WAL 让读写不互相阻塞：订阅出口在读的同时，测速任务还在写结果
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;

export function runMigrations(): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

export { schema };
export * from './schema.js';
