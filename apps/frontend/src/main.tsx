import './polyfills';
import './app/global.scss';
import 'react-tooltip/dist/react-tooltip.css';
import '@copilotkit/react-ui/styles.css';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';

// After a deploy, a tab opened earlier asks for route chunks that no longer
// exist. Reload once to pick up the new build instead of showing the error.
const reloadedAtKey = 'chunk-reload-at';
window.addEventListener('vite:preloadError', (event) => {
  const reloadedAt = Number(sessionStorage.getItem(reloadedAtKey));
  if (Date.now() - reloadedAt < 10_000) {
    return;
  }
  event.preventDefault();
  sessionStorage.setItem(reloadedAtKey, String(Date.now()));
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
);
