import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Modal, Select, Spinner } from '../components/ui';
import { api, type Subscription } from '../lib/api';
import { copyText } from '../lib/utils';

export function SubscriptionPreview({
  subscription,
  onClose,
}: {
  subscription: Subscription;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<'clash' | 'base64'>(
    subscription.format === 'base64' ? 'base64' : 'clash',
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['sub-preview', subscription.id, target],
    queryFn: () => api.subscriptions.preview(subscription.id, target),
  });

  const verify = useMutation({
    mutationFn: () => api.subscriptions.verify(subscription.id),
  });

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      wide
      title={`预览：${subscription.name}`}
      description="这就是客户端拉到的原文"
      footer={
        <>
          {target === 'clash' && (
            <Button
              className="mr-auto"
              loading={verify.isPending}
              onClick={() => verify.mutate()}
              title="把生成结果丢给真正的 mihomo 内核跑一遍 mihomo -t"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              用内核校验
            </Button>
          )}
          <Button
            onClick={() => {
              void copyText(data?.plain ?? data?.body ?? '').then((ok) =>
                ok ? toast.success('已复制') : toast.error('复制失败'),
              );
            }}
          >
            复制内容
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Select
            className="w-44"
            value={target}
            onChange={(event) => setTarget(event.target.value as 'clash' | 'base64')}
          >
            <option value="clash">Clash YAML</option>
            <option value="base64">Base64 链接列表</option>
          </Select>
          {data && <span className="text-xs text-muted">{data.proxyCount} 个节点</span>}
        </div>

        {verify.data && (
          <div
            className={
              verify.data.ok
                ? 'rounded-lg border border-ok/40 bg-ok/5 p-3'
                : 'rounded-lg border border-danger/40 bg-danger/5 p-3'
            }
          >
            <div
              className={
                verify.data.ok
                  ? 'mb-1 flex items-center gap-1.5 text-xs font-medium text-ok'
                  : 'mb-1 flex items-center gap-1.5 text-xs font-medium text-danger'
              }
            >
              {verify.data.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {verify.data.ok ? '内核接受了这份配置' : '内核拒绝了这份配置'}
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">
              {verify.data.output}
            </pre>
          </div>
        )}

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
            {(error as Error).message}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <CodeMirror
              value={target === 'base64' ? (data?.plain ?? '') : (data?.body ?? '')}
              height="460px"
              theme={oneDark}
              extensions={[yaml()]}
              editable={false}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
