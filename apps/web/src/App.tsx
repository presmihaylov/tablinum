import { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { AuthProvider, useAuth } from './lib/auth';
import { usePersistedState } from './lib/storage';
import { WorkspaceProvider } from './lib/workspace';
import { HomeRoute } from './routes/HomeRoute';
import { LoginRoute } from './routes/LoginRoute';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { PageRoute } from './routes/PageRoute';

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { loginRequired } = useAuth();
  if (loginRequired) return <LoginRoute />;
  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
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

        <div className="app-body">
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/p/*" element={<PageRoute metaOpen={metaOpen} />} />
            <Route path="/login" element={<LoginRoute />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Routes>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
