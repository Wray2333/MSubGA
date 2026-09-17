import { BUILTIN_PROFILES, BUILTIN_RULESETS } from '@msubga/core';
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
  });
}
