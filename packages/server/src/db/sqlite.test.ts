import { describe, expect, it } from 'vitest';
import { CompatDatabase } from './sqlite.js';

function seeded(): CompatDatabase {
  const db = new CompatDatabase(':memory:');
  db.exec('CREATE TABLE a (id TEXT, name TEXT)');
  db.exec('CREATE TABLE b (id TEXT, label TEXT)');
  db.prepare('INSERT INTO a VALUES (?, ?)').run('a1', 'alpha');
  db.prepare('INSERT INTO b VALUES (?, ?)').run('b1', 'beta');
  return db;
}

describe('node:sqlite 适配层', () => {
  it('普通查询返回对象', () => {
    const db = seeded();
    expect(db.prepare('SELECT * FROM a').all()).toEqual([{ id: 'a1', name: 'alpha' }]);
    expect(db.prepare('SELECT * FROM a').get()).toEqual({ id: 'a1', name: 'alpha' });
  });

  it('raw() 返回数组 —— join 里的重名列不能被吃掉', () => {
    const db = seeded();
    // 对象形态下两个 id 会塌成一个，drizzle 正是靠 raw 模式避免这件事
    const stmt = db.prepare('SELECT a.id, b.id, a.name FROM a, b');
    expect(stmt.raw().all()).toEqual([['a1', 'b1', 'alpha']]);
    expect(db.prepare('SELECT a.id, b.id, a.name FROM a, b').raw().get()).toEqual([
      'a1',
      'b1',
      'alpha',
    ]);
  });

  it('raw() 是粘性的，和 better-sqlite3 行为一致', () => {
    const db = seeded();
    const stmt = db.prepare('SELECT * FROM a');
    stmt.raw();
    expect(stmt.all()).toEqual([['a1', 'alpha']]);
    stmt.raw(false);
    expect(stmt.all()).toEqual([{ id: 'a1', name: 'alpha' }]);
  });

  it('run() 返回 changes 和 lastInsertRowid', () => {
    const db = seeded();
    const result = db.prepare('INSERT INTO a VALUES (?, ?)').run('a2', 'gamma');
    expect(result.changes).toBe(1);
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
    expect(db.prepare('UPDATE a SET name = ?').run('x').changes).toBe(2);
  });

  it('参数按位置绑定', () => {
    const db = seeded();
    expect(db.prepare('SELECT name FROM a WHERE id = ?').get('a1')).toEqual({ name: 'alpha' });
    expect(db.prepare('SELECT name FROM a WHERE id = ?').get('nope')).toBeUndefined();
  });
});

describe('事务', () => {
  it('提交后数据留下', () => {
    const db = seeded();
    db.transaction(() => {
      db.prepare('INSERT INTO a VALUES (?, ?)').run('a2', 'gamma');
    })();
    expect(db.prepare('SELECT count(*) c FROM a').get()).toEqual({ c: 2 });
  });

  it('抛错要整体回滚', () => {
    const db = seeded();
    const boom = db.transaction(() => {
      db.prepare('INSERT INTO a VALUES (?, ?)').run('a2', 'gamma');
      throw new Error('boom');
    });
    expect(() => boom()).toThrowError('boom');
    expect(db.prepare('SELECT count(*) c FROM a').get()).toEqual({ c: 1 });
  });

  it('嵌套事务走 savepoint，内层回滚不影响外层', () => {
    const db = seeded();
    db.transaction(() => {
      db.prepare('INSERT INTO a VALUES (?, ?)').run('outer', 'o');
      const inner = db.transaction(() => {
        db.prepare('INSERT INTO a VALUES (?, ?)').run('inner', 'i');
        throw new Error('inner failed');
      });
      expect(() => inner()).toThrowError('inner failed');
    })();

    const ids = db.prepare('SELECT id FROM a ORDER BY id').all() as { id: string }[];
    expect(ids.map((row) => row.id)).toEqual(['a1', 'outer']);
  });

  it('暴露 drizzle 需要的 deferred / immediate / exclusive 变体', () => {
    const db = seeded();
    const tx = db.transaction(() => db.prepare('INSERT INTO a VALUES (?, ?)').run('x', 'y')) as unknown as Record<
      string,
      () => void
    >;
    for (const behavior of ['deferred', 'immediate', 'exclusive']) {
      expect(typeof tx[behavior]).toBe('function');
    }
    tx['deferred']!();
    expect(db.prepare('SELECT count(*) c FROM a').get()).toEqual({ c: 2 });
  });

  it('事务返回值要透传出来', () => {
    const db = seeded();
    expect(db.transaction(() => 42)()).toBe(42);
  });
});
