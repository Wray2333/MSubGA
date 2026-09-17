import { useQuery } from '@tanstack/react-query';
import { Boxes, KeyRound, Link2, ListTree, Settings as SettingsIcon, Shuffle } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { cn } from './lib/utils';
import { Spinner } from './components/ui';
import { AuthScreen } from './pages/AuthScreen';
import { NodesPage } from './pages/Nodes';
import { SettingsPage } from './pages/Settings';

// 这三个页面带着 CodeMirror，占了打包体积的一大半。
// 拆出去之后登录页和节点池不用等它下载完才能显示。
const RulesetsPage = lazy(() => import('./pages/Rulesets').then((m) => ({ default: m.RulesetsPage })));
const ProfilesPage = lazy(() => import('./pages/Profiles').then((m) => ({ default: m.ProfilesPage })));
const SubscriptionsPage = lazy(() =>
  import('./pages/Subscriptions').then((m) => ({ default: m.SubscriptionsPage })),
);

const NAV = [
  { to: '/nodes', label: '节点池', icon: Boxes },
  { to: '/rulesets', label: '规则集', icon: ListTree },
  { to: '/profiles', label: '规则模板', icon: Shuffle },
  { to: '/subscriptions', label: '订阅', icon: Link2 },
  { to: '/settings', label: '设置', icon: SettingsIcon },
];

function Layout() {
  return (
    <div className="flex h-full">
      <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2 px-4 py-4">
          <KeyRound className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold tracking-tight">MSubGA</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition',
                  isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="px-4 py-3 text-[11px] leading-relaxed text-muted">
          Make subscription
          <br />
          great again
        </p>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/nodes" element={<NodesPage />} />
            <Route path="/rulesets" element={<RulesetsPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/nodes" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export function App() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auth-status'],
    queryFn: api.auth.status,
  });

  if (isLoading || !data) return <Spinner />;
  if (!data.authenticated) {
    return <AuthScreen configured={data.configured} onDone={() => void refetch()} />;
  }
  return <Layout />;
}
