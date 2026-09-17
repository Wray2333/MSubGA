import type { EvaluableNode, ImportCandidate, NodeFilter, NodeSelection } from '@msubga/core';
import { filterNodes, resolveSelection } from '@msubga/core';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { nodeTags, nodes, type NodeRow } from '../db/schema.js';

export interface NodeWithTags extends NodeRow {
  tagIds: string[];
}

/** 一次性把所有 node_tags 拉出来按 nodeId 分组，避免 N+1 */
function tagMap(nodeIds?: readonly string[]): Map<string, string[]> {
  const rows = nodeIds?.length
    ? db.select().from(nodeTags).where(inArray(nodeTags.nodeId, [...nodeIds])).all()
    : db.select().from(nodeTags).all();

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.nodeId);
    if (list) list.push(row.tagId);
    else map.set(row.nodeId, [row.tagId]);
  }
  return map;
}

export function attachTags(rows: readonly NodeRow[]): NodeWithTags[] {
  const map = tagMap(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, tagIds: map.get(row.id) ?? [] }));
}

export function listNodes(): NodeWithTags[] {
  return attachTags(db.select().from(nodes).all());
}

export function getNode(id: string): NodeWithTags | undefined {
  const row = db.select().from(nodes).where(eq(nodes.id, id)).get();
  return row ? attachTags([row])[0] : undefined;
}

export function toEvaluable(node: NodeWithTags): EvaluableNode {
  return {
    id: node.id,
    name: node.name,
    config: node.config,
    tagIds: node.tagIds,
    lastDelayMs: node.lastDelayMs,
    lastStatus: node.lastStatus,
  };
}

/** 订阅生成时用：只考虑启用的节点 */
export function resolveSubscriptionNodes(selection: NodeSelection): EvaluableNode[] {
  const enabled = attachTags(db.select().from(nodes).where(eq(nodes.enabled, true)).all());
  return resolveSelection(enabled.map(toEvaluable), selection);
}

export interface InsertOutcome {
  inserted: number;
  /** 库里已经有同指纹的节点，跳过 */
  duplicated: number;
  duplicatedNames: string[];
}

/**
 * 把导入预览里确认的候选写进库。
 * 指纹撞库的直接跳过——不覆盖，因为用户可能已经给那个节点改过名字。
 */
export function insertCandidates(
  candidates: readonly ImportCandidate[],
  tagIds: readonly string[] = [],
): InsertOutcome {
  if (candidates.length === 0) return { inserted: 0, duplicated: 0, duplicatedNames: [] };

  const fingerprints = candidates.map((c) => c.fingerprint);
  const existing = new Set(
    db
      .select({ fingerprint: nodes.fingerprint })
      .from(nodes)
      .where(inArray(nodes.fingerprint, fingerprints))
      .all()
      .map((row) => row.fingerprint),
  );

  const fresh = candidates.filter((c) => !existing.has(c.fingerprint));
  const duplicatedNames = candidates.filter((c) => existing.has(c.fingerprint)).map((c) => c.name);

  if (fresh.length === 0) {
    return { inserted: 0, duplicated: duplicatedNames.length, duplicatedNames };
  }

  const now = Date.now();
  db.transaction((tx) => {
    for (const candidate of fresh) {
      const id = nanoid();
      tx.insert(nodes)
        .values({
          id,
          name: candidate.name,
          rawName: candidate.name,
          type: candidate.config.type,
          server: candidate.config.server,
          port: candidate.config.port,
          config: candidate.config,
          fingerprint: candidate.fingerprint,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const tagId of tagIds) {
        tx.insert(nodeTags).values({ nodeId: id, tagId }).onConflictDoNothing().run();
      }
    }
  });

  return { inserted: fresh.length, duplicated: duplicatedNames.length, duplicatedNames };
}

/** 管理端列表页的筛选走这个；和订阅的动态筛选共用一套条件 */
export function filterForApi(list: readonly NodeWithTags[], filter: NodeFilter | undefined): NodeWithTags[] {
  if (!filter) return [...list];
  const byId = new Map(list.map((node) => [node.id, node]));
  return filterNodes(list.map(toEvaluable), filter)
    .map((node) => byId.get(node.id))
    .filter((node): node is NodeWithTags => node !== undefined);
}
