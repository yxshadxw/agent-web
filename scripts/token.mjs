import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function tokenPath(root = process.cwd()) {
  return join(root, '.agent-web-token');
}

export function ensureToken(root = process.cwd()) {
  const fromEnv = process.env.AGENT_WEB_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const file = tokenPath(root);
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 6) return existing;
  } catch {
    // fall through and create one
  }

  const token = randomBytes(4).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}
