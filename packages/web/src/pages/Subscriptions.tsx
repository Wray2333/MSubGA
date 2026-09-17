import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { QrButton } from '../components/QrButton';
import { Chip, Button, Empty, Spinner } from '../components/ui';
import { api, type Subscription } from '../lib/api';
import { copyText, formatTime } from '../lib/utils';
import { SubscriptionEditor, type SubscriptionDraft } from './SubscriptionEditor';
import { SubscriptionPreview } from './SubscriptionPreview';

const FORMAT_LABEL: Record<string, string> = {
  auto: '按客户端自动判断',
  clash: 'Clash YAML',
  base64: 'Base64 链接列表',
};

export function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['subscriptions'], queryFn: api.subscriptions.list });
  const { data: profileData } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list });
  const { data: nodeData } = useQuery({ queryKey: ['nodes'], queryFn: api.nodes.list });
  const { data: tagData } = useQuery({ queryKey: ['tags'], queryFn: api.tags.list });

  const [draft, setDraft] = useState<SubscriptionDraft | null>(null);
  const [previewing, setPreviewing] = useState<Subscription | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });

  const remove = useMutation({
    mutationFn: (id: string) => api.subscriptions.remove(id),
    onSuccess: () => {
      toast.success('已删除');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.subscriptions.rotate(id),
    onSuccess: () => {
      toast.success('已换新链接，旧链接立刻失效');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <Spinner />;
  const subscriptions = data?.subscriptions ?? [];
  const profiles = profileData?.profiles ?? [];
  const profileName = (id: string | null) => profiles.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="space-y-3 p-5">
      <header className="flex items-center gap-2">
        <h1 className="mr-auto text-base font-semibold">
          订阅
          <span className="ml-2 text-xs font-normal text-muted">
            链接本身就是凭证，泄露了就换一个
          </span>
        </h1>
        <Button
          variant="primary"
          disabled={profiles.length === 0}
          onClick={() =>
            setDraft({
              id: null,
              name: '',
              format: 'auto',
              profileId: profiles[0]?.id ?? null,
              selection: { mode: 'manual', nodeIds: [] },
              options: {
                sortByDelay: false,
                forceUdp: false,
                forceSkipCertVerify: false,
                updateIntervalHours: 24,
              },
              enabled: true,
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </Button>
      </header>

      {subscriptions.length === 0 ? (
        <Empty title="还没有订阅">先在节点池里导入节点，再来这里生成订阅链接</Empty>
      ) : (
        <div className="space-y-2">
          {subscriptions.map((subscription) => (
            <div key={subscription.id} className="group rounded-xl border border-border bg-surface p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[0.9375rem] font-medium">{subscription.name}</h3>
                {!subscription.enabled && <Chip className="bg-danger/15 text-danger">已停用</Chip>}
                <Chip className="bg-surface-2 text-muted">{FORMAT_LABEL[subscription.format]}</Chip>
                <Chip className="bg-surface-2 text-muted">{profileName(subscription.profileId)}</Chip>
                <Chip className="bg-surface-2 text-muted">{subscription.nodeCount} 个节点</Chip>
                <Chip className="bg-surface-2 text-muted">
                  {subscription.selection.mode === 'manual' ? '手动勾选' : '动态筛选'}
                </Chip>

                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" onClick={() => setPreviewing(subscription)}>
                    <Eye className="h-3 w-3" />
                    预览
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setDraft({
                        id: subscription.id,
                        name: subscription.name,
                        format: subscription.format,
                        profileId: subscription.profileId,
                        selection: subscription.selection,
                        options: subscription.options,
                        enabled: subscription.enabled,
                      })
                    }
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    title="换一个链接，旧的立刻失效"
                    onClick={() => {
                      if (confirm('换新链接后，所有用旧链接的客户端都会拉不到订阅。继续？')) {
                        rotate.mutate(subscription.id);
                      }
                    }}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => {
                      if (confirm(`删除订阅「${subscription.name}」？`)) remove.mutate(subscription.id);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1 font-mono text-xs text-muted">
                  {subscription.url}
                </code>
                <Button
                  size="sm"
                  onClick={() => {
                    void copyText(subscription.url).then((ok) =>
                      ok ? toast.success('已复制') : toast.error('复制失败，手动选中吧'),
                    );
                  }}
                >
                  <Copy className="h-3 w-3" />
                  复制
                </Button>
                <QrButton url={subscription.url} name={subscription.name} />
              </div>

              <p className="mt-1.5 text-[11px] text-muted">
                被拉取 {subscription.hitCount} 次 · 最近 {formatTime(subscription.lastAccessAt)}
                {subscription.lastAccessUa ? ` · ${subscription.lastAccessUa.slice(0, 60)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <SubscriptionEditor
          draft={draft}
          profiles={profiles}
          nodes={nodeData?.nodes ?? []}
          tags={tagData?.tags ?? []}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            refresh();
          }}
        />
      )}
      {previewing && (
        <SubscriptionPreview subscription={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}
