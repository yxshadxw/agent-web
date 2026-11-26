import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { ensureAuth } from './scripts/auth.mjs';
import { ensureToken } from './scripts/token.mjs';
import { createCodexHandler } from './scripts/codex-chat.mjs';

const API_PORT = process.env.AGENT_WEB_API_PORT || '4097';
const API_TARGET = `http://127.0.0.1:${API_PORT}`;
const AGY_PORT = process.env.AGY_BRIDGE_PORT || '4098';
const AGY_TARGET = `http://127.0.0.1:${AGY_PORT}`;
const ORCA_PORT = process.env.ORCA_BRIDGE_PORT || '4099';
const ORCA_TARGET = `http://127.0.0.1:${ORCA_PORT}`;
const COOKIE = 'agent_access';

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index === -1) continue;
    if (chunk.slice(0, index).trim() === name) {
      return decodeURIComponent(chunk.slice(index + 1).trim());
    }
  }
  return null;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function accessGuard(): Plugin {
  const token = ensureToken();
  const credentials = ensureAuth();

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url || '/').split('?')[0];

    if (path === '/login') {
      if (req.method !== 'POST') {
        send(res, 405, { error: 'method not allowed' });
        return;
      }
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          username?: string;
          password?: string;
        };
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (
          !username ||
          !password ||
          !sameSecret(username, credentials.username) ||
          !sameSecret(password, credentials.password)
        ) {
          send(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않아요' });
          return;
        }
      } catch {
        send(res, 400, { error: '요청을 읽지 못했어요' });
        return;
      }
      res.statusCode = 204;
      res.setHeader(
        'Set-Cookie',
        `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      );
      res.end();
      return;
    }

    if (path === '/logout') {
      res.statusCode = 204;
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      res.end();
      return;
    }

    const cookie = readCookie(req.headers.cookie, COOKIE);
    if (!cookie || !sameSecret(cookie, token)) {
      send(res, 401, { error: '로그인이 필요해요' });
      return;
    }
    next();
  };

  const attach = (middlewares: { use: (route: string, fn: typeof handle) => void }) => {
    for (const prefix of ['/api', '/agy-api', '/orca-api', '/codex-api', '/android-vnc']) {
      middlewares.use(prefix, (req, res, next) => {
        void handle(req, res, next);
      });
    }
  };

  return {
    name: 'agent-web-access',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

function codexChat(): Plugin {
  const handler = createCodexHandler({
    root: process.cwd(),
    workingRoot: process.cwd(),
  });

  const attach = (server: {
    middlewares: {
      use: (
        route: string,
        fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
      ) => void;
    };
  }) => {
    server.middlewares.use('/codex-api', (req, res, next) => {
      void handler(req, res, next);
    });
  };

  return {
    name: 'agent-web-codex',
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}

const proxy = {
  '/agy-api': {
    target: AGY_TARGET,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/agy-api/, ''),
  },
  '/orca-api': {
    target: ORCA_TARGET,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/orca-api/, ''),
  },
  '/api': {
    target: API_TARGET,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
  '/android-vnc': {
    target: 'http://127.0.0.1:6080',
    changeOrigin: true,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/android-vnc/, ''),
  },
};

export default defineConfig({
  plugins: [react(), accessGuard(), codexChat()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-icons': ['lucide-react'],
          'vendor-markdown': ['marked', 'dompurify', 'diff'],
          'vendor-anime': ['animejs'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com', '.yxshadxw.dev'],
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com', '.yxshadxw.dev'],
    proxy,
  },
});
