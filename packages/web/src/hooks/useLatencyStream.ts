import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { NodeItem } from '../lib/api';

export interface LatencyProgress {
  done: number;
  total: number;
}

/**
 * 订阅测速的 SSE 流。
 * 每条结果直接改写 react-query 缓存里对应的那一行，不重新拉整张表——
 * 上百个节点时逐条 refetch 会把界面卡住。
 */
export function useLatencyStream(): { progress: LatencyProgress | null } {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<LatencyProgress | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/latency/stream');

    source.addEventListener('start', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { total: number };
      setProgress({ done: 0, total: data.total });
    });

    source.addEventListener('result', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        nodeId: string;
        delayMs: number | null;
        status: NodeItem['lastStatus'];
        done: number;
        total: number;
      };
      setProgress({ done: data.done, total: data.total });

      queryClient.setQueryData<{ nodes: NodeItem[] }>(['nodes'], (previous) =>
        previous
          ? {
              nodes: previous.nodes.map((node) =>
                node.id === data.nodeId
                  ? { ...node, lastDelayMs: data.delayMs, lastStatus: data.status, lastTestedAt: Date.now() }
                  : node,
              ),
            }
          : previous,
      );
    });

    source.addEventListener('done', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        total: number;
        ok: number;
        failed: number;
        skipped: number;
      };
      setProgress(null);
      if (data.total > 0) {
        const skipped = data.skipped > 0 ? `，${data.skipped} 个被内核拒绝` : '';
        toast.success(`测速完成：${data.ok} 个正常，${data.failed} 个失败${skipped}`);
      }
      void queryClient.invalidateQueries({ queryKey: ['nodes'] });
    });

    source.addEventListener('error', (event) => {
      // EventSource 自身的断线也会走到这里，只有带 data 的才是服务端报的错
      const raw = (event as MessageEvent<string>).data;
      if (!raw) return;
      setProgress(null);
      toast.error((JSON.parse(raw) as { message: string }).message);
    });

    return () => source.close();
  }, [queryClient]);

  return { progress };
}
