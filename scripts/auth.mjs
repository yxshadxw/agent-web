import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

export function authPath(root = process.cwd()) {
  return join(root, '.agent-web-auth.json');
}

export function ensureAuth(root = process.cwd()) {
  const username = process.env.AGENT_WEB_USERNAME?.trim();
  const password = process.env.AGENT_WEB_PASSWORD;
  if (username && password) return { username, password, created: false };

  try {
    const parsed = JSON.parse(readFileSync(authPath(root), 'utf8'));
    if (
      typeof parsed?.username === 'string' &&
      parsed.username.trim() &&
      typeof parsed?.password === 'string' &&
      parsed.password
    ) {
      return { username: parsed.username.trim(), password: parsed.password, created: false };
    }
  } catch {
    // fall through and create a local credential file
  }

  const defaultUser = process.env.USER?.trim() || userInfo().username || 'admin';
  const auth = {
    username: defaultUser,
    password: randomBytes(12).toString('base64url'),
  };
  writeFileSync(authPath(root), `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  return { ...auth, created: true };
}
