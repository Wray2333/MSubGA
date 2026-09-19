import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Copy, Lock, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Chip, Empty, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { cn, formatTime } from '../lib/utils';

export function ProfilesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['profiles'] });
  const onError = (error: Error) => toast.error(error.message);

  const remove = useMutation({
    mutationFn: (id: string) => api.profiles.remove(id),
    onSuccess: () => {
      toast.success('已删除');
      refresh();
    },
    onError,
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.profiles.duplicate(id),
    onSuccess: ({ profile }) => {
      refresh();
      navigate(`/profiles/${profile.id}`);
    },
    onError,
  });

  if (isLoading) return <Spinner />;
  const profiles = data?.profiles ?? [];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="规则模板"
        count={`${profiles.length} 个`}
        subtitle="决定订阅里有哪些策略组、流量按什么顺序分流"
      >
        <Button variant="primary" onClick={() => navigate('/profiles/new')}>
          <Plus className="size-4" />
          新建
        </Button>
      </PageHeader>

      {profiles.length === 0 ? (
        <Empty title="还没有规则模板">先复制一份内置模板，或者点右上角新建</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {profiles.map((profile, index) => {
            const editable = !profile.builtin;
            return (
              <div
                key={profile.id}
                className={cn(
                  'group flex items-center gap-3 px-3 py-3 transition hover:bg-surface/60 sm:px-4',
                  index > 0 && 'border-t border-border/60',
                )}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/profiles/${profile.id}`)}
                  title={editable ? '编辑这个模板' : '查看这个模板（内置模板只读）'}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {profile.builtin && <Lock className="size-3 shrink-0 text-muted" />}
                      <span className="truncate text-[0.9375rem] font-medium">{profile.name}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-2xs text-muted">
                      {profile.description ?? '没有说明'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip>{profile.definition.groups.length} 组</Chip>
                      <Chip>{profile.definition.rules.length} 条规则</Chip>
                      <span className="text-2xs text-muted">{formatTime(profile.updatedAt)}</span>
                    </div>
                  </div>
                  <ChevronRight className="hidden size-4 shrink-0 text-muted sm:block" />
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  {profile.builtin ? (
                    <Button size="sm" onClick={() => duplicate.mutate(profile.id)}>
                      <Copy className="size-3" />
                      <span className="hidden sm:inline">复制后编辑</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="danger"
                      className="hover-reveal opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        if (confirm(`删除模板「${profile.name}」？`)) remove.mutate(profile.id);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
