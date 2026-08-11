import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from './api/queryClient';
import { App } from './App';
import { installArrowRewrite } from './lib/arrow';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import './styles/tokens.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('tablinum: #root is missing from index.html');

// One listener for every text box in the app, above React and outside its tree.
installArrowRewrite();

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
