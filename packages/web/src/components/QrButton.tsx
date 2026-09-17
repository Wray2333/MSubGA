import { QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useState } from 'react';
import { Button, Modal } from './ui';

/** 订阅链接的二维码。手机上的客户端多数支持扫码导入，比手打链接实际得多。 */
export function QrButton({ url, name }: { url: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 必须用 callback ref：Radix Dialog 的 Presence 会把内容推迟一帧挂载，
  // 用 useEffect + useRef 的话第一次跑到时 canvas 还没进 DOM，ref 是 null，
  // 而依赖没变又不会重跑，结果就是一块空白画布。
  const drawQr = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      setError(null);
      QRCode.toCanvas(canvas, url, { width: 240, margin: 1 }).catch((cause: unknown) =>
        setError((cause as Error).message),
      );
    },
    [url],
  );

  return (
    <>
      <Button size="sm" title="扫码导入" onClick={() => setOpen(true)}>
        <QrCode className="h-3 w-3" />
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`扫码导入：${name}`}>
        <div className="flex flex-col items-center gap-3">
          {error ? (
            <p className="text-xs text-danger">生成二维码失败：{error}</p>
          ) : (
            <canvas ref={drawQr} className="rounded bg-white p-2" />
          )}
          <code className="break-all text-center text-[11px] text-muted">{url}</code>
        </div>
      </Modal>
    </>
  );
}
