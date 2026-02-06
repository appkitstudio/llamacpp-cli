import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Nav } from './components/Nav';
import { ApiKeyPrompt } from './components/ApiKeyPrompt';
import { Servers } from './pages/Servers';
import { ServerLogs } from './pages/ServerLogs';
import { Models } from './pages/Models';
import { Router } from './pages/Router';
import { RouterLogs } from './pages/RouterLogs';
import { api } from './lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent({ onLogout }: { onLogout: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const location = useLocation();

  // Only show search on models page
  const showSearch = location.pathname === '/models';

  return (
    <div className="min-h-screen bg-neutral-50">
      <Nav
        onLogout={onLogout}
        searchQuery={showSearch ? searchQuery : undefined}
        onSearchChange={showSearch ? setSearchQuery : undefined}
      />
      <Routes>
        <Route path="/" element={<Navigate to="/servers" replace />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/servers/:id/logs" element={<ServerLogs />} />
        <Route path="/models" element={<Models searchQuery={searchQuery} />} />
        <Route path="/router" element={<Router />} />
        <Route path="/router/logs" element={<RouterLogs />} />
      </Routes>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const hasKey = !!api.getApiKey();
    if (hasKey) {
      api.getSystemStatus()
        .then(() => setIsAuthenticated(true))
        .catch(() => {
          api.clearApiKey();
          setIsAuthenticated(false);
        });
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-neutral-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <ApiKeyPrompt onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent onLogout={() => setIsAuthenticated(false)} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
