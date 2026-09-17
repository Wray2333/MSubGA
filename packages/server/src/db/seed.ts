import { BUILTIN_PROFILES, BUILTIN_RULESETS } from '@msubga/core';
import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { ruleProfiles, rulesets } from './schema.js';

/**
 * 写入内置规则集和规则模板。
 * 内置项在 API 层是只读的（只能复制一份再改），所以这里可以放心覆盖写，
 * 升级时新增的规则集和修正过的 URL 都能直接生效。
 */
export function seedBuiltins(): void {
  const now = Date.now();

  db.transaction((tx) => {
    for (const ruleset of BUILTIN_RULESETS) {
      tx.insert(rulesets)
        .values({
          id: ruleset.id,
          name: ruleset.name,
          description: ruleset.description ?? null,
          kind: ruleset.kind,
          behavior: ruleset.behavior,
          format: ruleset.format,
          url: ruleset.url ?? null,
          content: ruleset.content ?? null,
          builtin: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: rulesets.id,
          set: {
            name: ruleset.name,
            description: ruleset.description ?? null,
            behavior: ruleset.behavior,
            format: ruleset.format,
            url: ruleset.url ?? null,
            updatedAt: now,
          },
        })
        .run();
    }

    for (const profile of BUILTIN_PROFILES) {
      tx.insert(ruleProfiles)
        .values({
          id: profile.id,
          name: profile.name,
          description: profile.description ?? null,
          definition: profile.definition,
          builtin: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: ruleProfiles.id,
          set: {
            name: profile.name,
            description: profile.description ?? null,
            definition: profile.definition,
            updatedAt: now,
          },
        })
        .run();
    }

    /*
     * 清掉已经不在预置列表里的内置规则集。
     * 换过规则集来源之后，旧的那批留在库里只会让人困惑。
     * 但被模板引用着的不能删——用户可能复制过内置模板再改，
     * 删了会让他们的模板直接生成不出配置。这种就改成非内置，交给用户自己处置。
     */
    const keep = new Set(BUILTIN_RULESETS.map((item) => item.id));
    const referenced = new Set<string>();
    for (const profile of tx.select().from(ruleProfiles).all()) {
      for (const rule of profile.definition.rules) {
        if (rule.type === 'ruleset') referenced.add(rule.rulesetId);
      }
    }

    for (const row of tx.select().from(rulesets).where(eq(rulesets.builtin, true)).all()) {
      if (keep.has(row.id)) continue;
      if (referenced.has(row.id)) {
        tx.update(rulesets).set({ builtin: false }).where(eq(rulesets.id, row.id)).run();
        console.log(`[msubga] 规则集「${row.name}」已不在预置列表，但仍被模板引用，转为自定义保留`);
      } else {
        tx.delete(rulesets).where(eq(rulesets.id, row.id)).run();
      }
    }
  });
}
