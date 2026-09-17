import { Waypoints } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';

/** 首次启动走「设置密码」，之后走「登录」，两个状态共用一个界面 */
export function AuthScreen({ configured, onDone }: { configured: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configured && password !== confirm) {
      toast.error('两次输入的密码不一样');
      return;
    }
    setBusy(true);
    try {
      await (configured ? api.auth.login(password) : api.auth.setup(password));
      onDone();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-[21rem]">
        <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
          <Waypoints className="size-7 text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">MSubGA</h1>
            <p className="mt-1 text-xs text-muted">
              {configured ? '输入管理员密码继续' : '第一次启动，先设置一个管理员密码'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3.5 rounded-xl border border-border bg-surface p-5">
          <Field label="密码">
            <Input
              type="password"
              value={password}
              autoFocus
              autoComplete={configured ? 'current-password' : 'new-password'}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {!configured && (
            <Field
              label="确认密码"
              hint="至少 6 位。这个密码只用来进管理界面，订阅链接不受它保护。"
            >
              <Input
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
          )}
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            {configured ? '登录' : '设置并进入'}
          </Button>
        </form>
      </div>
    </div>
  );
}
