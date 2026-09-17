import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from '../components/ui';
import { api, type ImportPreview, type Tag } from '../lib/api';

const PLACEHOLDER = [
  'vless://uuid@example.com:443?encryption=none&security=tls#香港01',
  'trojan://password@jp.example.com:443?sni=jp.example.com#日本01',
  '1.2.3.4:1080:username:password',
  '8.8.8.8:3128',
  '',
  '也支持整段 base64 的节点列表，直接粘进来就行',
].join('\n');

export function ImportDialog({
  open,
  onOpenChange,
  tags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: Tag[];
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [defaultPlainType, setDefaultPlainType] = useState('socks5');
  const [namePrefix, setNamePrefix] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [tagIds, setTagIds] = useState<string[]>([]);

  const reset = () => {
    setText('');
    setPreview(null);
    setSkipped(new Set());
    setNamePrefix('');
    setTagIds([]);
  };

  const previewMutation = useMutation({
    mutationFn: () => api.nodes.preview({ text, defaultPlainType, namePrefix: namePrefix || undefined }),
    onSuccess: (data) => {
      setPreview(data);
      // 库里已经有的默认不勾，避免用户以为会重复导入
      setSkipped(new Set(data.candidates.filter((c) => c.existing).map((c) => c.line)));
      if (data.candidates.length === 0) toast.warning('没解析出任何节点');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const commitMutation = useMutation({
    mutationFn: () =>
      api.nodes.commit({
        text,
        defaultPlainType,
        namePrefix: namePrefix || undefined,
        selectedLines: (preview?.candidates ?? []).filter((c) => !skipped.has(c.line)).map((c) => c.line),
        tagIds,
      }),
    onSuccess: (result) => {
      const dup = result.duplicated > 0 ? '，跳过 ' + result.duplicated + ' 个重复' : '';
      toast.success('导入 ' + result.inserted + ' 个节点' + dup);
      void queryClient.invalidateQueries({ queryKey: ['nodes'] });
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectedCount = (preview?.candidates.length ?? 0) - skipped.size;

  const toggleLine = (line: number) =>
    setSkipped((previous) => {
      const next = new Set(previous);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      size="lg"
      title="导入节点"
      description="协议链接、host:port:user:pass 纯文本、整段 base64 都可以混在一起粘"
      footer={
        preview ? (
          <>
            <Button onClick={() => setPreview(null)}>返回修改</Button>
            <Button
              variant="primary"
              loading={commitMutation.isPending}
              disabled={selectedCount <= 0}
              onClick={() => commitMutation.mutate()}
            >
              导入选中的 {selectedCount} 个
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            loading={previewMutation.isPending}
            disabled={!text.trim()}
            onClick={() => previewMutation.mutate()}
          >
            解析并预览
          </Button>
        )
      }
    >
      {!preview ? (
        <div className="space-y-3">
          <Textarea
            rows={14}
            value={text}
            placeholder={PLACEHOLDER}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="纯文本按哪种协议解析" hint="只影响没有协议前缀的行">
              <Select value={defaultPlainType} onChange={(e) => setDefaultPlainType(e.target.value)}>
                <option value="socks5">SOCKS5</option>
                <option value="http">HTTP</option>
              </Select>
            </Field>
            <Field label="名称前缀（可选）" hint="例如 [机场A] ，方便之后按来源筛选">
              <Input
                value={namePrefix}
                onChange={(e) => setNamePrefix(e.target.value)}
                placeholder="留空则不加"
              />
            </Field>
          </div>
          {tags.length > 0 && (
            <Field label="导入后打上标签（可选）">
              <div className="flex flex-wrap gap-2 pt-1">
                {tags.map((tag) => (
                  <label key={tag.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={tagIds.includes(tag.id)}
                      onChange={(event) =>
                        setTagIds((previous) =>
                          event.target.checked ? [...previous, tag.id] : previous.filter((id) => id !== tag.id),
                        )
                      }
                    />
                    <span style={{ color: tag.color }}>{tag.name}</span>
                  </label>
                ))}
              </div>
            </Field>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted">
            <span>解析出 {preview.candidates.length} 个</span>
            {preview.decodedBase64 && <span className="text-accent">整段 base64 已自动解码</span>}
            {preview.duplicatesInBatch > 0 && <span>批内重复去掉 {preview.duplicatesInBatch} 个</span>}
            {preview.failures.length > 0 && (
              <span className="text-warn">{preview.failures.length} 行解析失败</span>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="w-10 px-2 py-1.5"> </th>
                  <th className="px-2 py-1.5 text-left">名称</th>
                  <th className="w-20 px-2 py-1.5 text-left">协议</th>
                  <th className="px-2 py-1.5 text-left">地址</th>
                  <th className="w-24 px-2 py-1.5 text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {preview.candidates.map((candidate) => (
                  <tr key={candidate.line} className="border-t border-border">
                    <td className="px-2 py-1 text-center">
                      <Checkbox
                        checked={!skipped.has(candidate.line)}
                        onChange={() => toggleLine(candidate.line)}
                      />
                    </td>
                    <td className="max-w-[16rem] truncate px-2 py-1">{candidate.name}</td>
                    <td className="px-2 py-1 text-muted">{candidate.type}</td>
                    <td className="px-2 py-1 font-mono text-muted">
                      {candidate.server}:{candidate.port}
                    </td>
                    <td className="px-2 py-1">
                      {candidate.existing ? (
                        <span className="text-muted">库里已有</span>
                      ) : (
                        <span className="text-ok">新增</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.failures.length > 0 && (
            <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-warn">
                <AlertTriangle className="h-3.5 w-3.5" />
                这些行没能解析
              </div>
              <ul className="space-y-1 text-xs">
                {preview.failures.map((failure) => (
                  <li key={failure.line} className="flex gap-2">
                    <span className="shrink-0 text-muted">第 {failure.line} 行</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-muted">{failure.raw}</span>
                    <span className="shrink-0 text-warn">{failure.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
