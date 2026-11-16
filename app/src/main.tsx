import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Keep the WebGL back buffer readable for diagnostics/screenshots.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
  const merged = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
  return originalGetContext.call(this, type as never, merged as never);
} as typeof HTMLCanvasElement.prototype.getContext;

window.addEventListener('unhandledrejection', event => {
  const reason = event.reason as { stack?: string; message?: string } | undefined;
  console.error('UNHANDLED', reason?.stack || reason?.message || String(event.reason));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
