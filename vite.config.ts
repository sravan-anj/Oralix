import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

/**
 * Dev-only plugin that routes /api/chat directly to api/chat.js
 * when running the local Vite development server (npm run dev).
 * In production or on Vercel, this server middleware is bypassed
 * and Vercel executes api/chat.js natively as a serverless function.
 */
function devChatApiPlugin(): Plugin {
  return {
    name: 'dev-chat-api',
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';
        if (url === '/api/chat' || url.startsWith('/api/chat?') || url.startsWith('/api/chat/')) {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed.' }));
            return;
          }

          let rawBody = '';
          req.on('data', (chunk: any) => {
            rawBody += chunk;
          });

          req.on('end', async () => {
            try {
              req.body = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              req.body = {};
            }

            if (!res.status) {
              res.status = (code: number) => {
                res.statusCode = code;
                return res;
              };
            }

            if (!res.json) {
              res.json = (data: any) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
                return res;
              };
            }

            try {
              const { default: handler } = await import('./api/chat.js');
              await handler(req, res);
            } catch (err: any) {
              console.error('Local dev chat handler error:', err);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Internal server error in dev API' }));
              }
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  const rootDir = typeof import.meta.dirname !== 'undefined' ? import.meta.dirname : path.resolve('.');

  return {
    plugins: [react(), tailwindcss(), devChatApiPlugin()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify – file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
