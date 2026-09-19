import { useQuery } from '@tanstack/react-query';
import { Boxes, Link2, ListTree, Settings as SettingsIcon, Shuffle, Waypoints } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeToggle } from './components/ThemeToggle';
import { Spinner } from './components/ui';
import { api } from './lib/api';
import { cn } from './lib/utils';
import { AuthScreen } from './pages/AuthScreen';
import { NodesPage } from './pages/Nodes';
import { SettingsPage } from './pages/Settings';

// 这几个页面带着 CodeMirror，占了打包体积的一大半。
// 拆出去之后登录页和节点池不用等它下载完才能显示。
const RulesetsPage = lazy(() => import('./pages/Rulesets').then((m) => ({ default: m.RulesetsPage })));
const ProfilesPage = lazy(() => import('./pages/Profiles').then((m) => ({ default: m.ProfilesPage })));
const ProfileEditorPage = lazy(() =>
  import('./pages/ProfileEditorPage').then((m) => ({ default: m.ProfileEditorPage })),
);
const SubscriptionsPage = lazy(() =>
  import('./pages/Subscriptions').then((m) => ({ default: m.SubscriptionsPage })),
);

const NAV = [
  { to: '/nodes', label: '节点池', icon: Boxes },
  { to: '/rulesets', label: '规则集', icon: ListTree },
  { to: '/profiles', label: '模板', icon: Shuffle },
  { to: '/subscriptions', label: '订阅', icon: Link2 },
  { to: '/settings', label: '设置', icon: SettingsIcon },
];

function Sidebar() {
  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-border bg-surface/50 sm:flex">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-2">
          <Waypoints className="size-[18px] text-accent" />
          <span className="bg-gradient-to-r from-fg to-accent bg-clip-text text-[0.9375rem] font-bold tracking-[0.06em] text-transparent">
            MSUBGA
          </span>
        </div>
        <div className="telemetry mt-1.5 text-muted">SUBSCRIPTION / NODE CTRL</div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2.5 pt-2.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'relative flex items-center gap-2.5 rounded px-2.5 py-2 text-sm transition',
                isActive
                  ? 'bg-surface-2 font-medium text-fg'
                  : 'text-muted hover:bg-surface-2/50 hover:text-fg-2',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    aria-hidden
                    className="grad-accent absolute inset-y-1.5 left-0 w-[3px] rounded-full"
                  />
                )}
                <Icon className={cn('size-4 shrink-0', isActive && 'text-accent')} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-end justify-between gap-2 border-t border-border px-4 py-3">
        <div className="telemetry text-muted/60">
          MAKE SUBSCRIPTION
          <br />
          GREAT AGAIN
        </div>
        {/* 手机上侧栏不显示，那边的入口在设置页 */}
        <ThemeToggle />
      </div>
    </aside>
  );
}

/** 手机上导航放底部：五个入口正好一排，且都在拇指可达范围内 */
function BottomNav() {
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 backdrop-blur sm:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'relative flex flex-1 flex-col items-center gap-1 py-2.5 tracking-[0.1em] transition',
              'text-2xs',
              isActive ? 'text-accent' : 'text-muted',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="grad-accent absolute inset-x-0 top-0 h-0.5" />}
              <Icon className={cn('size-5', isActive && 'text-accent')} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Layout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      {/* 底部导航是 fixed 的，内容要留出它的高度，否则最后一行永远被挡住 */}
      <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-0">
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/nodes" element={<NodesPage />} />
            <Route path="/rulesets" element={<RulesetsPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/profiles/:id" element={<ProfileEditorPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/nodes" replace />} />
          </Routes>
        </Suspense>
      </main>
      <BottomNav />
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
