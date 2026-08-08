import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from './api/queryClient';
import { App } from './App';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import './styles/tokens.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('gitdocs: #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
