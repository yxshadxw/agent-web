/**
 * Local-only bridge between the web desk and the Orca runtime.
 *
 * Orca owns worktrees, agent terminals and project registration. This process
 * never exposes Orca credentials; it only shells out to the local `orca` CLI
 * and returns the normalized fields the desk needs.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.ORCA_BRIDGE_PORT || 4099);
const ORCA_BIN = process.env.ORCA_BIN || 'orca';
const CREDENTIALS_PATH =
  process.env.FREEBUFF_CREDENTIALS ||
  join(homedir(), '.config', 'manicode', 'credentials.json');
const FREEBUFF_PROJECTS_DIR = join(homedir(), '.config', 'manicode', 'projects');
const FREEBUFF_BASE = 'https://www.codebuff.com';
const ORCA_TIMEOUT = 30_000;
const MAX_BODY = 1_000_000;
const MAX_ATTACHMENT_BODY = 30 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_DIR = join(tmpdir(), 'agent-web-attachments');
const CACHE_MS = 2_500;
const FREEBUFF_SESSION_MESSAGE_LIMIT = 80;
const FREEBUFF_SESSION_ENTRY_LIMIT = 1_000;
const FREEBUFF_SESSION_TEXT_MAX = 120_000;
const FREEBUFF_SESSION_OUTPUT_MAX = 60_000;
const freebuffSessionCache = new Map();

let overviewCache = null;
let overviewCacheAt = 0;
let overviewInflight = null;

let usageCache = null;
let usageCacheAt = 0;
let usageInflight = null;

// Small, local-only delivery ledger. The authoritative mailbox is Orca's
// orchestration layer; this list lets the desk show who messaged whom.
const MESSAGE_DIR = join(process.cwd(), '.agent-desk');
const MESSAGE_FILE = join(MESSAGE_DIR, 'messages.json');

function loadMessageLog() {
  try {
    const parsed = JSON.parse(readFileSync(MESSAGE_FILE, 'utf8'));
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.text === 'string').slice(-200)
      : [];
  } catch {
    return [];
  }
}

function saveMessageLog() {
  try {
    mkdirSync(MESSAGE_DIR, { recursive: true });
    writeFileSync(MESSAGE_FILE, `${JSON.stringify(messageLog.slice(-200), null, 2)}\n`, {
      mode: 0o600,
    });
  } catch {
    // The message already reached Orca; a local history write failure is non-fatal.
  }
}

const messageLog = loadMessageLog();

const COMMON_RULES = `[Agent Desk 공통 지시 — 반드시 준수]
- 사용자에게 선택지, 확인, 모델 선택, 승인 팝업을 띄우지 마세요. 안전한 기본값을 스스로 골라 작업을 끝까지 진행하세요.
- 파일 삭제, 배포, 푸시, 자격 증명 변경처럼 되돌리기 어려운 동작만 멈추고 이유를 남기세요.
- 코드베이스 구조나 관계를 물을 때는 graphify를 먼저 사용하고, graphify-out이 없으면 관련 파일만 좁혀 읽어 토큰을 아끼세요.
- 전체 파일·전체 로그·전체 diff를 반복해서 읽지 말고, 검색 결과와 필요한 줄 범위만 읽으세요.
- 다른 작업자와 협업할 때는 Orca orchestration 메시지를 사용하고, 가능하면 결과에 누가 무엇을 했는지 남기세요.
- 같은 파일을 여러 워커가 동시에 수정하지 마세요. 충돌 가능성이 있으면 코디네이터에게 먼저 알리세요.
- 커밋·푸시는 사용자가 요청한 경우에만 하고, 푸시 충돌 시 강제 푸시하지 말고 코디네이터에게 충돌 해결 메시지를 보내세요.
- 작업이 끝나면 변경 사항과 검증 결과를 짧게 요약하세요.`;

function agentPrompt(prompt) {
  return `${COMMON_RULES}\n\n[작업]\n${prompt}`;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('요청 본문이 너무 큽니다.'));
        req.destroy();
      }
    });
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

function errorMessage(error) {
  if (!error) return '알 수 없는 오류가 발생했습니다.';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  return String(error);
}

function cleanBranch(branch) {
  return String(branch || '')
    .replace(/^refs\/heads\//, '')
    .trim();
}

async function runCommand(bin, args, { cwd, timeout = 30_000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: cwd || process.cwd(),
      env: process.env,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${bin} 명령을 찾지 못했습니다.`);
    if (error?.killed) throw new Error(`${bin} 응답 시간이 초과되었습니다.`);
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(detail.slice(0, 1_200));
  }
}

async function runOrca(args, timeout = ORCA_TIMEOUT) {
  try {
    const { stdout, stderr } = await execFileAsync(ORCA_BIN, args, {
      cwd: process.cwd(),
      env: process.env,
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    const text = String(stdout || '').trim();
    if (!text) {
      throw new Error(String(stderr || '').trim() || 'Orca가 빈 응답을 반환했습니다.');
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `Orca 응답을 해석하지 못했습니다: ${text.slice(0, 240)}`,
      );
    }

    if (payload?.ok === false) {
      const detail =
        payload?.error?.message ||
        (typeof payload?.error === 'string' ? payload.error : '') ||
        payload?.message ||
        'Orca 명령을 실행하지 못했습니다.';
      throw new Error(detail);
    }

    return payload?.result ?? payload;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('orca CLI를 찾지 못했습니다.');
    }
    if (error?.killed) {
      throw new Error('Orca 응답 시간이 초과되었습니다.');
    }
    throw error;
  }
}

function normalizeState(value) {
  const state = String(value || '').toLowerCase();
  if (state === 'busy' || state === 'working' || state === 'running') return 'working';
  if (state === 'waiting' || state === 'permission') return 'waiting';
  if (state === 'error' || state === 'failed') return 'error';
  if (state === 'done' || state === 'complete' || state === 'completed') return 'done';
  return state || 'idle';
}

function normalizeAgent(agent, worktree, terminal, index) {
  const paneKey =
    agent?.paneKey ||
    (agent?.tabId && agent?.leafId ? `${agent.tabId}:${agent.leafId}` : null);
  const fallbackId = `${worktree.id}:${agent?.agentType || 'agent'}:${index}`;
  const title =
    agent?.conversationName ||
    agent?.displayName ||
    agent?.taskTitle ||
    terminal?.title ||
    agent?.prompt ||
    '이름 없는 에이전트';
  const prompt = String(agent?.prompt || '').trimStart();
  const roleSource = `${prompt}\n${String(agent?.title || '').trimStart()}`;
  const role = prompt.startsWith('[워커 역할]')
    ? 'worker'
    : prompt.startsWith('[코디네이터 역할]') || prompt.startsWith('[지휘자 역할]')
      ? 'coordinator'
      : /\[워커 역할\]/.test(roleSource)
        ? 'worker'
        : /\[(코디네이터|지휘자) 역할\]/.test(roleSource)
          ? 'coordinator'
          : null;

  const kind =
    agent?.kind === 'chat' ||
    String(agent?.paneKey || '').startsWith('structured-agent-session-')
      ? 'chat'
      : agent?.kind === 'terminal' || terminal
        ? 'terminal'
        : null;

  return {
    id: agent?.orcaSessionId || paneKey || fallbackId,
    orcaSessionId: agent?.orcaSessionId || null,
    agent: agent?.agentType || agent?.agent || 'agent',
    kind,
    state: normalizeState(agent?.state),
    title,
    prompt: agent?.prompt || '',
    role,
    worktreeId: worktree.id,
    repo: worktree.repo,
    path: worktree.path,
    branch: worktree.branch,
    terminalHandle: terminal?.handle || null,
    terminalTitle: terminal?.title || null,
    terminalPreview: terminal?.preview || '',
    terminalConnected: Boolean(terminal?.connected),
    updatedAt:
      Number(agent?.updatedAt || terminal?.lastOutputAt || worktree.lastActivityAt) || null,
    interrupted: Boolean(agent?.interrupted),
  };
}

function normalizeWorktree(raw, flatAgents, terminalMap) {
  const id = raw.worktreeId || raw.id || raw.path;
  const path = raw.path || '';
  const repo = raw.repo || basename(dirname(path));
  const branch = cleanBranch(raw.branch || raw.git?.branch);
  const rawAgents = Array.isArray(raw.agents) && raw.agents.length
    ? raw.agents
    : flatAgents.filter((agent) => agent.worktreeId === id);

  const agents = rawAgents
    .map((agent, index) => {
      const paneKey =
        agent?.paneKey ||
        (agent?.tabId && agent?.leafId ? `${agent.tabId}:${agent.leafId}` : '');
      return normalizeAgent(
        agent,
        { id, repo, path, branch, lastActivityAt: raw.lastActivityAt },
        terminalMap.get(paneKey),
        index,
      );
    })
    .filter(
      (agent) =>
        agent.terminalHandle ||
        agent.state === 'working' ||
        agent.state === 'waiting' ||
        (agent.kind === 'chat' && Boolean(agent.role)),
    );

  agents.sort((a, b) => {
    const rank = (state) => (state === 'working' ? 0 : state === 'waiting' ? 1 : 2);
    return rank(a.state) - rank(b.state) || (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return {
    id,
    repoId: raw.repoId || raw.projectId || repo,
    repo,
    projectId: raw.projectId || null,
    path,
    displayName: raw.displayName || basename(path) || repo,
    branch,
    status: raw.status || (agents.some((agent) => agent.state === 'working') ? 'working' : 'idle'),
    isMainWorktree: Boolean(raw.isMainWorktree),
    isArchived: Boolean(raw.isArchived),
    lastActivityAt: Number(raw.lastActivityAt) || null,
    liveTerminalCount: Number(raw.liveTerminalCount) || 0,
    preview: raw.preview || '',
    agents,
  };
}

async function buildOverview() {
  const [ps, terminalList, agentList] = await Promise.all([
    runOrca(['worktree', 'ps', '--json']),
    runOrca(['terminal', 'list', '--json']).catch(() => ({ terminals: [] })),
    runOrca(['agent', 'list', '--json']).catch(() => ({ agents: [] })),
  ]);

  const rawWorktrees = Array.isArray(ps?.worktrees) ? ps.worktrees : [];
  const terminals = Array.isArray(terminalList?.terminals) ? terminalList.terminals : [];
  const flatAgents = Array.isArray(agentList?.agents) ? agentList.agents : [];

  const terminalMap = new Map();
  for (const terminal of terminals) {
    if (terminal?.tabId && terminal?.leafId) {
      // Orca's agent paneKey is tabId:leafId. Terminal list exposes the two
      // halves separately, so join them to attach the live terminal handle.
      terminalMap.set(`${terminal.tabId}:${terminal.leafId}`, terminal);
    }
    if (terminal?.paneKey) terminalMap.set(terminal.paneKey, terminal);
  }

  const worktrees = rawWorktrees
    .filter((worktree) => !worktree?.isArchived)
    .map((worktree) => normalizeWorktree(worktree, flatAgents, terminalMap))
    .filter((worktree) => worktree.path);

  worktrees.sort((a, b) => {
    const aWorking = a.agents.some((agent) => agent.state === 'working') ? 1 : 0;
    const bWorking = b.agents.some((agent) => agent.state === 'working') ? 1 : 0;
    return bWorking - aWorking || (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
  });

  const groups = new Map();
  for (const worktree of worktrees) {
    const key = worktree.repoId || worktree.repo;
    const list = groups.get(key) || [];
    list.push(worktree);
    groups.set(key, list);
  }

  const projects = [...groups.entries()]
    .map(([key, items]) => ({
      id: key,
      repo: items[0]?.repo || key,
      worktrees: items,
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo));

  const agents = worktrees.flatMap((worktree) => worktree.agents);
  agents.sort((a, b) => {
    const rank = (state) => (state === 'working' ? 0 : state === 'waiting' ? 1 : 2);
    return rank(a.state) - rank(b.state) || (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    host: hostname(),
    currentPath: process.cwd(),
    projects,
    worktrees,
    agents,
    counts: {
      projects: projects.length,
      worktrees: worktrees.length,
      agents: agents.length,
      working: agents.filter((agent) => agent.state === 'working').length,
    },
  };
}

async function getOverview(force = false) {
  const now = Date.now();
  if (!force && overviewCache && now - overviewCacheAt < CACHE_MS) return overviewCache;
  if (overviewInflight) return overviewInflight;

  overviewInflight = buildOverview()
    .then((overview) => {
      overviewCache = overview;
      overviewCacheAt = Date.now();
      return overview;
    })
    .finally(() => {
      overviewInflight = null;
    });

  return overviewInflight;
}

async function resolveWorktreePath(rawPath) {
  const path = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!path) throw new Error('워크트리를 선택해 주세요.');
  const overview = await getOverview();
  const worktree = overview.worktrees.find((item) => item.path === path);
  if (!worktree) throw new Error('Orca에서 선택한 워크트리를 찾지 못했습니다.');
  return worktree;
}

function parseGithubRemote(remote) {
  const value = String(remote || '').trim();
  const match =
    value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i) ||
    value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    slug: `${match[1]}/${match[2]}`,
    url: `https://github.com/${match[1]}/${match[2]}`,
  };
}

async function githubInfo(worktree) {
  const raw = await runCommand('git', ['config', '--get', 'remote.origin.url'], {
    cwd: worktree.path,
    timeout: 8_000,
  }).catch(() => ({ stdout: '' }));
  const remote = parseGithubRemote(raw.stdout);
  if (!remote) {
    return {
      ok: false,
      connected: false,
      branch: worktree.branch,
      path: worktree.path,
      error: 'GitHub 원격 저장소가 연결된 프로젝트가 아닙니다.',
    };
  }

  const [view, branchResult, statusResult, accountResult] = await Promise.all([
    runCommand('gh', ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'], {
      cwd: worktree.path,
      timeout: 15_000,
    }).catch((error) => ({ error })),
    runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktree.path,
      timeout: 8_000,
    }).catch(() => ({ stdout: worktree.branch || 'HEAD' })),
    runCommand('git', ['status', '--porcelain'], {
      cwd: worktree.path,
      timeout: 10_000,
    }).catch(() => ({ stdout: '' })),
    runCommand('gh', ['api', 'user'], {
      cwd: worktree.path,
      timeout: 15_000,
    }).catch((error) => ({ error })),
  ]);

  let account = null;
  if (!accountResult.error) {
    try {
      const user = JSON.parse(accountResult.stdout || '{}');
      account = {
        login: user.login || null,
        name: user.name || null,
        url: user.html_url || null,
        avatarUrl: user.avatar_url || null,
      };
    } catch {
      account = null;
    }
  }

  if (view.error) {
    return {
      ok: false,
      connected: true,
      ...remote,
      account,
      branch: branchResult.stdout.trim() || worktree.branch,
      path: worktree.path,
      error: errorMessage(view.error),
    };
  }

  let repoView = {};
  try {
    repoView = JSON.parse(view.stdout || '{}');
  } catch {
    repoView = {};
  }

  const branch = branchResult.stdout.trim() || worktree.branch || 'HEAD';
  const defaultBranch = repoView.defaultBranchRef?.name || 'main';
  const baseRef = `origin/${defaultBranch}`;
  const baseExists = await runCommand('git', ['rev-parse', '--verify', '--quiet', baseRef], {
    cwd: worktree.path,
    timeout: 8_000,
  })
    .then(() => true)
    .catch(() => false);

  let ahead = null;
  let behind = null;
  if (baseExists) {
    try {
      const { stdout } = await runCommand(
        'git',
        ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`],
        { cwd: worktree.path, timeout: 10_000 },
      );
      const [left, right] = stdout.trim().split(/\s+/).map(Number);
      behind = Number.isFinite(left) ? left : null;
      ahead = Number.isFinite(right) ? right : null;
    } catch {
      // keep nulls
    }
  }

  const [runs, workflows] = await Promise.all([
    runCommand(
      'gh',
      [
        'run',
        'list',
        '--limit',
        '1',
        '--json',
        'databaseId,status,conclusion,workflowName,headBranch,event,url,createdAt,displayTitle',
      ],
      { cwd: worktree.path, timeout: 20_000 },
    )
      .then(({ stdout }) => JSON.parse(stdout || '[]'))
      .catch(() => []),
    runCommand('gh', ['workflow', 'list', '--all', '--json', 'id,name,state,path'], {
      cwd: worktree.path,
      timeout: 20_000,
    })
      .then(({ stdout }) => JSON.parse(stdout || '[]'))
      .catch(() => []),
  ]);

  return {
    ok: true,
    connected: true,
    ...remote,
    slug: repoView.nameWithOwner || remote.slug,
    url: repoView.url || remote.url,
    actionsUrl: `${repoView.url || remote.url}/actions`,
    account,
    branch,
    defaultBranch,
    ahead,
    behind,
    dirty: statusResult.stdout.split('\n').filter(Boolean).length,
    latestRun: Array.isArray(runs) && runs.length ? runs[0] : null,
    workflows: Array.isArray(workflows) ? workflows : [],
    path: worktree.path,
    fetchedAt: new Date().toISOString(),
  };
}

function findCoordinator(overview) {
  return overview.agents.find((agent) => agent.role === 'coordinator') || null;
}

async function notifyConflict(worktree, pushError) {
  const overview = await getOverview(true);
  const coordinator = findCoordinator(overview);
  if (!coordinator) {
    return { notified: false, reason: '등록된 코디네이터를 찾지 못했습니다.' };
  }
  const to = coordinator.terminalHandle || (coordinator.orcaSessionId ? `orca_session_id:${coordinator.orcaSessionId}` : '');
  if (!to) {
    return { notified: false, reason: '코디네이터에게 연결된 세션이나 터미널이 없습니다.' };
  }

  const subject = `[충돌] ${worktree.displayName} git push 실패`;
  const text = [
    `[충돌 해결 요청] ${worktree.path}`,
    '',
    'git push가 실패했습니다. 강제 푸시하지 말고 아래 오류를 확인해 충돌을 해결한 뒤 다시 커밋/푸시해 주세요.',
    '',
    pushError.slice(0, 1200),
  ].join('\n');

  await runOrca(
    [
      'orchestration',
      'send',
      '--subject',
      subject,
      '--body',
      text,
      '--to',
      to,
      '--type',
      'status',
      '--json',
    ],
    30_000,
  );

  messageLog.push({
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    fromId: null,
    fromName: 'Desk',
    toId: coordinator.id,
    toName: coordinator.title,
    text,
    delivered: true,
    type: 'conflict',
  });
  if (messageLog.length > 200) messageLog.splice(0, messageLog.length - 200);
  saveMessageLog();
  return { notified: true, coordinator: coordinator.title };
}

async function commitAndPush(body) {
  const worktree = await resolveWorktreePath(body?.path);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const pushOnly = Boolean(body?.pushOnly);
  if (!message && !pushOnly) throw new Error('커밋 메시지를 입력해 주세요.');
  if (message.length > 200) throw new Error('커밋 메시지는 200자 이하로 입력해 주세요.');

  const status = await runCommand('git', ['status', '--porcelain'], {
    cwd: worktree.path,
    timeout: 15_000,
  });
  const changed = status.stdout.split('\n').filter(Boolean);
  if (changed.length === 0 && !body?.push) throw new Error('커밋할 변경 사항이 없습니다.');
  if (changed.length > 0 && !message) throw new Error('커밋 메시지를 입력해 주세요.');

  let commit = null;
  if (changed.length > 0) {
    await runCommand('git', ['add', '-A'], { cwd: worktree.path, timeout: 20_000 });
    try {
      commit = await runCommand('git', ['commit', '-m', message], {
        cwd: worktree.path,
        timeout: 30_000,
      });
    } catch (error) {
      throw new Error(`커밋에 실패했습니다: ${errorMessage(error)}`);
    }
  }

  const hash = await runCommand('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: worktree.path,
    timeout: 8_000,
  })
    .then((result) => result.stdout.trim())
    .catch(() => '');

  let pushed = false;
  let pushError = null;
  let conflictNotice = null;
  if (body?.push) {
    try {
      // Set the upstream as well. This also handles a freshly committed branch
      // that has no upstream yet, which previously blocked pushes to main.
      await runCommand('git', ['push', '-u', 'origin', 'HEAD'], {
        cwd: worktree.path,
        timeout: 60_000,
      });
      pushed = true;
    } catch (error) {
      pushError = errorMessage(error);
      if (/rejected|non-fast-forward|conflict|fetch first|diverged/i.test(pushError)) {
        try {
          conflictNotice = await notifyConflict(worktree, pushError);
        } catch (noticeError) {
          conflictNotice = { notified: false, reason: errorMessage(noticeError) };
        }
      }
    }
  }

  invalidateOverview();
  return {
    ok: !pushError,
    committed: Boolean(commit),
    pushed,
    commit: commit ? { hash, message } : null,
    files: changed.length,
    pushError,
    conflictNotice,
  };
}

function instructionPath(worktree) {
  return join(worktree.path, 'AGENTS.md');
}

function readInstructions(worktree) {
  const file = instructionPath(worktree);
  const exists = existsSync(file);
  return {
    ok: true,
    path: worktree.path,
    file,
    exists,
    content: exists ? readFileSync(file, 'utf8') : '',
  };
}

function writeInstructions(worktree, body) {
  const content = typeof body?.content === 'string' ? body.content : '';
  if (content.length > 250_000) throw new Error('지침서는 250,000자 이하로 작성해 주세요.');
  const file = instructionPath(worktree);
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o644 });
  renameSync(temp, file);
  return readInstructions(worktree);
}

function clipText(value, limit = 30_000) {
  const text = String(value || '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}\n\n… ${text.length - limit}자 더 있음` : text;
}

async function memoryInfo(worktree) {
  let recent = '';
  let recentError = null;
  try {
    const result = await runCommand('ai-memory', ['recent', '--limit', '12'], {
      cwd: worktree.path,
      timeout: 20_000,
    });
    recent = clipText(result.stdout);
  } catch (error) {
    recentError = errorMessage(error);
  }

  return {
    ok: !recentError,
    path: worktree.path,
    recent,
    error: recentError,
    fetchedAt: new Date().toISOString(),
  };
}

async function messagePayload() {
  const overview = await getOverview();
  const agents = overview.agents.filter((agent) => agent.terminalHandle || agent.orcaSessionId);
  const known = new Set(agents.map((agent) => agent.terminalHandle).filter(Boolean));
  let inbox = [];
  try {
    const result = await runOrca(['orchestration', 'inbox', '--limit', '120', '--json'], 20_000);
    const rows = Array.isArray(result?.messages) ? result.messages : [];
    inbox = rows
      .filter((row) => row && (String(row.subject || '').startsWith('[Desk]') || known.has(row.from) || known.has(row.to)))
      .map((row) => {
        const fromAgent = agents.find((agent) => agent.terminalHandle === row.from);
        const toAgent = agents.find((agent) => agent.terminalHandle === row.to);
        return {
          id: row.id,
          type: row.type || 'status',
          priority: row.priority || null,
          subject: row.subject || '',
          text: row.body || '',
          fromId: fromAgent?.id || null,
          fromName: fromAgent?.title || row.from || '외부 세션',
          toId: toAgent?.id || null,
          toName: toAgent?.title || row.to || '알 수 없는 대상',
          handled: Boolean(row.handled),
          at: row.createdAt || row.at || null,
        };
      });
  } catch (error) {
    return {
      ok: true,
      messages: messageLog.slice(-120),
      agents,
      warning: `Orca inbox를 읽지 못해 로컬 기록을 표시합니다: ${errorMessage(error)}`,
    };
  }

  // Keep the inbox observable without the desk becoming a firehose of
  // unrelated worker_done events from other projects.
  return {
    ok: true,
    messages: inbox.slice(-120),
    agents,
    source: 'orca-inbox',
  };
}

async function sendDeskMessage(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const toId = typeof body?.toId === 'string' ? body.toId : '';
  const fromId = typeof body?.fromId === 'string' && body.fromId ? body.fromId : null;
  if (!text) throw new Error('전달할 메시지를 입력해 주세요.');
  if (text.length > 2_000) throw new Error('메시지는 2,000자 이하로 입력해 주세요.');

  // The overview cache can predate a freshly launched Freebuff terminal. Refresh
  // before resolving the recipient, and accept a terminal handle as well as an
  // agent id so the message box can address any live terminal.
  const overview = await getOverview(true);
  const target = overview.agents.find(
    (agent) =>
      agent.id === toId ||
      agent.terminalHandle === toId ||
      (agent.orcaSessionId &&
        (toId === agent.orcaSessionId || toId === `orca_session_id:${agent.orcaSessionId}`)),
  );
  if (!target) throw new Error('받는 작업자를 찾지 못했습니다.');
  const source = fromId ? overview.agents.find((agent) => agent.id === fromId) : null;
  // Orca rejects orchestration sends addressed to a terminal agent by session
  // id; terminal handles are the supported address for terminal agents.
  const to = target.terminalHandle || (target.orcaSessionId ? `orca_session_id:${target.orcaSessionId}` : '');
  if (!to) throw new Error('받는 작업자에게 연결된 터미널이나 세션이 없습니다.');

  const fromName = source?.title || '오퍼레이터';
  const subject = `[Desk] ${fromName} → ${target.title}`.slice(0, 160);
  const record = {
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    fromId,
    fromName,
    toId: target.id,
    toName: target.title,
    text,
    delivered: false,
  };

  try {
    await runOrca(
      [
        'orchestration',
        'send',
        '--subject',
        subject,
        '--body',
        text,
        '--to',
        to,
        '--type',
        'status',
        '--json',
      ],
      30_000,
    );
    record.delivered = true;
  } catch (error) {
    record.error = errorMessage(error);
  }

  messageLog.push(record);
  if (messageLog.length > 200) messageLog.splice(0, messageLog.length - 200);
  saveMessageLog();
  return {
    ok: true,
    message: record,
    messages: messageLog.slice(-120),
    agents: overview.agents.filter((agent) => agent.terminalHandle || agent.orcaSessionId),
    error: record.error,
  };
}

async function syncMemory(worktree) {
  try {
    const result = await runCommand('ai-memory', ['recover'], {
      cwd: worktree.path,
      timeout: 90_000,
    });
    const info = await memoryInfo(worktree);
    return {
      ...info,
      ok: true,
      synced: true,
      output: clipText(result.stdout) || '동기화할 새 기록이 없습니다.',
    };
  } catch (error) {
    return {
      ok: false,
      path: worktree.path,
      synced: false,
      error: errorMessage(error),
      fetchedAt: new Date().toISOString(),
    };
  }
}

function invalidateOverview() {
  overviewCache = null;
  overviewCacheAt = 0;
}

function cleanTerminalLines(lines) {
  const input = Array.isArray(lines) ? lines : String(lines || '').split('\n');
  const output = [];
  let blanks = 0;
  for (const raw of input) {
    const line = String(raw)
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\r$/, '')
      .replace(/[ \t]+$/g, '');
    if (!line.trim()) {
      blanks += 1;
      if (blanks > 2) continue;
    } else {
      blanks = 0;
    }
    output.push(line);
  }
  while (output.length && !output[0].trim()) output.shift();
  while (output.length && !output[output.length - 1].trim()) output.pop();
  return output;
}

async function readTerminal(handle, { cursor, limit, screen }) {
  if (!/^term_[a-zA-Z0-9-]+$/.test(handle)) {
    throw new Error('터미널 핸들이 올바르지 않습니다.');
  }
  const safeLimit = Math.max(40, Math.min(5000, Number(limit) || 800));
  const args = ['terminal', 'read', '--terminal', handle, '--limit', String(safeLimit), '--json'];
  if (screen) args.push('--screen');
  else if (cursor) args.push('--cursor', String(cursor));

  let result = await runOrca(args, 20_000);
  let terminal = result?.terminal || result || {};
  let tail = cleanTerminalLines(terminal.tail || terminal.output || []);

  // Alternate-screen TUIs (OpenCode, Codex) often cannot be captured with
  // --screen. Fall back to the stream cursor so the desk still shows output.
  if (screen && (terminal.source === 'screen-unavailable' || tail.length === 0)) {
    const fallbackArgs = ['terminal', 'read', '--terminal', handle, '--limit', String(safeLimit), '--json'];
    if (cursor) fallbackArgs.push('--cursor', String(cursor));
    try {
      const fallback = await runOrca(fallbackArgs, 20_000);
      const fallbackTerminal = fallback?.terminal || fallback || {};
      const fallbackTail = cleanTerminalLines(fallbackTerminal.tail || fallbackTerminal.output || []);
      if (fallbackTail.length) {
        result = fallback;
        terminal = fallbackTerminal;
        tail = fallbackTail;
      }
    } catch {
      // Keep the original screen snapshot if the stream read is unavailable.
    }
  }
  return {
    ok: true,
    handle: terminal.handle || handle,
    status: terminal.status || 'unknown',
    source: terminal.source || (screen ? 'screen' : 'stream'),
    tail,
    nextCursor: terminal.nextCursor ?? null,
    oldestCursor: terminal.oldestCursor ?? null,
    latestCursor: terminal.latestCursor ?? null,
    truncated: Boolean(terminal.truncated),
    limited: Boolean(terminal.limited),
    returnedLineCount: terminal.returnedLineCount ?? tail.length,
    fetchedAt: new Date().toISOString(),
  };
}

// The Freebuff TUI only exposes the current 30-40 row viewport, hard-wrapped
// and cut off mid-command. Freebuff keeps the authoritative turn in its own
// chat store, where every reasoning block and every tool call still has its
// complete multiline command and output. Read that instead of scraping rows.
function clipFreebuffSessionText(value, max) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n\n… (${omitted.toLocaleString('ko-KR')}자 생략)`;
}

function freebuffToolCommand(input) {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  for (const key of ['command', 'cmd', 'script']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key];
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function normalizeFreebuffSessionEntries(messages) {
  const entries = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const variant = String(message.variant || message.role || '');
    const content = typeof message.content === 'string' ? message.content : '';
    const at = typeof message.timestamp === 'string' ? message.timestamp : undefined;
    if (variant === 'user') {
      if (content.trim()) {
        entries.push({
          kind: 'message',
          role: 'user',
          at,
          text: clipFreebuffSessionText(content, FREEBUFF_SESSION_TEXT_MAX),
        });
      }
      continue;
    }
    const blocks = Array.isArray(message.blocks) ? message.blocks : [];
    if (!blocks.length) {
      if (content.trim()) {
        entries.push({
          kind: 'message',
          role: 'assistant',
          at,
          text: clipFreebuffSessionText(content, FREEBUFF_SESSION_TEXT_MAX),
        });
      }
      continue;
    }
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const type = String(block.type || '');
      if (type === 'text') {
        const text = typeof block.content === 'string' ? block.content : '';
        if (!text.trim()) continue;
        if (block.textType === 'reasoning' || block.textType === 'thinking') {
          entries.push({ kind: 'thinking', at, text: clipFreebuffSessionText(text, FREEBUFF_SESSION_TEXT_MAX) });
        } else {
          entries.push({
            kind: 'message',
            role: 'assistant',
            at,
            text: clipFreebuffSessionText(text, FREEBUFF_SESSION_TEXT_MAX),
          });
        }
        continue;
      }
      if (type === 'tool' || block.toolName) {
        const output =
          typeof block.output === 'string'
            ? block.output
            : block.output == null
              ? ''
              : JSON.stringify(block.output);
        entries.push({
          kind: 'tool',
          at,
          name: String(block.toolName || block.name || 'tool'),
          command: freebuffToolCommand(block.input),
          output: clipFreebuffSessionText(output, FREEBUFF_SESSION_OUTPUT_MAX),
          running: block.output == null && !block.error,
        });
      }
    }
  }
  return entries;
}

function freebuffProjectDirForPath(worktreePath) {
  const root = resolve(FREEBUFF_PROJECTS_DIR);
  const dir = resolve(join(root, basename(worktreePath)));
  if (dirname(dir) !== root) throw new Error('Freebuff 프로젝트 경로가 올바르지 않습니다.');
  return dir;
}

function findFreebuffChat(projectDir, requestedChat) {
  // Freebuff keeps sessions in <project>/chats/<timestamp>/; older builds
  // wrote them directly under <project>/. Check both layouts.
  const roots = [join(projectDir, 'chats'), projectDir].filter((dir) => existsSync(dir));
  const wanted = typeof requestedChat === 'string' ? requestedChat.trim() : '';
  if (wanted) {
    if (!/^[A-Za-z0-9._-]+$/.test(wanted) || wanted.includes('..')) {
      throw new Error('Freebuff 세션 ID가 올바르지 않습니다.');
    }
    for (const root of roots) {
      const file = join(root, wanted, 'chat-messages.json');
      if (existsSync(file)) return { chatId: wanted, file };
    }
    throw new Error('선택한 Freebuff 세션을 찾지 못했습니다.');
  }
  let chosen = null;
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T[A-Za-z0-9.:-]+$/.test(entry.name)) continue;
      const file = join(root, entry.name, 'chat-messages.json');
      if (!existsSync(file)) continue;
      const info = statSync(file);
      if (!chosen || info.mtimeMs > chosen.mtimeMs) {
        chosen = { chatId: entry.name, file, mtimeMs: info.mtimeMs };
      }
    }
  }
  if (!chosen) throw new Error('Freebuff 세션 기록이 아직 없습니다.');
  return chosen;
}

const OPENCODE_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4097';

function opencodeEntries(messages) {
  const entries = [];
  for (const m of messages) {
    const role = m?.info?.role;
    const at = m?.info?.time?.created ? new Date(m.info.time.created).toISOString() : undefined;
    for (const part of m?.parts || []) {
      if (part.type === 'text') {
        if (!String(part.text || '').trim() || part.synthetic) continue;
        entries.push({ kind: 'message', role: role === 'user' ? 'user' : 'assistant', at, text: clipFreebuffSessionText(part.text, FREEBUFF_SESSION_TEXT_MAX) });
      } else if (part.type === 'reasoning') {
        if (String(part.text || '').trim()) entries.push({ kind: 'thinking', at, text: clipFreebuffSessionText(part.text, FREEBUFF_SESSION_TEXT_MAX) });
      } else if (part.type === 'tool') {
        const st = part.state || {};
        const out = typeof st.output === 'string' ? st.output : st.error ? String(st.error) : '';
        entries.push({
          kind: 'tool', at, name: String(part.tool || 'tool'),
          command: freebuffToolCommand(st.input),
          output: clipFreebuffSessionText(out, FREEBUFF_SESSION_OUTPUT_MAX),
          running: st.status === 'pending' || st.status === 'running',
        });
      }
    }
  }
  return entries;
}

async function readOpencodeSession(rawPath) {
  const worktree = await resolveWorktreePath(rawPath);
  const dir = encodeURIComponent(worktree.path);
  const { body: list } = await fetchJson(`${OPENCODE_URL}/session?directory=${dir}`, {});
  const sessions = (Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [])
    .filter((x) => x.directory === worktree.path && !x.parentID)
    .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
  if (!sessions.length) return { ok: false, entries: [], error: 'OpenCode 세션을 찾지 못했습니다.', fetchedAt: new Date().toISOString() };
  const chosen = sessions[0];
  const { body: msgs } = await fetchJson(`${OPENCODE_URL}/session/${chosen.id}/message?directory=${dir}`, {});
  const messages = Array.isArray(msgs?.data) ? msgs.data : Array.isArray(msgs) ? msgs : [];
  const entries = opencodeEntries(messages.slice(-FREEBUFF_SESSION_MESSAGE_LIMIT)).slice(-FREEBUFF_SESSION_ENTRY_LIMIT);
  return { ok: true, entries, chatId: chosen.id, updatedAt: chosen.time?.updated || Date.now(), truncated: false, fetchedAt: new Date().toISOString() };
}

async function readFreebuffSession(rawPath, requestedChat) {
  const worktree = await resolveWorktreePath(rawPath);
  const projectDir = freebuffProjectDirForPath(worktree.path);
  if (!existsSync(projectDir)) {
    return {
      ok: false,
      entries: [],
      error: '이 워크트리의 Freebuff 세션 기록을 찾지 못했습니다.',
      fetchedAt: new Date().toISOString(),
    };
  }
  const chat = findFreebuffChat(projectDir, requestedChat);
  const fileStat = statSync(chat.file);
  const cached = freebuffSessionCache.get(chat.file);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return { ...cached.payload, fetchedAt: new Date().toISOString() };
  }
  const parsed = JSON.parse(readFileSync(chat.file, 'utf8'));
  const messages = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.messages)
      ? parsed.messages
      : [];
  const replayed = normalizeFreebuffSessionEntries(
    messages.slice(-FREEBUFF_SESSION_MESSAGE_LIMIT),
  );
  const entries = replayed.slice(-FREEBUFF_SESSION_ENTRY_LIMIT);
  const last = messages[messages.length - 1];
  const payload = {
    ok: true,
    chatId: chat.chatId,
    updatedAt: fileStat.mtimeMs,
    state: last && last.isComplete === false ? 'working' : 'idle',
    entries,
    truncated:
      replayed.length > entries.length || messages.length > FREEBUFF_SESSION_MESSAGE_LIMIT,
    fetchedAt: new Date().toISOString(),
  };
  freebuffSessionCache.set(chat.file, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    payload,
  });
  if (freebuffSessionCache.size > 24) {
    const first = freebuffSessionCache.keys().next().value;
    if (first) freebuffSessionCache.delete(first);
  }
  return payload;
}

const AGY_BRAIN_DIR = join(homedir(), '.gemini', 'antigravity-cli', 'brain');

function agyToolDetail(call) {
  const a = call?.args || {};
  const clean = (v) => String(v ?? '').replace(/^"|"$/g, '').replace(/\\"/g, '"');
  const pick = (...keys) => {
    for (const k of keys) if (a[k] != null && a[k] !== '') return clean(a[k]);
    return '';
  };
  const name = String(call?.name || '');
  const detail =
    pick('CommandLine', 'command', 'Path', 'AbsolutePath', 'TargetFile', 'query', 'Query', 'Url', 'Role', 'Pattern', 'SearchPath') ||
    clean(JSON.stringify(a)).slice(0, 300);
  return { tool: name, detail: detail.slice(0, 2000), summary: pick('toolSummary') };
}

// Orca's Agy transcript only says `execute`. Recover the real commands from the
// Agy CLI's own transcript for the matching conversation.
function enrichAgyTools(entries) {
  try {
    const toolEntries = entries.filter((e) => e.kind === 'tool');
    if (!toolEntries.length || !existsSync(AGY_BRAIN_DIR)) return entries;
    const lastUser = [...entries].reverse().find((e) => e.role === 'user' && e.text)?.text || '';
    const needle = lastUser.replace(/\[image\]/g, '').trim().slice(0, 80);
    const candidates = readdirSync(AGY_BRAIN_DIR)
      .map((id) => join(AGY_BRAIN_DIR, id, '.system_generated', 'logs', 'transcript_full.jsonl'))
      .filter((f) => existsSync(f))
      .map((f) => ({ f, m: statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, 12);
    for (const { f } of candidates) {
      const text = readFileSync(f, 'utf8');
      if (needle && !text.includes(JSON.stringify(needle).slice(1, -1))) continue;
      const calls = [];
      for (const line of text.split('\n')) {
        if (!line.includes('tool_calls')) continue;
        try {
          const row = JSON.parse(line);
          const thinking = typeof row.thinking === 'string' ? row.thinking.trim() : '';
          (row.tool_calls || []).forEach((call, n) => {
            const d = agyToolDetail(call);
            if (n === 0 && thinking) d.thinking = thinking;
            calls.push(d);
          });
        } catch { /* skip */ }
      }
      if (!calls.length) continue;
      const tail = calls.slice(-toolEntries.length);
      const offset = toolEntries.length - tail.length;
      let i = 0;
      return entries.flatMap((e) => {
        if (e.kind !== 'tool') return [e];
        const c = tail[i - offset >= 0 ? i - offset : 0];
        const idx = i++;
        if (idx < offset || !c) return [e];
        const enriched = { ...e, detail: c.detail, label: c.summary || '', tool: c.tool };
        return c.thinking
          ? [{ kind: 'thinking', role: 'assistant', text: c.thinking.slice(0, 20000) }, enriched]
          : [enriched];
      });
    }
  } catch { /* fall back to plain entries */ }
  return entries;
}

async function readTranscript(sessionId) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!/^[a-f0-9-]{20,64}$/i.test(id)) {
    throw new Error('세션 ID가 올바르지 않습니다.');
  }
  const raw = await runOrca(
    ['agent', 'read', `orca_session_id:${id}`, '--limit', '100', '--json'],
    30_000,
  );
  const data = raw?.result || raw;
  return {
    ok: true,
    orcaSessionId: id,
    kind: data?.kind || null,
    agent: data?.agent || null,
    source: data?.source || 'transcript',
    state: data?.state || null,
    entries:
      data?.agent === 'antigravity' && Array.isArray(data?.entries)
        ? enrichAgyTools(data.entries)
        : Array.isArray(data?.entries)
          ? data.entries
          : [],
    limited: Boolean(data?.limited),
    fetchedAt: new Date().toISOString(),
  };
}

function attachmentName(value, fallback = 'attachment') {
  const raw = basename(String(value || '').replace(/\\/g, '/'))
    .replace(/[^\p{L}\p{N}._()\[\] -]/gu, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120);
  return raw || fallback;
}

function saveAttachment(bytes, name) {
  if (!bytes.length) throw new Error('빈 파일은 저장할 수 없습니다.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('파일은 20MB 이하만 전송할 수 있습니다.');
  }
  mkdirSync(ATTACHMENT_DIR, { recursive: true });
  const safeName = attachmentName(name);
  const target = join(ATTACHMENT_DIR, `${randomUUID()}-${safeName}`);
  writeFileSync(target, bytes, { mode: 0o600 });
  return { ok: true, path: target, name: safeName, size: bytes.length };
}

function decodeAttachmentData(value) {
  const raw = String(value || '');
  const payload = raw.includes(',') && raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!payload) throw new Error('파일 데이터가 없습니다.');
  const bytes = Buffer.from(payload, 'base64');
  if (!bytes.length) throw new Error('파일 데이터를 해석하지 못했습니다.');
  return bytes;
}

async function downloadAttachment(urlValue, name) {
  let url;
  try {
    url = new URL(String(urlValue || ''));
  } catch {
    throw new Error('올바른 파일 URL이 아닙니다.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http 또는 https URL만 지원합니다.');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!response.ok) throw new Error(`파일 다운로드 실패 (${response.status})`);
  const length = Number(response.headers.get('content-length')) || 0;
  if (length > MAX_ATTACHMENT_BYTES) throw new Error('파일은 20MB 이하만 전송할 수 있습니다.');
  const bytes = Buffer.from(await response.arrayBuffer());
  const disposition = response.headers.get('content-disposition') || '';
  const headerName = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1];
  const urlName = decodeURIComponent(url.pathname.split('/').pop() || '');
  return saveAttachment(bytes, name || headerName || urlName || 'download');
}

async function createAttachment(body) {
  if (typeof body?.url === 'string' && body.url.trim()) {
    return downloadAttachment(body.url.trim(), body?.name);
  }
  if (typeof body?.data === 'string' && body.data.trim()) {
    return saveAttachment(decodeAttachmentData(body.data), body?.name);
  }
  throw new Error('파일 데이터 또는 URL이 필요합니다.');
}

async function sendTerminalMessage(body) {
  const handle = typeof body?.handle === 'string' ? body.handle.trim() : '';
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const focusComposer = body?.focus !== false;
  const waitForSubmit = body?.waitSubmit !== false;
  if (!/^term_[a-zA-Z0-9-]+$/.test(handle)) {
    throw new Error('메시지를 보낼 터미널 핸들이 올바르지 않습니다.');
  }
  if (!text) throw new Error('보낼 메시지를 입력해 주세요.');
  if (text.length > 2_000) throw new Error('메시지는 2,000자 이하로 입력해 주세요.');
  // Freebuff's TUI can keep its draft even when the PTY receives Enter. A
  // mouse event restores the composer focus; without it text goes into the
  // draft but the agent never starts a turn. Plain shell terminals must not
  // receive mouse escape bytes.
  if (focusComposer) {
    await runOrca(
      [
        'terminal',
        'send',
        '--terminal',
        handle,
        '--text',
        '\u001b[<0;20;24M\u001b[<0;20;24m',
        '--json',
      ],
      10_000,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  }

  const args = ['terminal', 'send', '--terminal', handle, '--text', text, '--enter'];
  if (waitForSubmit) args.push('--wait-submit', '8');
  args.push('--json');
  const result = await runOrca(args, 30_000);
  return { ok: true, handle, result };
}

async function sendTerminalKey(body) {
  const handle = typeof body?.handle === 'string' ? body.handle.trim() : '';
  const key = typeof body?.key === 'string' ? body.key.trim() : '';
  const keys = {
    up: '\u001b[A',
    down: '\u001b[B',
    left: '\u001b[D',
    right: '\u001b[C',
    enter: '\r',
    escape: '\u001b',
    tab: '\t',
  };
  const text = keys[key];
  if (!/^term_[a-zA-Z0-9-]+$/.test(handle)) {
    throw new Error('키를 보낼 터미널 핸들이 올바르지 않습니다.');
  }
  if (!text) throw new Error('지원하지 않는 키입니다.');
  await runOrca(['terminal', 'send', '--terminal', handle, '--text', text, '--json'], 15_000);
  return { ok: true, handle, key };
}

async function interruptTerminal(body) {
  const handle = typeof body?.handle === 'string' ? body.handle.trim() : '';
  if (!/^term_[a-zA-Z0-9-]+$/.test(handle)) {
    throw new Error('중단할 터미널 핸들이 올바르지 않습니다.');
  }
  await runOrca(['terminal', 'send', '--terminal', handle, '--text', '\u0003', '--json'], 20_000);
  return { ok: true, handle };
}

async function createWorktreeTerminal(body) {
  const worktree = await resolveWorktreePath(body?.path);
  const requestedTitle = typeof body?.title === 'string' ? body.title.trim().slice(0, 80) : '';
  const title = requestedTitle || `Shell · ${worktree.displayName || 'worktree'}`;
  const result = await runOrca(
    [
      'terminal',
      'create',
      '--worktree',
      `path:${worktree.path}`,
      '--title',
      title,
      '--json',
    ],
    120_000,
  );
  const terminal = result?.terminal || result;
  const handle = terminal?.handle || result?.handle || '';
  if (!/^term_[a-zA-Z0-9-]+$/.test(handle)) {
    throw new Error('터미널을 만들었지만 핸들을 확인하지 못했습니다.');
  }
  invalidateOverview();
  return {
    ok: true,
    handle,
    title,
    path: worktree.path,
    terminal,
    overview: await getOverview(true),
  };
}

async function closeTerminal(body) {
  const handle = typeof body?.handle === 'string' ? body.handle.trim() : '';
  if (!/^term_[a-zA-Z0-9-]+$/.test(handle)) {
    throw new Error('종료할 터미널 핸들이 올바르지 않습니다.');
  }
  await runOrca(['terminal', 'close', '--terminal', handle, '--json'], 30_000);
  invalidateOverview();
  return { ok: true, handle, overview: await getOverview(true) };
}

async function continueFreebuff(body) {
  const worktree = await resolveWorktreePath(body?.path);
  const previousHandle = typeof body?.handle === 'string' ? body.handle.trim() : '';
  const requestedChat = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  let warning = null;
  let chatId = '';

  // Passing no id lets Freebuff pick a recent conversation globally, which can
  // open the wrong worktree's chat (or start fresh). Pin the requested chat to
  // this worktree before opening `--continue`.
  if (requestedChat) {
    chatId = findFreebuffChat(freebuffProjectDirForPath(worktree.path), requestedChat).chatId;
  }

  // A dead Freebuff terminal often cannot be closed cleanly. Continue anyway:
  // the important half is opening `--continue` in the same worktree.
  if (/^term_[a-zA-Z0-9-]+$/.test(previousHandle)) {
    try {
      await runOrca(['terminal', 'close', '--terminal', previousHandle, '--json'], 30_000);
      invalidateOverview();
    } catch (error) {
      warning = `이전 터미널 종료 경고: ${errorMessage(error)}`;
    }
  }

  const title = `Freebuff continue · ${worktree.displayName || 'worktree'}`;
  const command = chatId ? `freebuff --continue ${chatId}` : 'freebuff --continue';
  const result = await runOrca(
    [
      'terminal',
      'create',
      '--worktree',
      `path:${worktree.path}`,
      '--title',
      title,
      '--command',
      command,
      '--json',
    ],
    120_000,
  );
  const terminal = result?.terminal || result;
  const handle = terminal?.handle || result?.handle || '';
  if (!/^term_[a-zA-Z0-9-]+$/.test(handle)) {
    throw new Error('이어서 열 터미널의 핸들을 확인하지 못했습니다.');
  }
  invalidateOverview();
  return {
    ok: true,
    handle,
    previousHandle: previousHandle || null,
    chatId: chatId || null,
    title,
    path: worktree.path,
    warning,
    terminal,
    overview: await getOverview(true),
  };
}

function readFreebuffCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
    const account = parsed?.default;
    if (!account?.authToken) return null;
    return {
      token: account.authToken,
      fingerprintId: account.fingerprintId || 'cli-usage',
    };
  } catch {
    return null;
  }
}

async function fetchJson(url, init, timeout = 15_000) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 300);
  }
  return { response, body };
}

async function buildUsage() {
  const credentials = readFreebuffCredentials();
  if (!credentials) {
    return {
      ok: false,
      configured: false,
      error: 'Freebuff CLI 로그인을 찾지 못했습니다. 터미널에서 freebuff login을 실행해 주세요.',
      fetchedAt: new Date().toISOString(),
    };
  }

  const headers = {
    Authorization: `Bearer ${credentials.token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'agent-web-desk/0.1',
  };

  const [subscriptionResult, usageResult] = await Promise.all([
    fetchJson(`${FREEBUFF_BASE}/api/user/subscription`, {
      method: 'GET',
      headers,
    }).catch((error) => ({ response: null, body: null, error })),
    fetchJson(`${FREEBUFF_BASE}/api/v1/usage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fingerprintId: credentials.fingerprintId }),
    }).catch((error) => ({ response: null, body: null, error })),
  ]);

  if (!usageResult.response?.ok) {
    const detail =
      usageResult.body?.error ||
      usageResult.error?.message ||
      `Freebuff 사용량 응답 ${usageResult.response?.status || '없음'}`;
    return {
      ok: false,
      configured: true,
      error: String(detail),
      fetchedAt: new Date().toISOString(),
    };
  }

  const subscription = subscriptionResult.response?.ok ? subscriptionResult.body : null;
  const usage = usageResult.body || {};
  return {
    ok: true,
    configured: true,
    plan: subscription?.hasSubscription ? 'paid' : 'free',
    hasSubscription: Boolean(subscription?.hasSubscription),
    fallbackToALaCarte: Boolean(subscription?.fallbackToALaCarte),
    apiCredits: {
      remaining: Number(usage.remainingBalance) || 0,
      usage: Number(usage.usage) || 0,
      breakdown: usage.balanceBreakdown || {},
      nextResetAt: usage.next_quota_reset || null,
      autoTopupEnabled: Boolean(usage.autoTopupEnabled),
    },
    planHoursAvailable: false,
    note:
      'Freebuff의 일일·5일·월간 시간 한도는 CLI 공개 API가 제공하지 않습니다. 여기서는 실제 API 크레딧과 플랜 상태만 표시합니다.',
    fetchedAt: new Date().toISOString(),
  };
}

async function getUsage(force = false) {
  const now = Date.now();
  if (!force && usageCache && now - usageCacheAt < 60_000) return usageCache;
  if (usageInflight) return usageInflight;

  usageInflight = buildUsage()
    .then((usage) => {
      usageCache = usage;
      usageCacheAt = Date.now();
      return usage;
    })
    .finally(() => {
      usageInflight = null;
    });

  return usageInflight;
}

function makeSlug(prompt, index) {
  const ascii = String(prompt || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('-')
    .toLowerCase();
  const stamp = Date.now().toString(36).slice(-5);
  return `${(ascii || 'parallel').slice(0, 22)}-${stamp}-${index + 1}`;
}

function launchHandle(result) {
  const launch = result?.launch || result?.agentLaunch || result || {};
  return (
    launch?.outcome?.handle ||
    launch?.handle ||
    result?.agentTerminalHandle ||
    result?.terminalHandle ||
    null
  );
}

function launchWorktreeId(result) {
  return (
    result?.worktree?.worktreeId ||
    result?.worktree?.id ||
    result?.worktreeId ||
    null
  );
}

function launchWorktreePath(result) {
  return (
    result?.worktree?.path ||
    result?.result?.worktree?.path ||
    result?.worktreePath ||
    null
  );
}

function launchKind(result) {
  const launch = result?.launch || result?.agentLaunch || result || {};
  return launch?.outcome?.kind || launch?.kind || result?.kind || null;
}

function launchSessionId(result) {
  const launch = result?.launch || result?.agentLaunch || result || {};
  const direct =
    launch?.outcome?.orcaSessionId ||
    launch?.outcome?.sessionId ||
    launch?.orcaSessionId ||
    launch?.sessionId ||
    result?.orcaSessionId ||
    result?.sessionId ||
    null;
  if (direct) return direct;
  // A chat launch may expose its structured-session handle instead of an id.
  const handle = launch?.outcome?.handle || launch?.handle;
  const chatLaunch =
    String(launch?.outcome?.kind || launch?.kind || '')
      .toLowerCase()
      .includes('chat') || launch?.outcome?.surface === 'chat';
  if (chatLaunch && typeof handle === 'string') {
    return handle.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0] || null;
  }
  return null;
}

function launchSurface(agent) {
  // Agy's native Orca surface is a chat. Terminal surface is what made a
  // parallel Agy launch show up as a raw CLI and kept its transcript empty.
  return agent === 'antigravity' ? 'chat' : 'terminal';
}

function cleanModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  if (model.length > 120) throw new Error('모델 ID가 너무 깁니다.');
  return model;
}

async function launchOne({ worktree, agent, prompt, isolate, model, index, role }) {
  const promptArgs = prompt ? ['--prompt', prompt] : [];
  const surface = launchSurface(agent);
  const repoSelector = worktree.repoId ? `id:${worktree.repoId}` : `path:${worktree.path}`;
  const createArgs = [
    'worktree',
    'create',
    '--name',
    makeSlug(prompt, index),
    '--repo',
    repoSelector,
    '--setup',
    'skip',
    '--no-parent',
  ];

  // OpenCode rejects --model while creating a brand-new worktree. Create the
  // checkout first, then launch the agent in that existing worktree with the
  // requested model. Other agents can still use the one-step path.
  if (isolate && model && agent === 'opencode') {
    const createResult = await runOrca([...createArgs, '--json'], 120_000);
    const createdPath = launchWorktreePath(createResult);
    if (!createdPath) {
      throw new Error('새 워크트리는 만들었지만 경로를 확인하지 못해 모델을 적용한 에이전트를 시작하지 못했습니다.');
    }
    const launchResult = await runOrca(
      [
        'agent',
        'launch',
        '--agent',
        agent,
        '--worktree',
        `path:${createdPath}`,
        ...promptArgs,
        '--surface',
        surface,
        '--model',
        model,
        '--json',
      ],
      120_000,
    );
    return {
      ok: true,
      index,
      role,
      agent,
      path: createdPath,
      isolate,
      handle: launchHandle(launchResult),
      sessionId: launchSessionId(launchResult),
      kind: launchKind(launchResult),
      surface,
      worktreeId: launchWorktreeId(createResult) || launchWorktreeId(launchResult),
      result: { create: createResult, launch: launchResult },
    };
  }

  const args = isolate
    ? [...createArgs, '--agent', agent, ...promptArgs, '--surface', surface]
    : [
        'agent',
        'launch',
        '--agent',
        agent,
        '--worktree',
        `path:${worktree.path}`,
        ...promptArgs,
        '--surface',
        surface,
      ];
  if (model) args.push('--model', model);
  args.push('--json');

  const result = await runOrca(args, 120_000);
  return {
    ok: true,
    index,
    role,
    agent,
    path: worktree.path,
    isolate,
    handle: launchHandle(result),
    sessionId: launchSessionId(result),
    kind: launchKind(result),
    surface,
    worktreeId: launchWorktreeId(result) || (isolate ? null : worktree.id),
    result,
  };
}

async function launchAgents(body) {
  const path = typeof body?.path === 'string' ? body.path.trim() : '';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const requestedAgent = typeof body?.agent === 'string' ? body.agent : 'freebuff';
  const allowedAgents = new Set(['freebuff', 'opencode', 'antigravity', 'gemini', 'claude', 'codex']);
  const agent = allowedAgents.has(requestedAgent) ? requestedAgent : 'freebuff';
  const blank = Boolean(body?.blank);
  const count = blank ? 1 : Math.max(1, Math.min(6, Number(body?.count) || 1));
  const isolate = body?.isolate !== false;
  const team = blank ? false : body?.team !== false;
  const workerModel = cleanModel(body?.workerModel);
  const coordinatorModel = cleanModel(body?.coordinatorModel);

  if (!path) throw new Error('작업할 워크트리를 선택해 주세요.');
  if (!prompt && !blank) throw new Error('에이전트에 보낼 작업을 입력해 주세요.');
  if (prompt.length > 4000) throw new Error('작업은 4,000자 이하로 입력해 주세요.');

  const overview = await getOverview(true);
  const worktree = overview.worktrees.find((item) => item.path === path);
  if (!worktree) {
    throw new Error('선택한 워크트리를 Orca에서 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.');
  }

  // In team mode the app opens only one coordinator session. The worker
  // headcount is passed in the coordinator prompt; the coordinator opens and
  // manages any worker sessions it actually needs.
  const workerPrompt = blank ? '' : agentPrompt(prompt);
  const workerLaunches = team ? 0 : count;
  const launches = [];
  for (let index = 0; index < workerLaunches; index += 1) {
    try {
      launches.push(
        await launchOne({
          worktree,
          agent,
          prompt: workerPrompt,
          isolate,
          model: workerModel,
          index,
          role: 'worker',
        }),
      );
    } catch (error) {
      launches.push({
        ok: false,
        index,
        role: 'worker',
        agent,
        path: worktree.path,
        isolate,
        error: errorMessage(error),
      });
    }

    if (index < count - 1) {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 350));
    }
  }

  let coordinator = null;
  if (team) {
    const workerSurface = launchSurface(agent);
    const workerTarget =
      workerSurface === 'chat' ? 'orca_session_id:<세션 ID>' : '<terminal handle>';
    const coordinatorPrompt = `[코디네이터 역할]\n${COMMON_RULES}\n\n너는 이 팀의 코디네이터다. 앱은 워커 세션을 미리 열지 않았다. 워커 정원은 ${count}명이다. 작업을 ${count}명이 나눠 맡을 수 있는 범위로 설계하고, 각 범위의 담당·완료 조건·검증 방법을 정한 뒤 실행과 취합을 지휘해.\n워커 세션이 필요하면 현재 워크트리에서 \`orca agent launch --agent ${agent} --worktree path:$(pwd) --prompt \"...\" --surface ${workerSurface} --json\`로 직접 띄워. ${workerSurface === 'chat' ? '채팅 세션이면 `orca agent list --worktree path:$(pwd) --json`에서 그 세션의 orcaSessionId를 확인해 `orca_session_id:<id>` 형식으로' : '터미널 세션이면 반환된 terminal handle을'} \`orca orchestration send --to ${workerTarget} --subject \"...\" --body \"...\" --type status --json\`의 대상으로 넣어 지휘해. 워커를 띄울 때는 프롬프트 첫 줄에 반드시 [워커 역할] 표식을 넣어. 직접 파일을 수정하기보다 분배·검증·취합에 집중해.\n\n[전체 작업]\n${prompt}`;
    try {
      coordinator = await launchOne({
        worktree,
        agent,
        prompt: coordinatorPrompt,
        isolate,
        model: coordinatorModel,
        index: 0,
        role: 'coordinator',
      });
    } catch (error) {
      coordinator = {
        ok: false,
        index: 0,
        role: 'coordinator',
        agent,
        path: worktree.path,
        isolate,
        error: errorMessage(error),
      };
    }
  }

  invalidateOverview();
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 700));
  let refreshed = null;
  try {
    refreshed = await getOverview(true);
  } catch {
    // The launches still succeeded; the UI can retry the overview.
  }

  return {
    ok: launches.some((launch) => launch.ok) || Boolean(coordinator?.ok),
    launches,
    coordinator,
    team,
    overview: refreshed,
  };
}

async function removeWorktree(body) {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) throw new Error('삭제할 워크트리를 선택해 주세요.');
  await runOrca(
    ['worktree', 'rm', '--worktree', `id:${id}`, '--force', '--json'],
    60_000,
  );
  invalidateOverview();
  return { ok: true, overview: await getOverview(true) };
}

async function hideProject(body) {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) throw new Error('숨길 프로젝트를 선택해 주세요.');
  await runOrca(['repo', 'hide', '--repo', `id:${id}`, '--json'], 30_000);
  invalidateOverview();
  return { ok: true, overview: await getOverview(true) };
}

async function addProject(body) {
  const rawPath = typeof body?.path === 'string' ? body.path.trim() : '';
  if (!rawPath) throw new Error('프로젝트 경로를 입력해 주세요.');
  if (!isAbsolute(rawPath)) throw new Error('절대 경로를 입력해 주세요.');
  if (rawPath.length > 512) throw new Error('경로가 너무 깁니다.');

  const path = resolve(rawPath);
  if (path === '/' || path === resolve(homedir())) {
    throw new Error('홈 디렉터리나 루트 전체는 프로젝트로 추가할 수 없습니다.');
  }
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error('그 경로에 폴더가 없습니다.');
  }

  const kind = existsSync(join(path, '.git')) ? 'git' : 'folder';
  const result = await runOrca(['repo', 'add', '--path', path, '--kind', kind, '--json']);
  invalidateOverview();
  return {
    ok: true,
    path,
    kind,
    result,
    overview: await getOverview(true),
  };
}

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'GET' && path === '/health') {
    json(res, 200, {
      ok: true,
      host: hostname(),
      orca: true,
      freebuffConfigured: Boolean(readFreebuffCredentials()),
      cwd: process.cwd(),
    });
    return;
  }

  if (method === 'GET' && path === '/overview') {
    try {
      json(res, 200, await getOverview(url.searchParams.get('refresh') === '1'));
    } catch (error) {
      json(res, 502, { ok: false, error: errorMessage(error), projects: [], worktrees: [], agents: [] });
    }
    return;
  }

  if (method === 'GET' && path === '/usage') {
    try {
      json(res, 200, await getUsage(url.searchParams.get('refresh') === '1'));
    } catch (error) {
      json(res, 200, {
        ok: false,
        configured: Boolean(readFreebuffCredentials()),
        error: errorMessage(error),
        fetchedAt: new Date().toISOString(),
      });
    }
    return;
  }

  if (method === 'GET' && path === '/messages') {
    try {
      json(res, 200, await messagePayload());
    } catch (error) {
      json(res, 502, { ok: false, messages: [], error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/messages') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await sendDeskMessage(body));
    } catch (error) {
      json(res, 400, { ok: false, messages: [], error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/github/commit') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await commitAndPush(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'GET' && path === '/github') {
    try {
      const worktree = await resolveWorktreePath(url.searchParams.get('path'));
      json(res, 200, await githubInfo(worktree));
    } catch (error) {
      json(res, 502, { ok: false, connected: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/github/run') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const worktree = await resolveWorktreePath(body.path);
      const workflowId = String(body.workflowId || '').trim();
      const ref = String(body.ref || worktree.branch || '').trim();
      if (!workflowId) throw new Error('실행할 워크플로를 선택해 주세요.');
      if (!ref) throw new Error('실행할 브랜치를 찾지 못했습니다.');
      await runCommand('gh', ['workflow', 'run', workflowId, '--ref', ref], {
        cwd: worktree.path,
        timeout: 30_000,
      });
      json(res, 200, {
        ok: true,
        workflowId,
        ref,
        message: `${ref} 브랜치에서 워크플로를 시작했습니다.`,
      });
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'GET' && path === '/instructions') {
    try {
      const worktree = await resolveWorktreePath(url.searchParams.get('path'));
      json(res, 200, readInstructions(worktree));
    } catch (error) {
      json(res, 404, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'PUT' && path === '/instructions') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const worktree = await resolveWorktreePath(body.path);
      json(res, 200, writeInstructions(worktree, body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'GET' && path === '/memory') {
    try {
      const worktree = await resolveWorktreePath(url.searchParams.get('path'));
      json(res, 200, await memoryInfo(worktree));
    } catch (error) {
      json(res, 502, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/memory/sync') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const worktree = await resolveWorktreePath(body.path);
      json(res, 200, await syncMemory(worktree));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'GET' && path === '/terminal') {
    try {
      const handle = url.searchParams.get('handle') || '';
      const snapshot = await readTerminal(handle, {
        cursor: url.searchParams.get('cursor'),
        limit: url.searchParams.get('limit'),
        screen: url.searchParams.get('screen') !== '0',
      });
      json(res, 200, snapshot);
    } catch (error) {
      json(res, 502, { ok: false, error: errorMessage(error), tail: [] });
    }
    return;
  }

  if (method === 'GET' && path === '/freebuff/session') {
    try {
      if (url.searchParams.get('kind') === 'opencode') {
        json(res, 200, await readOpencodeSession(url.searchParams.get('path') || ''));
        return;
      }
      json(
        res,
        200,
        await readFreebuffSession(
          url.searchParams.get('path') || '',
          url.searchParams.get('chat') || '',
        ),
      );
    } catch (error) {
      json(res, 200, {
        ok: false,
        entries: [],
        error: errorMessage(error),
        fetchedAt: new Date().toISOString(),
      });
    }
    return;
  }

  if (method === 'GET' && path === '/transcript') {
    try {
      json(res, 200, await readTranscript(url.searchParams.get('sessionId')));
    } catch (error) {
      json(res, 502, { ok: false, entries: [], error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/attachment') {
    try {
      const body = JSON.parse((await readBody(req, MAX_ATTACHMENT_BODY)) || '{}');
      json(res, 200, await createAttachment(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/terminal/key') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await sendTerminalKey(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }
  if (method === 'POST' && path === '/terminal/send') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await sendTerminalMessage(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/interrupt') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await interruptTerminal(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/terminal/close') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await closeTerminal(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/projects') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await addProject(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/projects/hide') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await hideProject(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'DELETE' && path === '/worktrees') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await removeWorktree(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/terminal/create') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await createWorktreeTerminal(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/freebuff/continue') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await continueFreebuff(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error) });
    }
    return;
  }

  if (method === 'POST' && path === '/launch') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      json(res, 200, await launchAgents(body));
    } catch (error) {
      json(res, 400, { ok: false, error: errorMessage(error), launches: [] });
    }
    return;
  }

  json(res, 404, { ok: false, error: '알 수 없는 Orca 브리지 경로입니다.' });
}

const server = createServer((req, res) => {
  void route(req, res).catch((error) => {
    if (!res.headersSent) json(res, 500, { ok: false, error: errorMessage(error) });
    else res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`  Orca desk bridge: http://127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
