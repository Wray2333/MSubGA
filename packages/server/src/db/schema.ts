import type {
  LatencyMethod,
  LatencyStatus,
  NodeSelection,
  NodeType,
  ProxyConfig,
  RuleProfileDefinition,
  RulesetBehavior,
  RulesetFormat,
  SubFormat,
  SubscriptionOptions,
} from '@msubga/core';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch() * 1000)`;

/* -------------------------------------------------------------------------- */
/*                                   节点                                     */
/* -------------------------------------------------------------------------- */

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    /** 用户可改的显示名 */
    name: text('name').notNull(),
    /** 导入时链接里带的原始名，改名后仍可追溯 */
    rawName: text('raw_name'),
    /** 下面三列是 config 的冗余投影，只为筛选和排序，写入时同步维护 */
    type: text('type').$type<NodeType>().notNull(),
    server: text('server').notNull(),
    port: integer('port').notNull(),
    config: text('config', { mode: 'json' }).$type<ProxyConfig>().notNull(),
    /** 去重用。改名不影响它，所以重复导入不会覆盖用户改过的名字 */
    fingerprint: text('fingerprint').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    remark: text('remark'),
    /** 最近一次测速结果，冗余在这里，列表页免 join */
    lastDelayMs: integer('last_delay_ms'),
    lastStatus: text('last_status').$type<LatencyStatus>(),
    lastTestedAt: integer('last_tested_at'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (table) => [
    uniqueIndex('nodes_fingerprint_idx').on(table.fingerprint),
    index('nodes_type_idx').on(table.type),
    index('nodes_last_delay_idx').on(table.lastDelayMs),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#64748b'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (table) => [uniqueIndex('tags_name_idx').on(table.name)],
);

export const nodeTags = sqliteTable(
  'node_tags',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.tagId] }),
    index('node_tags_tag_idx').on(table.tagId),
  ],
);

export const latencyResults = sqliteTable(
  'latency_results',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    testedAt: integer('tested_at').notNull().default(now),
    method: text('method').$type<LatencyMethod>().notNull(),
    delayMs: integer('delay_ms'),
    status: text('status').$type<LatencyStatus>().notNull(),
    error: text('error'),
  },
  (table) => [index('latency_node_time_idx').on(table.nodeId, table.testedAt)],
);

/* -------------------------------------------------------------------------- */
/*                              规则集与规则模板                                 */
/* -------------------------------------------------------------------------- */

export const rulesets = sqliteTable('rulesets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  kind: text('kind').$type<'remote' | 'inline'>().notNull(),
  behavior: text('behavior').$type<RulesetBehavior>().notNull(),
  format: text('format').$type<RulesetFormat>().notNull(),
  /** kind = remote */
  url: text('url'),
  /** kind = inline，一行一条规则 */
  content: text('content'),
  /** 预置规则集，不可删，只能复制一份再改 */
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

export const ruleProfiles = sqliteTable('rule_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  definition: text('definition', { mode: 'json' }).$type<RuleProfileDefinition>().notNull(),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

/* -------------------------------------------------------------------------- */
/*                                   订阅                                     */
/* -------------------------------------------------------------------------- */

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** 订阅 URL 里的随机串，可轮换 */
    token: text('token').notNull(),
    format: text('format').$type<SubFormat>().notNull().default('auto'),
    /** base64 格式时为空 */
    profileId: text('profile_id').references(() => ruleProfiles.id, { onDelete: 'set null' }),
    selection: text('selection', { mode: 'json' }).$type<NodeSelection>().notNull(),
    options: text('options', { mode: 'json' }).$type<SubscriptionOptions>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    expiresAt: integer('expires_at'),
    hitCount: integer('hit_count').notNull().default(0),
    lastAccessAt: integer('last_access_at'),
    lastAccessUa: text('last_access_ua'),
    lastAccessIp: text('last_access_ip'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (table) => [uniqueIndex('subscriptions_token_idx').on(table.token)],
);

/* -------------------------------------------------------------------------- */
/*                                  设置项                                    */
/* -------------------------------------------------------------------------- */

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
});

export type NodeRow = typeof nodes.$inferSelect;
export type NewNodeRow = typeof nodes.$inferInsert;
export type TagRow = typeof tags.$inferSelect;
export type RulesetRow = typeof rulesets.$inferSelect;
export type RuleProfileRow = typeof ruleProfiles.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type LatencyResultRow = typeof latencyResults.$inferSelect;
