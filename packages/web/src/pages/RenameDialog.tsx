import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input, Modal } from '../components/ui';
import { api, type NodeItem } from '../lib/api';

/** 预览改名结果：前端按和后端一样的顺序算一遍，先替换再加前后缀 */
function preview(name: string, opts: { find: string; replace: string; prefix: string; suffix: string }) {
  let result = name;
  if (opts.find) result = result.split(opts.find).join(opts.replace);
  if (opts.prefix) result = `${opts.prefix}${result}`;
  if (opts.suffix) result = `${result}${opts.suffix}`;
  return result.trim() || name;
}

export function RenameDialog({
  open,
  onOpenChange,
  nodes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: NodeItem[];
}) {
  const queryClient = useQueryClient();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');

  const opts = { find, replace, prefix, suffix };
  const changed = nodes.filter((node) => preview(node.name, opts) !== node.name);

  const run = useMutation({
    mutationFn: () =>
      api.nodes.bulkRename({
        ids: nodes.map((node) => node.id),
        find: find || undefined,
        replace: replace || undefined,
        prefix: prefix || undefined,
        suffix: suffix || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`已改名 ${result.renamed} 个节点`);
      void queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setFind('');
      setReplace('');
      setPrefix('');
      setSuffix('');
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`批量改名（选中 ${nodes.length} 个）`}
      description="先做文本替换，再加前后缀。改名不影响节点指纹，重复导入依然认得出是同一个节点。"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="primary"
            loading={run.isPending}
            disabled={changed.length === 0}
            onClick={() => run.mutate()}
          >
            应用到 {changed.length} 个
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <Field label="查找" hint="纯文本，不是正则">
            <Input value={find} onChange={(event) => setFind(event.target.value)} />
          </Field>
          <Field label="替换为" hint="留空即删除">
            <Input value={replace} onChange={(event) => setReplace(event.target.value)} />
          </Field>
          <Field label="加前缀">
            <Input value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          </Field>
          <Field label="加后缀">
            <Input value={suffix} onChange={(event) => setSuffix(event.target.value)} />
          </Field>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="px-2 py-1.5 text-left">现在</th>
                <th className="w-8 px-2 py-1.5"> </th>
                <th className="px-2 py-1.5 text-left">改完</th>
              </tr>
            </thead>
            <tbody>
              {nodes.slice(0, 50).map((node) => {
                const next = preview(node.name, opts);
                return (
                  <tr key={node.id} className="border-t border-border">
                    <td className="max-w-0 truncate px-2 py-1 text-muted">{node.name}</td>
                    <td className="px-2 py-1 text-center text-muted">→</td>
                    <td className="max-w-0 truncate px-2 py-1">
                      {next === node.name ? <span className="text-muted">不变</span> : next}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {nodes.length > 50 && (
          <p className="text-xs text-muted">只预览前 50 个，应用时会作用到全部 {nodes.length} 个。</p>
        )}
      </div>
    </Modal>
  );
}
