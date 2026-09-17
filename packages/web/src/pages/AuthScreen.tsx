import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Card, Field, Input } from '../components/ui';
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
    <div className="flex h-full items-center justify-center">
      <Card className="w-80">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-semibold">
            {configured ? '登录 MSubGA' : '设置管理员密码'}
          </h1>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="密码">
            <Input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {!configured && (
            <Field label="确认密码" hint="至少 6 位。这个密码只用来进管理界面，订阅链接不受它保护。">
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          )}
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            {configured ? '登录' : '设置并进入'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
