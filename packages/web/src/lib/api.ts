import type {
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

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError((data as { error?: string }).error ?? `请求失败: HTTP ${response.status}`, response.status);
  }
  return data as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path);
const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' });

/* ------------------------------- 数据形状 ------------------------------- */

export interface NodeItem {
  id: string;
  name: string;
  rawName: string | null;
  type: NodeType;
  server: string;
  port: number;
  config: ProxyConfig;
  enabled: boolean;
  remark: string | null;
  lastDelayMs: number | null;
  lastStatus: LatencyStatus | null;
  lastTestedAt: number | null;
  tagIds: string[];
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ImportCandidatePreview {
  line: number;
  name: string;
  type: NodeType;
  server: string;
  port: number;
  existing: boolean;
}

export interface ImportFailure {
  line: number;
  raw: string;
  reason: string;
}

export interface ImportPreview {
  decodedBase64: boolean;
  duplicatesInBatch: number;
  candidates: ImportCandidatePreview[];
  failures: ImportFailure[];
}

export interface Ruleset {
  id: string;
  name: string;
  description: string | null;
  kind: 'remote' | 'inline';
  behavior: RulesetBehavior;
  format: RulesetFormat;
  url: string | null;
  content: string | null;
  builtin: boolean;
  /** 服务端上次抓到正文的时间，null = 还没缓存过 */
  cachedAt: number | null;
  cacheSize: number | null;
  cacheError: string | null;
  updatedAt: number;
}

export interface RefreshOutcome {
  id: string;
  name: string;
  ok: boolean;
  notModified?: boolean;
  size?: number;
  error?: string;
}

export interface RuleProfile {
  id: string;
  name: string;
  description: string | null;
  definition: RuleProfileDefinition;
  builtin: boolean;
  updatedAt: number;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface Subscription {
  id: string;
  name: string;
  token: string;
  url: string;
  format: SubFormat;
  profileId: string | null;
  selection: NodeSelection;
  options: SubscriptionOptions;
  enabled: boolean;
  expiresAt: number | null;
  hitCount: number;
  lastAccessAt: number | null;
  lastAccessUa: string | null;
  nodeCount: number;
}

export interface SettingsPayload {
  latency: { testUrl: string; timeoutMs: number; concurrency: number };
  siteBaseUrl: string;
  /** 规则集是否由服务端抓取并中转给客户端 */
  rulesetProxy: boolean;
  mihomo: { path?: string; version?: string; ready: boolean; running: boolean };
}

/* --------------------------------- 接口 --------------------------------- */

export const api = {
  auth: {
    status: () => get<{ configured: boolean; authenticated: boolean }>('/api/auth/status'),
    setup: (password: string) => post<{ ok: true }>('/api/auth/setup', { password }),
    login: (password: string) => post<{ ok: true }>('/api/auth/login', { password }),
    logout: () => post<{ ok: true }>('/api/auth/logout'),
    changePassword: (current: string, next: string) =>
      post<{ ok: true }>('/api/auth/password', { current, next }),
  },
  nodes: {
    list: () => get<{ nodes: NodeItem[] }>('/api/nodes'),
    preview: (payload: { text: string; defaultPlainType: string; namePrefix?: string }) =>
      post<ImportPreview>('/api/nodes/import/preview', payload),
    commit: (payload: {
      text: string;
      defaultPlainType: string;
      namePrefix?: string;
      selectedLines?: number[];
      names?: Record<string, string>;
      tagIds?: string[];
    }) => post<{ inserted: number; duplicated: number }>('/api/nodes/import', payload),
    update: (
      id: string,
      payload: { name?: string; remark?: string | null; enabled?: boolean; config?: ProxyConfig },
    ) => patch<{ ok: true }>(`/api/nodes/${id}`, payload),
    remove: (id: string) => del<{ ok: true }>(`/api/nodes/${id}`),
    bulkDelete: (ids: string[]) => post<{ ok: true }>('/api/nodes/bulk/delete', { ids }),
    bulkEnabled: (ids: string[], enabled: boolean) =>
      post<{ ok: true }>('/api/nodes/bulk/enabled', { ids, enabled }),
    bulkTags: (ids: string[], add: string[], remove: string[]) =>
      post<{ ok: true }>('/api/nodes/bulk/tags', { ids, add, remove }),
    bulkRename: (payload: {
      ids: string[];
      prefix?: string;
      suffix?: string;
      find?: string;
      replace?: string;
    }) => post<{ ok: true; renamed: number }>('/api/nodes/bulk/rename', payload),
  },
  tags: {
    list: () => get<{ tags: Tag[] }>('/api/tags'),
    create: (name: string, color: string) => post<{ tag: Tag }>('/api/tags', { name, color }),
    remove: (id: string) => del<{ ok: true }>(`/api/tags/${id}`),
  },
  latency: {
    status: () => get<{ running: boolean }>('/api/latency/status'),
    test: (payload: { nodeIds?: string[]; method: 'proxy' | 'tcp' | 'auto' }) =>
      post<{ started: true }>('/api/latency/test', payload),
  },
  rulesets: {
    list: () => get<{ rulesets: Ruleset[] }>('/api/rulesets'),
    create: (payload: Partial<Ruleset>) => post<{ ruleset: Ruleset }>('/api/rulesets', payload),
    update: (id: string, payload: Partial<Ruleset>) => patch<{ ok: true }>(`/api/rulesets/${id}`, payload),
    remove: (id: string) => del<{ ok: true }>(`/api/rulesets/${id}`),
    duplicate: (id: string) => post<{ ruleset: Ruleset }>(`/api/rulesets/${id}/duplicate`),
    refresh: (id: string) => post<RefreshOutcome>(`/api/rulesets/${id}/refresh`),
    refreshAll: () =>
      post<{ total: number; ok: number; results: RefreshOutcome[] }>('/api/rulesets/refresh'),
  },
  profiles: {
    list: () => get<{ profiles: RuleProfile[] }>('/api/profiles'),
    get: (id: string) => get<{ profile: RuleProfile; issues: ValidationIssue[] }>(`/api/profiles/${id}`),
    validate: (definition: RuleProfileDefinition) =>
      post<{ issues: ValidationIssue[] }>('/api/profiles/validate', definition),
    create: (payload: { name: string; description?: string | null; definition: RuleProfileDefinition }) =>
      post<{ profile: RuleProfile; issues: ValidationIssue[] }>('/api/profiles', payload),
    update: (
      id: string,
      payload: { name?: string; description?: string | null; definition?: RuleProfileDefinition },
    ) => patch<{ ok: true; issues: ValidationIssue[] }>(`/api/profiles/${id}`, payload),
    remove: (id: string) => del<{ ok: true }>(`/api/profiles/${id}`),
    duplicate: (id: string) => post<{ profile: RuleProfile }>(`/api/profiles/${id}/duplicate`),
  },
  subscriptions: {
    list: () => get<{ subscriptions: Subscription[] }>('/api/subscriptions'),
    create: (payload: Record<string, unknown>) =>
      post<{ subscription: Subscription }>('/api/subscriptions', payload),
    update: (id: string, payload: Record<string, unknown>) =>
      patch<{ ok: true }>(`/api/subscriptions/${id}`, payload),
    remove: (id: string) => del<{ ok: true }>(`/api/subscriptions/${id}`),
    rotate: (id: string) => post<{ token: string; url: string }>(`/api/subscriptions/${id}/rotate-token`),
    preview: (id: string, target: 'clash' | 'base64') =>
      get<{ target: string; proxyCount: number; body: string; plain?: string }>(
        `/api/subscriptions/${id}/preview?target=${target}`,
      ),
    verify: (id: string) => post<{ ok: boolean; output: string }>(`/api/subscriptions/${id}/verify`),
  },
  settings: {
    get: () => get<SettingsPayload>('/api/settings'),
    update: (payload: Record<string, unknown>) => patch<{ ok: true }>('/api/settings', payload),
    downloadMihomo: () => post<{ ok: true; path: string; version: string }>('/api/settings/mihomo/download'),
  },
};
