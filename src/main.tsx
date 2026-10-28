import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AuthGate from './components/AuthGate.tsx';
import './index.css';
import 'katex/dist/katex.min.css';

if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  try {
    const originalFetch = window.fetch.bind(window);
    const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.startsWith('/api') || url.startsWith('/artifacts')) {
        const token = localStorage.getItem('twinmind_owner_token');
        const headers = new Headers(init?.headers || {});
        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        return originalFetch(input, {
          credentials: 'include',
          ...init,
          headers,
        });
      }
      return originalFetch(input, init);
    };

    try {
      Object.defineProperty(window, 'fetch', {
        value: customFetch,
        writable: true,
        configurable: true,
      });
    } catch {
      // If Object.defineProperty is not permitted on window in this browser context,
      // fallback without throwing.
    }
  } catch (err) {
    console.warn('[TwinMind] Could not install global fetch wrapper:', err);
  }
}

createRoot(document.getElementById('root')!).render(<AuthGate><App /></AuthGate>);
