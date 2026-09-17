import { BUILTIN_PROFILES } from '@msubga/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Empty, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatTime } from '../lib/utils';
import { ProfileEditor, type ProfileDraft } from './ProfileEditor';

export function ProfilesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list });
  const { data: rulesetData } = useQuery({ queryKey: ['rulesets'], queryFn: api.rulesets.list });
  const [draft, setDraft] = useState<ProfileDraft | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['profiles'] });

  const remove = useMutation({
    mutationFn: (id: string) => api.profiles.remove(id),
    onSuccess: () => {
      toast.success('已删除');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.profiles.duplicate(id),
    onSuccess: ({ profile }) => {
      refresh();
      setDraft({
        id: profile.id,
        name: profile.name,
        description: profile.description ?? '',
        definition: profile.definition,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <Spinner />;
  const profiles = data?.profiles ?? [];

  return (
    <div className="space-y-3 p-5">
      <header className="flex items-center gap-2">
        <h1 className="mr-auto text-base font-semibold">
          规则模板
          <span className="ml-2 text-xs font-normal text-muted">
            决定订阅里有哪些策略组、流量按什么顺序分流
          </span>
        </h1>
        <Button
          variant="primary"
          onClick={() =>
            setDraft({
              id: null,
              name: '',
              description: '',
              // 拿内置的「规则分流」当起点，比从空白开始好用得多
              definition: structuredClone(BUILTIN_PROFILES[0]!.definition),
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </Button>
      </header>

      {profiles.length === 0 ? (
        <Empty>还没有规则模板</Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => (
            <div key={profile.id} className="flex flex-col rounded-lg border border-border bg-surface p-3">
              <div className="mb-1 flex items-center gap-1.5">
                {profile.builtin && <Lock className="h-3 w-3 shrink-0 text-muted" />}
                <h3 className="truncate text-sm font-medium">{profile.name}</h3>
              </div>
              <p className="mb-2 line-clamp-2 min-h-[2.5rem] text-xs text-muted">
                {profile.description ?? '没有说明'}
              </p>
              <div className="mb-3 flex flex-wrap gap-1">
                <Badge className="bg-surface-2 text-muted">
                  {profile.definition.groups.length} 个策略组
                </Badge>
                <Badge className="bg-surface-2 text-muted">{profile.definition.rules.length} 条规则</Badge>
              </div>
              <div className="mt-auto flex items-center gap-1">
                <span className="mr-auto text-[11px] text-muted">{formatTime(profile.updatedAt)}</span>
                {profile.builtin ? (
                  <Button size="sm" onClick={() => duplicate.mutate(profile.id)}>
                    <Copy className="h-3 w-3" />
                    复制后编辑
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        setDraft({
                          id: profile.id,
                          name: profile.name,
                          description: profile.description ?? '',
                          definition: profile.definition,
                        })
                      }
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (confirm(`删除模板「${profile.name}」？`)) remove.mutate(profile.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <ProfileEditor
          draft={draft}
          rulesets={rulesetData?.rulesets ?? []}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            toast.success('模板已保存');
            setDraft(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
