import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, LogOut, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button, Card, CheckLabel, Field, Input, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });

  const [testUrl, setTestUrl] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [concurrency, setConcurrency] = useState(16);
  const [baseUrl, setBaseUrl] = useState('');
  const [mihomoPath, setMihomoPath] = useState('');
  const [rulesetProxy, setRulesetProxy] = useState(true);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  useEffect(() => {
    if (!data) return;
    setTestUrl(data.latency.testUrl);
    setTimeoutMs(data.latency.timeoutMs);
    setConcurrency(data.latency.concurrency);
    setBaseUrl(data.siteBaseUrl);
    setMihomoPath(data.mihomo.path ?? '');
    setRulesetProxy(data.rulesetProxy);
  }, [data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['settings'] });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.settings.update(payload),
    onSuccess: () => {
      toast.success('已保存');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const download = useMutation({
    mutationFn: api.settings.downloadMihomo,
    onSuccess: (result) => {
      toast.success(`mihomo ${result.version} 已就绪`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changePassword = useMutation({
    mutationFn: () => api.auth.changePassword(current, next),
    onSuccess: () => {
      toast.success('密码已改，其他设备上的登录状态都失效了');
      setCurrent('');
      setNext('');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => window.location.reload(),
  });

  if (isLoading || !data) return <Spinner />;

  return (
    <div className="max-w-6xl space-y-4 p-4 sm:p-6">
      <PageHeader title="设置" subtitle="外观、内核、测速参数、对外地址和管理员密码" />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
        <h2 className="mb-3 text-[0.9375rem] font-medium">外观</h2>
        <p className="mb-3 text-xs text-muted">
          只存在这台设备的浏览器里，不上传，也不影响别人打开的样子。
        </p>
        <ThemeToggle labels className="flex w-full sm:w-auto" />
        </Card>

        <Card>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto text-[0.9375rem] font-medium">mihomo 内核</h2>
          {data.mihomo.ready ? (
            <span className="flex items-center gap-1 text-xs text-ok">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {data.mihomo.version ?? '已就绪'}
              {data.mihomo.running && ' · 运行中'}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-warn">
              <XCircle className="h-3.5 w-3.5" />
              还没有内核
            </span>
          )}
        </div>
        <p className="mb-3 text-xs text-muted">
          测「真实代理延迟」和「用内核校验配置」都要它。没有内核时只能做 TCP 握手测试。
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="可执行文件路径" hint="留空则用自动下载到 data/mihomo/bin 的那个">
            <Input
              value={mihomoPath}
              placeholder="例如 D:\tools\mihomo.exe"
              onChange={(event) => setMihomoPath(event.target.value)}
            />
          </Field>
          <Button onClick={() => save.mutate({ mihomoPath })}>保存路径</Button>
          <Button variant="primary" loading={download.isPending} onClick={() => download.mutate()}>
            <Download className="h-3.5 w-3.5" />
            自动下载
          </Button>
        </div>
        </Card>

        <Card>
        <h2 className="mb-3 text-[0.9375rem] font-medium">测速</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="测速 URL" hint="默认是 generate_204" className="sm:col-span-2">
            <Input value={testUrl} onChange={(event) => setTestUrl(event.target.value)} />
          </Field>
          <Field label="单个超时 (ms)">
            <Input
              type="number"
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(Number(event.target.value))}
            />
          </Field>
          <Field label="并发数" hint="1-64">
            <Input
              type="number"
              value={concurrency}
              onChange={(event) => setConcurrency(Number(event.target.value))}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            onClick={() =>
              save.mutate({
                latencyTestUrl: testUrl,
                latencyTimeoutMs: timeoutMs,
                latencyConcurrency: concurrency,
              })
            }
          >
            保存
          </Button>
        </div>
        </Card>

        <Card>
        <h2 className="mb-3 text-[0.9375rem] font-medium">站点</h2>
        <Field
          label="对外访问地址"
          hint="订阅链接按这个前缀拼。部署在反代后面时必须填，否则复制出来的链接是内网地址。"
        >
          <Input
            value={baseUrl}
            placeholder="https://sub.example.com"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </Field>

        <div className="mt-4 border-t border-border pt-4">
          <CheckLabel checked={rulesetProxy} onChange={setRulesetProxy} className="text-sm">
            规则集由服务端中转
          </CheckLabel>
          <p className="mt-1.5 text-xs text-muted">
            内置规则集挂在 raw.githubusercontent.com 上，客户端要先连上代理才够得着，
            可规则正是用来决定怎么代理的——手机上表现就是订阅一直加载不出规则。
            开着这项，服务端会把规则抓下来缓存，生成的配置里 rule-provider 指向本站。
          </p>
          {rulesetProxy && !baseUrl && (
            <p className="mt-1.5 text-xs text-warn">
              还没填对外访问地址，会退回用请求来源拼。跑在反代后面建议把上面那一栏填上。
            </p>
          )}
        </div>

        <div className="mt-3">
          <Button
            variant="primary"
            onClick={() => save.mutate({ siteBaseUrl: baseUrl, rulesetProxy })}
          >
            保存
          </Button>
        </div>
        </Card>

        <Card>
        <h2 className="mb-1 text-[0.9375rem] font-medium">管理员密码</h2>
        <p className="mb-3 text-xs text-muted">
          改密码会让所有设备上的登录状态立刻失效。订阅链接不受影响。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="当前密码">
            <Input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} />
          </Field>
          <Field label="新密码" hint="至少 6 位">
            <Input type="password" value={next} onChange={(event) => setNext(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            loading={changePassword.isPending}
            disabled={!current || next.length < 6}
            onClick={() => changePassword.mutate()}
          >
            修改密码
          </Button>
          <Button className="ml-auto" onClick={() => logout.mutate()}>
            <LogOut className="h-3.5 w-3.5" />
            退出登录
          </Button>
        </div>
        </Card>
      </div>
    </div>
  );
}
