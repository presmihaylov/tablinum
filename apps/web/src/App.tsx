import { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useCustomEmoji } from './api/hooks';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { AuthProvider, useAuth } from './lib/auth';
import { LiveProvider } from './lib/live';
import { usePersistedState } from './lib/storage';
import { ContentProvider } from './lib/content';
import { WorkspacesProvider, useWorkspace } from './lib/workspaces';
import { HomeRoute } from './routes/HomeRoute';
import { InviteRoute } from './routes/InviteRoute';
import { LoginRoute } from './routes/LoginRoute';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { PageRoute } from './routes/PageRoute';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Outside the gate: an invited person has no credential until this form runs. */}
        <Route path="/invite/:token" element={<InviteRoute />} />
        <Route path="*" element={<AuthGate />} />
      </Routes>
    </AuthProvider>
  );
}

function AuthGate() {
  const { loginRequired, ready, user } = useAuth();
  // Nothing is drawn until the answer lands, or the shell would flash before the login screen.
  if (!ready) return null;
  // Every browser session names a person, so no account means the login screen, not the shell.
  if (loginRequired || user === null) return <LoginRoute />;
  return (
    <WorkspacesProvider>
      <WorkspaceScope />
    </WorkspacesProvider>
  );
}

function WorkspaceScope() {
  const { current } = useWorkspace();
  // The markdown parser asks the registry whether `:name:` is an emoji while it runs, so the
  // set has to be here before the first page is parsed.
  const emoji = useCustomEmoji();
  if (!emoji.isFetched) return null;
  return (
    // The key throws away the tree on a switch: no page, no editor and no socket survives it.
    <ContentProvider key={current?.id ?? 'none'}>
      <LiveProvider>
        <AppShell />
      </LiveProvider>
    </ContentProvider>
  );
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = usePersistedState('ui.sidebar', true);
  const [metaOpen, setMetaOpen] = usePersistedState('ui.meta', true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (key === '\\') {
        event.preventDefault();
        setSidebarOpen((prev) => !prev);
        return;
      }
      if (key === '.' && event.shiftKey) {
        event.preventDefault();
        setMetaOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSidebarOpen, setMetaOpen]);

  return (
    <div className="app-shell">
      {sidebarOpen ? <Sidebar onOpenPalette={openPalette} /> : null}

      <div className="app-main">
        <TopBar
          sidebarOpen={sidebarOpen}
          metaOpen={metaOpen}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onToggleMeta={() => setMetaOpen((prev) => !prev)}
          onOpenPalette={openPalette}
        />

        {/* One scroll container, so the page and its comments read as a single canvas. */}
        <div className="app-body scroll-y">
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/p/*" element={<PageRoute metaOpen={metaOpen} />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Routes>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
