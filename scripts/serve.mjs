import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { ensureAuth } from './auth.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] === 'preview' ? 'preview' : 'dev';
const apiPort = process.env.AGENT_WEB_API_PORT || '4097';
const apiBase = `http://127.0.0.1:${apiPort}`;
const agyPort = process.env.AGY_BRIDGE_PORT || '4098';
const agyBase = `http://127.0.0.1:${agyPort}`;
const orcaPort = process.env.ORCA_BRIDGE_PORT || '4099';
const orcaBase = `http://127.0.0.1:${orcaPort}`;
const auth = ensureAuth(root);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function agentIsUp() {
  try {
    const res = await fetch(`${apiBase}/config`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function agyIsUp() {
  try {
    const res = await fetch(`${agyBase}/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureAgyBridge() {
  if (await agyIsUp()) return null;

  console.log(`\n  Agy ACP 브리지를 시작합니다 (port ${agyPort})\n`);
  const child = spawn(process.execPath, [join(root, 'scripts', 'agy-bridge.mjs')], {
    cwd: process.env.AGENT_WEB_WORKDIR || root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, AGY_BRIDGE_PORT: agyPort },
  });
  child.on('error', (error) => {
    console.error(`  Agy 브리지를 실행하지 못했습니다: ${error.message}`);
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(250);
    if (await agyIsUp()) return child;
    if (child.exitCode !== null) break;
  }

  child.kill('SIGTERM');
  console.error(`  Agy 브리지가 ${agyBase}에서 응답하지 않습니다. OpenCode로 전환할 수 있습니다.`);
  return null;
}

async function orcaBridgeIsUp() {
  try {
    const res = await fetch(`${orcaBase}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureOrcaBridge() {
  if (await orcaBridgeIsUp()) return null;

  console.log(`\n  Orca 데스크 브리지를 시작합니다 (port ${orcaPort})\n`);
  const child = spawn(process.execPath, [join(root, 'scripts', 'orca-bridge.mjs')], {
    cwd: process.env.AGENT_WEB_WORKDIR || root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ORCA_BRIDGE_PORT: orcaPort },
  });
  child.on('error', (error) => {
    console.error(`  Orca 브리지를 실행하지 못했습니다: ${error.message}`);
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250);
    if (await orcaBridgeIsUp()) return child;
    if (child.exitCode !== null) break;
  }

  child.kill('SIGTERM');
  console.error('  Orca 브리지가 응답하지 않습니다. 병렬 데스크는 사용할 수 없습니다.');
  return null;
}

async function ensureAgent() {
  if (await agentIsUp()) return null;

  const bin = process.env.OPENCODE_BIN || 'opencode';
  console.log(`\n  에이전트 서버를 시작합니다 (${bin} serve --pure --port ${apiPort})\n`);
  const child = spawn(bin, ['serve', '--pure', '--port', apiPort, '--hostname', '127.0.0.1'], {
    cwd: process.env.AGENT_WEB_WORKDIR || root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  child.on('error', (error) => {
    console.error(`  에이전트 서버를 실행하지 못했습니다: ${error.message}`);
    console.error('  opencode가 PATH에 있는지 확인하거나 OPENCODE_BIN을 지정해 주세요.\n');
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(250);
    if (await agentIsUp()) return child;
    if (child.exitCode !== null) break;
  }

  child.kill('SIGTERM');
  throw new Error(`OpenCode 서버가 ${apiBase}에서 응답하지 않습니다.`);
}

async function main() {
  const dist = join(root, 'dist', 'index.html');
  if (mode === 'preview' && !existsSync(dist)) {
    throw new Error('dist가 없습니다. 먼저 `npm run build`를 실행해 주세요.');
  }

  const [agent, agy, orca] = await Promise.all([
    ensureAgent(),
    ensureAgyBridge(),
    ensureOrcaBridge(),
  ]);
  const server =
    mode === 'preview'
      ? await preview({ root })
      : await createServer({ root });

  if (mode === 'dev') await server.listen();
  server.printUrls();

  console.log('\n  ┌──────────────────────────────────────────────');
  console.log(`  │  접속 아이디: ${auth.username}`);
  if (auth.created) {
    console.log(`  │  새 비밀번호: ${auth.password}`);
    console.log('  │  위 비밀번호는 .agent-web-auth.json에만 저장됩니다.');
  }
  console.log('  │  터널을 열었다면 아이디와 비밀번호를 입력해야 접속됩니다.');
  console.log('  └──────────────────────────────────────────────\n');

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n  종료 중 (${signal})…`);
    try {
      await server.close();
    } catch {
      // ignore
    }
    agent?.kill('SIGTERM');
    agy?.kill('SIGTERM');
    orca?.kill('SIGTERM');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
});
