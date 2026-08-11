import { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useCustomEmoji } from './api/accounts';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { AuthProvider, useAuth } from './lib/auth';
import { LiveProvider } from './lib/live';
import { usePersistedState } from './lib/storage';
import { anyPanelOpen, NO_PANELS, type PanelId, type PanelState } from './lib/panels';
import { ContentProvider } from './lib/content';
import { WorkspacesProvider, useWorkspace } from './lib/workspaces';
import { HomeRoute } from './routes/HomeRoute';
import { InviteRoute } from './routes/InviteRoute';
import { LoginRoute } from './routes/LoginRoute';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { PageRoute } from './routes/PageRoute';
import { SettingsRoute } from './routes/SettingsRoute';

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
  const [panels, setPanels] = usePersistedState<PanelState>('ui.panels', NO_PANELS);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  const togglePanel = useCallback(
    (id: PanelId) => setPanels((prev) => ({ ...prev, [id]: !prev[id] })),
    [setPanels],
  );

  const closePanels = useCallback(() => setPanels(NO_PANELS), [setPanels]);

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
        // One key for the whole rail: put it away if anything is on, else bring the backlinks up.
        setPanels((prev) => (anyPanelOpen(prev) ? NO_PANELS : { ...prev, backlinks: true }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSidebarOpen, setPanels]);

  return (
    <div className="app-shell">
      {sidebarOpen ? (
        <Sidebar onOpenPalette={openPalette} onCollapse={() => setSidebarOpen(false)} />
      ) : null}

      <div className="app-main">
        <TopBar
          sidebarOpen={sidebarOpen}
          panels={panels}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onTogglePanel={togglePanel}
          onOpenPalette={openPalette}
        />

        {/* One scroll container, so the page and its comments read as a single canvas. */}
        <div className="app-body scroll-y">
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/p/*" element={<PageRoute panels={panels} onClosePanels={closePanels} />} />
            <Route path="/settings" element={<SettingsRoute />} />
            <Route path="/settings/:section" element={<SettingsRoute />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Routes>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
