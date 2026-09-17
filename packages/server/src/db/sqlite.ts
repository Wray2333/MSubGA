import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * 用 Node 内置的 node:sqlite 顶掉 better-sqlite3。
 *
 * 为什么要这么做：better-sqlite3 是原生模块，没有对应 Node 版本的预编译包时就要
 * 现场 node-gyp 编译，而那需要 Python 3.8+ 和支持 C++17 的 gcc。CentOS 7 这类老系统
 * 自带 Python 3.6 + gcc 4.8，一装就炸；Node 版本一旦新过预编译包的覆盖范围，
 * 新系统上同样会走到编译这条路。
 *
 * node:sqlite 是 Node 自带的，只要 Node 跑得起来它就在，彻底没有这个问题。
 * 这里把它的接口对齐成 drizzle 的 better-sqlite3 驱动所期望的形状——
 * 驱动只用到 prepare / transaction / run / get / all / raw 这几个，面很小。
 */

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

type Params = readonly unknown[];

class CompatStatement {
  readonly #stmt: StatementSync;
  /** better-sqlite3 的 raw() 是粘性的：调过之后这条语句一直返回数组 */
  #raw = false;

  constructor(stmt: StatementSync) {
    this.#stmt = stmt;
  }

  raw(toggle = true): this {
    this.#raw = toggle;
    return this;
  }

  run(...params: Params): RunResult {
    this.#stmt.setReturnArrays(false);
    return this.#stmt.run(...(params as never[])) as RunResult;
  }

  get(...params: Params): unknown {
    this.#stmt.setReturnArrays(this.#raw);
    return this.#stmt.get(...(params as never[]));
  }

  all(...params: Params): unknown[] {
    this.#stmt.setReturnArrays(this.#raw);
    return this.#stmt.all(...(params as never[])) as unknown[];
  }
}

export class CompatDatabase {
  readonly #db: DatabaseSync;
  /** 事务深度。嵌套时用 savepoint，因为 SQLite 不支持嵌套的 BEGIN */
  #depth = 0;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);

    // setReturnArrays 是模拟 raw() 的关键；缺了它 join 查询会因为重名列丢字段
    const probe = this.#db.prepare('SELECT 1');
    if (typeof (probe as { setReturnArrays?: unknown }).setReturnArrays !== 'function') {
      throw new Error(
        `当前 Node (${process.version}) 的 node:sqlite 没有 setReturnArrays，请升级到 Node 22.13+ 或 24+`,
      );
    }
  }

  prepare(sql: string): CompatStatement {
    return new CompatStatement(this.#db.prepare(sql));
  }

  exec(sql: string): this {
    this.#db.exec(sql);
    return this;
  }

  /** better-sqlite3 的 pragma()。我们只用它做设置，不取返回值 */
  pragma(source: string): void {
    this.#db.exec(`PRAGMA ${source}`);
  }

  #runInTransaction<T extends (...args: never[]) => unknown>(fn: T, begin: string) {
    return (...args: never[]): unknown => {
      // SQLite 不支持嵌套 BEGIN，内层改用 savepoint
      const nested = this.#depth > 0;
      const savepoint = `msubga_sp_${this.#depth}`;
      this.#db.exec(nested ? `SAVEPOINT ${savepoint}` : begin);
      this.#depth++;
      try {
        const result = fn(...args);
        this.#depth--;
        this.#db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        this.#depth--;
        try {
          this.#db.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
        } catch {
          // 回滚本身失败就没什么能做的了，把原始错误抛出去更有用
        }
        throw error;
      }
    };
  }

  /**
   * better-sqlite3 的 transaction() 返回的函数上还挂着 deferred / immediate / exclusive
   * 三个变体，drizzle 调的是 `nativeTx[behavior ?? 'deferred'](...)`，所以必须一起给出来。
   */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    const run = this.#runInTransaction(fn, 'BEGIN');
    return Object.assign(run, {
      default: run,
      deferred: this.#runInTransaction(fn, 'BEGIN'),
      immediate: this.#runInTransaction(fn, 'BEGIN IMMEDIATE'),
      exclusive: this.#runInTransaction(fn, 'BEGIN EXCLUSIVE'),
    }) as unknown as T;
  }

  close(): void {
    this.#db.close();
  }
}
