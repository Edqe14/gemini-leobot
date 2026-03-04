import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element (#root) was not found in index.html');
}

window.addEventListener('error', (event) => {
  rootElement.innerHTML = `<pre style="padding:16px;white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">Bootstrap error: ${String(event.error?.message ?? event.message)}</pre>`;
});

window.addEventListener('unhandledrejection', (event) => {
  const reason =
    event.reason instanceof Error ? event.reason.message : String(event.reason);
  rootElement.innerHTML = `<pre style="padding:16px;white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">Bootstrap rejection: ${reason}</pre>`;
});

void import('./App.tsx')
  .then(({ default: App }) => {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error) => {
    rootElement.innerHTML = `<pre style="padding:16px;white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">Failed to import App: ${String(error instanceof Error ? error.message : error)}</pre>`;
  });
