/**
 * Agy ACP -> local HTTP bridge.
 *
 * The web client speaks a small subset of the OpenCode server API. This process
 * keeps one `agy acp` child alive and translates that local API to ACP JSON-RPC.
 * It deliberately listens on loopback only; the Vite/serve process owns access
 * control and forwards /agy-api here.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extraPathDirs = [
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.config', 'orca', 'cli', 'bin'),
].filter((dir) => existsSync(dir));
if (extraPathDirs.length) {
  process.env.PATH = [...extraPathDirs, process.env.PATH || ''].filter(Boolean).join(':');
}

const ROOT = resolve(
  process.env.AGENT_WEB_WORKDIR || dirname(dirname(fileURLToPath(import.meta.url))),
);
const PORT = Number(process.env.AGY_BRIDGE_PORT || 4098);
const AGY_BIN =
  process.env.AGY_BIN ||
  [
    join(homedir(), '.npm-global', 'bin', 'agy'),
    join(homedir(), '.local', 'bin', 'agy'),
  ].find((candidate) => existsSync(candidate)) ||
  'agy';
const STATE_DIR = join(ROOT, '.agent-web');
const STATE_FILE = join(STATE_DIR, 'agy-state.json');
const MAX_BODY = 24 * 1024 * 1024;
const DEBUG = process.env.AGY_BRIDGE_DEBUG === '1';

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const now = () => Date.now();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const sseClients = new Set();
let sequence = 0;

function log(...args) {
  if (DEBUG) console.error('[agy-bridge]', ...args);
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function send(res, status, body) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.statusCode = status;
  if (data) res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(data);
}

function sendError(res, status, message) {
  send(res, status, { error: { message } });
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('요청 본문이 너무 커요'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolvePromise(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('JSON 요청을 읽지 못했어요'));
      }
    });
    req.on('error', reject);
  });
}

async function readJsonFile(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(await readFile(file, 'utf8')) };
  } catch {
    return fallback;
  }
}

async function loadState() {
  await mkdir(STATE_DIR, { recursive: true });
  const state = await readJsonFile(STATE_FILE, { hidden: [], titles: {}, created: {} });
  state.hidden = Array.isArray(state.hidden) ? state.hidden : [];
  state.titles = state.titles && typeof state.titles === 'object' ? state.titles : {};
  state.created = state.created && typeof state.created === 'object' ? state.created : {};
  return state;
}

let persisted = { hidden: [], titles: {}, created: {} };
let saveTimer;

function saveStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void writeFile(STATE_FILE, JSON.stringify(persisted, null, 2)).catch((error) =>
      log('state save failed', error.message),
    );
  }, 120);
}

function isHidden(id) {
  return persisted.hidden.includes(id);
}

function hideSession(id) {
  if (!persisted.hidden.includes(id)) persisted.hidden.push(id);
  saveStateSoon();
}

function titleFor(id, fallback) {
  return persisted.titles[id] || fallback;
}

function makeId(prefix) {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${sequence.toString(36)}`;
}

/* ── ACP client ───────────────────────────────────────────── */

class AcpClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.stderr = '';
    this.nextRequestId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.notificationListener = null;
    this.readyPromise = null;
    this.agentInfo = null;
    this.authMethods = [];
    this.stopping = false;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.boot().catch((error) => {
      this.readyPromise = null;
      throw error;
    });
    return this.readyPromise;
  }

  async boot() {
    this.stopping = false;
    this.child = spawn(AGY_BIN, ['acp'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${dirname(AGY_BIN)}:${process.env.PATH || ''}` },
    });

    this.child.on('error', (error) => this.failAll(error));
    this.child.on('exit', (code, signal) => {
      this.failAll(new Error(`Agy ACP가 종료됐어요 (${signal || code || 'unknown'})`));
      this.child = null;
      this.readyPromise = null;
    });
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      this.stderr = `${this.stderr}${text}`.slice(-12000);
      if (DEBUG) process.stderr.write(`[agy] ${text}`);
    });
    this.child.stdout.on('data', (chunk) => this.onStdout(chunk));

    const result = await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
        clientInfo: { name: 'agent-studio', version: '0.3.0' },
      },
      20000,
    );
    this.agentInfo = result?.agentInfo || { name: 'Agy', version: 'unknown' };
    this.authMethods = Array.isArray(result?.authMethods) ? result.authMethods : [];
    log('initialized', this.agentInfo.name, this.agentInfo.version);
    return result;
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    for (const request of this.serverRequests.values()) {
      if (request.timeout) clearTimeout(request.timeout);
    }
    this.serverRequests.clear();
  }

  onStdout(chunk) {
    this.buffer += chunk.toString();
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log('non-json stdout', line.slice(0, 200));
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.id !== undefined && message.method) {
      void this.handleServerRequest(message);
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      if (message.method === 'session/update') this.notificationListener?.(message.params);
    }
  }

  async handleServerRequest(message) {
    const { id, method, params } = message;
    if (method === 'session/request_permission') {
      const permissionId = `agy_${id}`;
      const sessionId = params?.sessionId || '';
      const toolCall = params?.toolCall || {};
      const options = Array.isArray(params?.options) ? params.options : [];
      const rawInput = toolCall.rawInput || {};
      const metadata = {
        command:
          typeof rawInput.CommandLine === 'string'
            ? rawInput.CommandLine
            : typeof rawInput.command === 'string'
              ? rawInput.command
              : undefined,
        description: toolCall.title || toolCall.kind || undefined,
        path:
          typeof rawInput.AbsolutePath === 'string'
            ? rawInput.AbsolutePath
            : typeof rawInput.path === 'string'
              ? rawInput.path
              : undefined,
      };
      const permission = {
        id: permissionId,
        sessionID: sessionId,
        title: toolCall.title || toolCall.kind || '도구 실행 승인',
        metadata,
        time: { created: now() },
      };
      this.serverRequests.set(permissionId, {
        rpcId: id,
        sessionId,
        options,
        permission,
      });
      broadcast({ type: 'permission.updated', properties: permission });
      return;
    }

    let result = {};
    try {
      if (method === 'fs/read_text_file') {
        const target = this.safePath(params?.path);
        const content = await readFile(target, 'utf8');
        const lines = content.split(/\r?\n/);
        const start = Math.max(0, Number(params?.line || 1) - 1);
        const limit = params?.limit ? Math.max(1, Number(params.limit)) : lines.length;
        result = { content: lines.slice(start, start + limit).join('\n') };
      } else if (method === 'fs/write_text_file') {
        const target = this.safePath(params?.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, String(params?.content ?? ''), 'utf8');
        result = {};
      } else {
        this.reply(id, undefined, { code: -32601, message: `지원하지 않는 ACP 요청: ${method}` });
        return;
      }
    } catch (error) {
      this.reply(id, undefined, { code: -32000, message: error.message });
      return;
    }
    this.reply(id, result);
  }

  safePath(input) {
    if (typeof input !== 'string' || !input) throw new Error('경로가 비어 있어요');
    const target = isAbsolute(input) ? resolve(input) : resolve(ROOT, input);
    const rel = relative(ROOT, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('워크스페이스 밖 경로에는 접근할 수 없어요');
    }
    return target;
  }

  reply(id, result, error) {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(
      `${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`,
    );
  }

  request(method, params, timeoutMs = 0) {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error('Agy ACP가 연결되지 않았어요'));
    }
    const id = this.nextRequestId++;
    const message = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolvePromise, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Agy 응답 시간이 초과됐어요 (${method})`));
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params) {
    if (!this.child?.stdin.writable) return false;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    return true;
  }

  async respondPermission(permissionId, response) {
    const request = this.serverRequests.get(permissionId);
    if (!request) throw new Error('이미 처리된 권한 요청이에요');
    this.serverRequests.delete(permissionId);
    const options = request.options;
    const preferredKinds =
      response === 'reject'
        ? ['reject_once', 'reject_always', 'deny']
        : response === 'always'
          ? ['allow_always', 'allow_once', 'allow']
          : ['allow_once', 'allow_always', 'allow'];
    let picked = null;
    for (const kind of preferredKinds) {
      picked = options.find((option) => String(option.kind || '').toLowerCase() === kind);
      if (picked) break;
    }
    if (!picked) {
      picked = options.find((option) =>
        response === 'reject'
          ? /reject|deny|no/i.test(`${option.optionId} ${option.name}`)
          : /allow|approve|yes/i.test(`${option.optionId} ${option.name}`),
      );
    }
    if (response === 'reject' && !picked) {
      this.reply(request.rpcId, { outcome: { outcome: 'cancelled' } });
    } else if (picked) {
      this.reply(request.rpcId, {
        outcome: { outcome: 'selected', optionId: picked.optionId },
      });
    } else {
      this.reply(request.rpcId, { outcome: { outcome: 'cancelled' } });
    }
    broadcast({
      type: 'permission.replied',
      properties: { sessionID: request.sessionId, permissionID: permissionId },
    });
  }

  async stop() {
    this.stopping = true;
    for (const request of this.serverRequests.values()) {
      this.reply(request.rpcId, { outcome: { outcome: 'cancelled' } });
    }
    this.serverRequests.clear();
    if (this.child) {
      this.child.kill('SIGTERM');
      await sleep(250);
      if (this.child) this.child.kill('SIGKILL');
    }
  }
}

const acp = new AcpClient();

/* ── model catalog ────────────────────────────────────────── */

const FALLBACK_MODELS = `gemini-4-neon-high\tGemini 4 Neon (High)
gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)
gemini-4-neon-medium\tGemini 4 Neon (Medium)
gemini-4-neon-low\tGemini 4 Neon (Low)
gemini-4-carbon-medium\tGemini 4 Carbon (Medium)
gemini-4-carbon-high\tGemini 4 Carbon (High)
gemini-4-carbon-low\tGemini 4 Carbon (Low)
gemini-4-argon-medium\tGemini 4 Argon (Medium)
gemini-4-argon-high\tGemini 4 Argon (High)
gemini-4-argon-low\tGemini 4 Argon (Low)
gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)
gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)
gemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)
gemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)
gemini-pro-orchestrator-neon\tOrchestrator (Neon)
gemini-pro-orchestrator\tOrchestrator (Carbon)
gemini-pro-orchestrator-argon\tOrchestrator (Argon)
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
claude-opus-5-5-low\tClaude Opus 5.5 (Low)
claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)
claude-opus-5-5-high\tClaude Opus 5.5 (High)
claude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)
claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)
claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)`;

let catalogPromise = null;
let catalog = { models: {}, byID: new Map(), defaultModel: 'gemini-4-neon' };

function runShort(command, args, timeout = 15000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} 시간 초과`));
    }, timeout);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

async function loadCatalog(forceRefresh = false) {
  if (forceRefresh) catalogPromise = null;
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    let text = FALLBACK_MODELS;
    try {
      const { stdout } = await runShort(AGY_BIN, ['models'], 25000);
      const parsedLines = stdout
        .split(/\r?\n/)
        .map((line) => line.replace(/.*\r/, '').trim())
        .map((line) => line.match(/^([^\s]+)(?:\t|\s{2,})(.+)$/))
        .filter(Boolean)
        .map((m) => `${m[1].trim()}\t${m[2].trim()}`);
      if (parsedLines.length) text = parsedLines.join('\n');
    } catch (error) {
      log('model list fallback', error.message);
    }

    const groups = new Map();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const tab = line.indexOf('\t');
      if (tab < 1) continue;
      const rawID = line.slice(0, tab).trim();
      const display = line.slice(tab + 1).trim();
      if (!rawID) continue;
      const levelMatch = display.match(/\((Low|Medium|High|XHigh|Extra)\)\s*$/i);
      const level = levelMatch
        ? levelMatch[1].toLowerCase().replace('extra', 'xhigh')
        : '';
      const baseID = rawID.replace(/-(low|medium|high|xhigh)$/i, '');
      const baseName = levelMatch
        ? display.replace(/\s*\([^)]*\)\s*$/, '').trim()
        : display;
      if (!groups.has(baseID)) {
        groups.set(baseID, { baseID, baseName, levels: [], rawIDs: {} });
      }
      const group = groups.get(baseID);
      group.rawIDs[level || 'default'] = rawID;
      if (level) group.levels.push(level);
    }

    const models = {};
    const byID = new Map();
    for (const group of groups.values()) {
      const multi = group.levels.length > 1;
      const id = multi ? group.baseID : group.rawIDs.default || group.baseID;
      const variants = {};
      if (multi) {
        for (const level of ['low', 'medium', 'high', 'xhigh']) {
          if (group.levels.includes(level)) variants[level] = {};
        }
      }
      models[id] = {
        id,
        providerID: 'agy',
        name: group.baseName,
        family: 'agy',
        api: {
          id: multi ? group.baseID : id,
          npm: '@agy/model',
          url: '',
          env: [],
        },
        capabilities: {
          temperature: false,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, image: false, audio: false, video: false, pdf: false },
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 1048576, output: 65536 },
        status: 'active',
        options: {},
        variants,
      };
      byID.set(id, { id, baseID: multi ? group.baseID : id, variants, levels: group.levels });
    }

    const preferred =
      models['gemini-4-neon'] ? 'gemini-4-neon' : Object.keys(models)[0] || 'gemini-4-neon';
    catalog = { models, byID, defaultModel: preferred };
    log('catalog', Object.keys(models).length, 'models');
    return catalog;
  })();
  return catalogPromise;
}

function providersPayload() {
  return {
    providers: [
      {
        id: 'agy',
        name: 'Agy',
        source: 'custom',
        env: [],
        options: {},
        models: catalog.models,
      },
    ],
    default: { agy: catalog.defaultModel },
  };
}

/* ── session state and ACP update translation ─────────────── */

const runtime = new Map();

// Live prompts and replay loads share the ACP process. Route every session
// update to the collector that currently owns that session.
acp.notificationListener = (params) => {
  const state = params?.sessionId ? runtime.get(params.sessionId) : null;
  if (state?.collector && params?.update) state.collector.handle(params.update);
};

function emptyState(id, cwd = ROOT, title = '새 세션') {
  return {
    id,
    title,
    cwd,
    createdAt: now(),
    updatedAt: now(),
    messages: [],
    todos: [],
    loaded: false,
    busy: false,
    collector: null,
    loadPromise: null,
    configs: [],
    config: {},
    models: {},
    tokenTotal: 0,
  };
}

function serializeSession(state) {
  const created = state.createdAt || state.updatedAt || now();
  const updated = state.updatedAt || created;
  return {
    id: state.id,
    slug: state.id.slice(0, 8),
    projectID: 'agy',
    directory: state.cwd,
    parentID: undefined,
    title: state.title,
    version: 'agy-0.3',
    time: { created, updated },
  };
}

function sessionFor(id, fallback = {}) {
  let state = runtime.get(id);
  if (!state) {
    state = emptyState(id, fallback.cwd || ROOT, fallback.title || 'Agy 세션');
    state.createdAt = fallback.created || fallback.updated || now();
    state.updatedAt = fallback.updated || state.createdAt;
    state.loaded = false;
    runtime.set(id, state);
  }
  return state;
}

function emit(type, properties) {
  broadcast({ type, properties });
}

function touch(state, patch = {}) {
  state.updatedAt = now();
  Object.assign(state, patch);
  emit('session.updated', { info: serializeSession(state) });
}

function setBusy(state, busy) {
  state.busy = busy;
  emit('session.status', {
    sessionID: state.id,
    status: { type: busy ? 'busy' : 'idle' },
  });
  if (!busy) emit('session.idle', { sessionID: state.id });
}

function tokenInfo(usage) {
  const input = Number(usage?.inputTokens || 0);
  const output = Number(usage?.outputTokens || 0);
  const reasoning = Number(usage?.thoughtTokens || 0);
  const cacheRead = Number(usage?.cachedReadTokens || 0);
  const cacheWrite = Number(usage?.cachedWriteTokens || 0);
  return {
    input,
    output,
    reasoning,
    cache: { read: cacheRead, write: cacheWrite },
    total:
      Number(usage?.totalTokens || 0) || input + output + reasoning + cacheRead + cacheWrite,
  };
}

const QUOTA_CACHE_MS = 60_000;

function quotaGroupModels(description) {
  const match = String(description || '').match(/Models within this group:\s*([\s\S]+)/i);
  if (!match) return [];
  return match[1]
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .split(/,\s*/)
    .map((model) => model.trim())
    .filter(Boolean);
}

function normalizeQuotaPayload(payload) {
  if (payload?.status && payload.status !== 'SUCCESS') {
    throw new Error(
      payload?.error?.message || payload?.error || 'Agy가 사용량을 반환하지 않았어요',
    );
  }
  const data = payload?.command?.data;
  if (!data || !Array.isArray(data.groups)) {
    throw new Error('Agy 사용량 응답 형식이 예상과 달라요');
  }
  return {
    ok: true,
    engine: 'agy',
    fetchedAt: new Date().toISOString(),
    groups: data.groups.map((group) => ({
      name: String(group?.name || 'Agy'),
      models: quotaGroupModels(group?.description),
      buckets: (Array.isArray(group?.buckets) ? group.buckets : []).map((bucket) => ({
        id: String(bucket?.id || ''),
        window: String(bucket?.window || ''),
        name: String(bucket?.name || ''),
        remaining: Number.isFinite(Number(bucket?.remaining_fraction))
          ? Math.round(clamp(Number(bucket.remaining_fraction), 0, 1) * 100)
          : null,
        resetAt: bucket?.reset_time ? String(bucket.reset_time) : null,
        disabled: Boolean(bucket?.disabled),
        description: bucket?.description ? String(bucket.description) : '',
      })),
    })),
  };
}

let quotaCache = null;
let quotaInFlight = null;

async function getAgyQuota(force = false) {
  if (!force && quotaCache && now() - quotaCache.at < QUOTA_CACHE_MS) {
    return { ...quotaCache.data, cached: true };
  }
  if (quotaInFlight) return quotaInFlight;

  quotaInFlight = new Promise((resolvePromise, rejectPromise) => {
    let child;
    let finished = false;
    let stdout = '';
    let stderr = '';
    let timer;
    const finish = (error, data) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      quotaInFlight = null;
      if (error) {
        rejectPromise(error);
      } else {
        const isPartial = Array.isArray(data?.groups) && data.groups.length < 2;
        const hadFuller = Array.isArray(quotaCache?.data?.groups) && quotaCache.data.groups.length >= 2;
        if (isPartial && hadFuller) {
          resolvePromise({ ...quotaCache.data, cached: true });
          return;
        }
        if (!isPartial) {
          quotaCache = { at: now(), data };
        }
        resolvePromise({ ...data, cached: false });
      }
    };

    try {
      child = spawn(AGY_BIN, ['--print', '/usage', '--output-format', 'json'], {
        cwd: ROOT,
        env: {
          ...process.env,
          AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(error);
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      finish(new Error('Agy 사용량 응답 시간이 초과됐어요'));
    }, 45_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        finish(new Error('Agy 사용량 응답이 너무 커요'));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error) => {
      finish(new Error(`Agy 사용량을 실행하지 못했어요: ${error.message}`));
    });
    child.on('close', (code) => {
      if (finished) return;
      const text = stdout.trim();
      if (code !== 0 && !text) {
        finish(new Error(stderr.trim() || `Agy 사용량 명령이 종료됐어요 (${code})`));
        return;
      }
      try {
        finish(null, normalizeQuotaPayload(JSON.parse(text)));
      } catch (error) {
        finish(new Error(error.message || 'Agy 사용량을 읽지 못했어요'));
      }
    });
  });

  return quotaInFlight;
}

function partBase(sessionID, messageID, type) {
  return {
    id: makeId(`prt_agy_${type}`),
    sessionID,
    messageID,
    type,
  };
}

function textPart(sessionID, messageID, text) {
  return {
    ...partBase(sessionID, messageID, 'text'),
    text,
    synthetic: false,
    ignored: false,
    time: { start: now() },
  };
}

function filePart(sessionID, messageID, file) {
  return {
    ...partBase(sessionID, messageID, 'file'),
    mime: file.mime || 'application/octet-stream',
    filename: file.filename || '첨부 파일',
    url: file.url,
  };
}

function reasoningPart(sessionID, messageID, text) {
  return {
    ...partBase(sessionID, messageID, 'reasoning'),
    text,
    time: { start: now() },
  };
}

function toolPart(sessionID, messageID, toolCall, previous) {
  const previousInput = previous?.state?.input || {};
  const args = { ...previousInput, ...(toolCall.args || toolCall.rawInput || {}) };
  const command =
    typeof args.CommandLine === 'string'
      ? args.CommandLine
      : typeof args.command === 'string'
        ? args.command
        : typeof previousInput.command === 'string'
          ? previousInput.command
          : undefined;
  const filePath =
    args.AbsolutePath ||
    args.absolutePath ||
    args.filePath ||
    args.path ||
    args.TargetFile ||
    previousInput.filePath ||
    undefined;
  const input = { ...args };
  if (command) input.command = command;
  if (filePath) input.filePath = filePath;

  const normalizedName = String(toolCall.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  const name =
    normalizedName === 'runcommand' || normalizedName === 'shell'
      ? 'bash'
      : /edit|write|patch/.test(normalizedName)
        ? 'edit'
        : /read|view|open/.test(normalizedName)
          ? 'read'
          : /list|glob/.test(normalizedName)
            ? 'list'
            : /grep|search/.test(normalizedName)
              ? 'grep'
              : command
                ? 'bash'
                : previous?.tool || normalizedName || 'tool';

  const status =
    toolCall.status === 'completed'
      ? 'completed'
      : toolCall.status === 'failed' || toolCall.status === 'error'
        ? 'error'
        : toolCall.status === 'in_progress' || toolCall.status === 'pending'
          ? 'running'
          : previous?.state?.status || 'running';
  const output =
    toolCall.rawOutput?.output ||
    toolCall.rawOutput?.error ||
    (Array.isArray(toolCall.content)
      ? toolCall.content
          .map((entry) => entry?.content?.text || entry?.text || '')
          .filter(Boolean)
          .join('\n')
      : '') ||
    (previous?.state?.status === 'completed' ? previous.state.output : '') ||
    '';

  const start = previous?.state?.time?.start || now();
  return {
    ...partBase(sessionID, messageID, 'tool'),
    callID: String(toolCall.toolCallId || previous?.callID || makeId('call')),
    tool: name,
    state:
      status === 'completed'
        ? {
            status,
            input,
            output,
            title: toolCall.title || args.toolSummary || name,
            metadata: {},
            time: { start, end: now() },
          }
        : status === 'error'
          ? {
              status,
              input,
              error: output || '도구 실행에 실패했어요',
              title: toolCall.title || name,
              metadata: {},
              time: { start, end: now() },
            }
          : {
              status: 'running',
              input,
              title: toolCall.title || args.toolSummary || name,
              metadata: {},
              time: { start },
            },
    time: { start, end: status === 'running' ? undefined : now() },
  };
}

class TurnCollector {
  constructor(state, options = {}) {
    this.state = state;
    this.replay = Boolean(options.replay);
    this.messages = options.messages || state.messages;
    this.currentUser = null;
    this.currentAssistant = null;
    this.currentText = null;
    this.currentReasoning = null;
    this.currentTool = null;
    this.titles = new Map();
    this.closed = false;
    this.modelID = options.modelID || '';
  }

  emit(type, properties) {
    if (!this.replay) emit(type, properties);
  }

  pushMessage(message) {
    this.messages.push(message);
    this.emit('message.updated', { info: message.info });
  }

  newUser(text, files = []) {
    const id = makeId('msg_agy_u');
    const info = {
      id,
      sessionID: this.state.id,
      role: 'user',
      time: { created: now() },
      agent: 'agy',
      model: { providerID: 'agy', modelID: this.modelID || catalog.defaultModel },
    };
    const parts = [];
    if (text) {
      const part = textPart(this.state.id, id, text);
      parts.push(part);
    }
    for (const file of files) parts.push(filePart(this.state.id, id, file));
    const message = { info, parts };
    this.currentUser = message;
    this.currentAssistant = null;
    this.currentText = null;
    this.currentReasoning = null;
    this.pushMessage(message);
    for (const part of parts) this.emit('message.part.updated', { part });
  }

  ensureAssistant() {
    if (this.currentAssistant) return this.currentAssistant;
    const id = makeId('msg_agy_a');
    const info = {
      id,
      sessionID: this.state.id,
      role: 'assistant',
      time: { created: now() },
      parentID: this.currentUser?.info.id,
      modelID: this.modelID || catalog.defaultModel,
      providerID: 'agy',
      mode: 'build',
      agent: 'agy',
      path: { cwd: this.state.cwd, root: ROOT },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
        total: 0,
      },
    };
    const message = { info, parts: [] };
    this.currentAssistant = message;
    this.pushMessage(message);
    return message;
  }

  ensureText() {
    if (this.currentText) return this.currentText;
    const assistant = this.ensureAssistant();
    this.currentText = textPart(this.state.id, assistant.info.id, '');
    assistant.parts.push(this.currentText);
    return this.currentText;
  }

  ensureReasoning() {
    if (this.currentReasoning) return this.currentReasoning;
    const assistant = this.ensureAssistant();
    this.currentReasoning = reasoningPart(this.state.id, assistant.info.id, '');
    assistant.parts.push(this.currentReasoning);
    return this.currentReasoning;
  }

  appendText(text, thought = false) {
    if (!text) return;
    const assistant = this.ensureAssistant();
    const part = thought ? this.ensureReasoning() : this.ensureText();
    part.text += text;
    part.time.end = now();
    this.emit('message.part.updated', { part });
  }

  handleTool(update) {
    const assistant = this.ensureAssistant();
    const existing = assistant.parts.find(
      (part) => part.type === 'tool' && part.callID === update.toolCallId,
    );
    const next = toolPart(this.state.id, assistant.info.id, update, existing);
    if (existing) {
      for (const key of Object.keys(existing)) delete existing[key];
      Object.assign(existing, next);
      this.emit('message.part.updated', { part: existing });
    } else {
      assistant.parts.push(next);
      this.emit('message.part.updated', { part: next });
    }
  }

  handle(update) {
    if (!update) return;
    switch (update.sessionUpdate) {
      case 'user_message_chunk': {
        if (this.replay) {
          const text = update.content?.type === 'text' ? update.content.text : '';
          if (!this.currentUser || this.currentAssistant) this.newUser(text);
          else if (text) {
            let part = this.currentUser.parts.find((item) => item.type === 'text');
            if (!part) {
              part = textPart(this.state.id, this.currentUser.info.id, '');
              this.currentUser.parts.push(part);
              this.emit('message.part.updated', { part });
            }
            part.text += text;
            this.emit('message.part.updated', { part });
          }
        }
        break;
      }
      case 'agent_message_chunk': {
        if (update.content?.type === 'text') this.appendText(update.content.text, false);
        break;
      }
      case 'agent_thought_chunk': {
        if (update.content?.type === 'text') this.appendText(update.content.text, true);
        break;
      }
      case 'tool_call':
      case 'tool_call_update': {
        this.handleTool(update);
        break;
      }
      case 'usage_update': {
        if (this.currentAssistant) {
          const tokens = this.currentAssistant.info.tokens;
          const used = Number(update.used || 0);
          if (used > 0) {
            tokens.input = used;
            tokens.total = used;
          }
          this.emit('message.updated', { info: this.currentAssistant.info });
        }
        break;
      }
      case 'session_info_update': {
        if (update.title) {
          this.state.title = update.title;
          this.state.updatedAt = now();
          persisted.titles[this.state.id] = update.title;
          saveStateSoon();
          this.emit('session.updated', { info: serializeSession(this.state) });
        }
        break;
      }
      case 'plan': {
        const entries = Array.isArray(update.entries) ? update.entries : [];
        this.state.todos = entries.map((entry, index) => ({
          id: String(entry.id || `${this.state.id}_todo_${index}`),
          content: String(entry.content || ''),
          status:
            entry.status === 'completed'
              ? 'completed'
              : entry.status === 'in_progress'
                ? 'in_progress'
                : entry.status === 'cancelled'
                  ? 'cancelled'
                  : 'pending',
          priority: entry.priority || 'medium',
        }));
        this.emit('todo.updated', {
          sessionID: this.state.id,
          todos: this.state.todos,
        });
        break;
      }
      default:
        break;
    }
  }

  finish(usage) {
    if (this.closed) return;
    this.closed = true;
    if (this.currentAssistant) {
      this.currentAssistant.info.time.completed = now();
      if (usage) {
        this.currentAssistant.info.tokens = tokenInfo(usage);
        this.state.tokenTotal =
          (this.currentAssistant.info.tokens.total || 0) + (this.state.tokenTotal || 0);
      }
      for (const part of this.currentAssistant.parts) {
        if (part.time && !part.time.end) part.time.end = now();
      }
      this.emit('message.updated', { info: this.currentAssistant.info });
    }
    for (const message of this.messages) {
      if (message.info.role === 'assistant' && !message.info.time.completed) {
        message.info.time.completed = now();
      }
    }
    this.state.updatedAt = now();
  }
}

async function ensureClient() {
  await acp.start();
}

async function reloadSession(state) {
  if (state.loaded) return;
  if (state.loadPromise) return state.loadPromise;
  state.loadPromise = (async () => {
    await ensureClient();
    const collector = new TurnCollector(state, { replay: true, messages: [] });
    const previousCollector = state.collector;
    state.collector = collector;
    try {
      const result = await acp.request(
        'session/load',
        { sessionId: state.id, cwd: state.cwd, mcpServers: [] },
        120000,
      );
      collector.finish();
      state.messages = collector.messages;
      state.loaded = true;
      state.configs = Array.isArray(result?.configOptions) ? result.configOptions : [];
      state.models = result?.models || {};
      for (const config of state.configs) state.config[config.id] = config.currentValue;
      const info = result?._meta?.antigravity?.tier;
      if (info && !state.title) state.title = state.title;
    } catch (error) {
      state.loaded = true;
      throw error;
    } finally {
      state.collector = previousCollector;
      state.loadPromise = null;
    }
  })();
  return state.loadPromise;
}

async function listSessions() {
  await ensureClient();
  let listed = [];
  try {
    const result = await acp.request('session/list', { cwd: ROOT }, 30000);
    listed = Array.isArray(result?.sessions) ? result.sessions : [];
  } catch (error) {
    log('session list failed', error.message);
  }
  const sessions = [];
  for (const item of listed) {
    if (!item?.sessionId || isHidden(item.sessionId)) continue;
    const cwd = item.cwd ? resolve(item.cwd) : ROOT;
    if (cwd !== ROOT) continue;
    const updated = Date.parse(item.updatedAt || '') || now();
    const state = sessionFor(item.sessionId, {
      cwd,
      title: titleFor(item.sessionId, item.title || 'Agy 세션'),
      updated,
      created: updated,
    });
    state.title = titleFor(item.sessionId, item.title || state.title);
    state.cwd = cwd;
    state.updatedAt = updated;
    sessions.push(serializeSession(state));
  }
  for (const state of runtime.values()) {
    if (isHidden(state.id)) continue;
    if (state.cwd !== ROOT) continue;
    if (!sessions.some((session) => session.id === state.id)) sessions.push(serializeSession(state));
  }
  sessions.sort((a, b) => b.time.updated - a.time.updated);
  return sessions;
}

async function createSession() {
  await ensureClient();
  const result = await acp.request('session/new', { cwd: ROOT, mcpServers: [] }, 30000);
  const id = result?.sessionId;
  if (!id) throw new Error('Agy 세션 ID를 받지 못했어요');
  const state = emptyState(id);
  state.loaded = true;
  state.configs = Array.isArray(result.configOptions) ? result.configOptions : [];
  state.models = result.models || {};
  for (const config of state.configs) state.config[config.id] = config.currentValue;
  persisted.created[id] = now();
  saveStateSoon();
  runtime.set(id, state);
  emit('session.created', { info: serializeSession(state) });
  return serializeSession(state);
}

async function applyModel(state, modelID, variant) {
  if (!modelID) return;
  const descriptor = catalog.byID.get(modelID);
  const modelValue = descriptor?.baseID || modelID;
  const thoughtLevel = variant || state.config.thought_level || '';
  const configIds = new Set(state.configs.map((config) => config.id));

  async function setOption(configId, value) {
    if (!value) return;
    if (configIds.size > 0 && !configIds.has(configId)) return;
    await acp.request(
      'session/set_config_option',
      { sessionId: state.id, configId, value },
      15000,
    );
    state.config[configId] = value;
  }

  try {
    await setOption('model', modelValue);
  } catch (error) {
    log('set model failed', modelValue, error.message);
    try {
      await setOption('model', modelID);
    } catch {
      // model selection is best effort; the prompt can still run
    }
  }
  try {
    if (thoughtLevel) await setOption('thought_level', thoughtLevel);
  } catch (error) {
    log('set thought level failed', thoughtLevel, error.message);
  }
}

function promptParts(parts) {
  const result = [];
  for (const part of parts || []) {
    if (part.type === 'text' && part.text) {
      result.push({ type: 'text', text: part.text });
    } else if (part.type === 'file' && part.url) {
      if (String(part.mime || '').startsWith('image/') && part.url.startsWith('data:')) {
        const match = part.url.match(/^data:([^;]+);base64,(.*)$/s);
        if (match) {
          result.push({ type: 'image', mimeType: part.mime || match[1], data: match[2] });
          continue;
        }
      }
      result.push({
        type: 'resource_link',
        uri: part.url,
        name: part.filename || '첨부 파일',
        mimeType: part.mime || 'application/octet-stream',
      });
    }
  }
  return result;
}

async function promptSession(state, body) {
  if (state.busy) throw new Error('이미 작업 중이에요');
  await ensureClient();
  await loadCatalog();
  await reloadSession(state).catch((error) => log('load before prompt failed', error.message));

  const text = (body.parts || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim();
  const files = (body.parts || [])
    .filter((part) => part.type === 'file')
    .map((part) => ({ mime: part.mime, filename: part.filename, url: part.url }));
  if (!text && files.length === 0) throw new Error('보낼 내용이 없어요');

  const modelID = body.model?.modelID || state.config.model || catalog.defaultModel;
  const variant = body.variant || '';
  const collector = new TurnCollector(state, { modelID });
  state.collector = collector;
  state.busy = true;
  state.loaded = true;
  emit('session.status', { sessionID: state.id, status: { type: 'busy' } });
  collector.newUser(text, files);

  try {
    await applyModel(state, modelID, variant);
    const result = await acp.request(
      'session/prompt',
      {
        sessionId: state.id,
        prompt: promptParts(body.parts),
      },
      0,
    );
    log('prompt finished', state.id, result?.stopReason, JSON.stringify(result?.usage || {}));
    collector.finish(result.usage);
    state.updatedAt = now();
    if (persisted.created[state.id]) state.createdAt = persisted.created[state.id];
    emit('session.updated', { info: serializeSession(state) });
  } catch (error) {
    const message = error?.message || 'Agy 응답을 받지 못했어요';
    collector.emit('session.error', {
      sessionID: state.id,
      error: { name: 'AgyError', data: { message } },
    });
    collector.finish();
    throw error;
  } finally {
    state.busy = false;
    state.collector = null;
    emit('session.status', {
      sessionID: state.id,
      status: { type: 'idle' },
    });
    emit('session.idle', { sessionID: state.id });
  }
}

/* ── git helpers ──────────────────────────────────────────── */

async function readGitInfo() {
  try {
    const [{ stdout: branch }, { stdout: porcelain }] = await Promise.all([
      runShort('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 5000),
      runShort('git', ['status', '--porcelain=v1'], 5000),
    ]);
    const files = porcelain
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const code = line.slice(0, 2);
        const status = code.includes('?')
          ? 'added'
          : code.includes('D')
            ? 'deleted'
            : 'modified';
        const rawPath = line.slice(3).trim();
        const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
        return { path: filePath, status, added: 0, removed: 0, staged: line[0] !== ' ' };
      });
    return { branch: branch.trim(), files };
  } catch {
    return { branch: '', files: [] };
  }
}

/* ── HTTP API ─────────────────────────────────────────────── */

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';
  log(method, path);

  if (path === '/health') {
    try {
      await ensureClient();
      await loadCatalog();
      return send(res, 200, {
        ok: true,
        engine: 'agy',
        name: acp.agentInfo?.name || 'Agy',
        version: acp.agentInfo?.version || 'unknown',
        authMethods: acp.authMethods,
        models: Object.keys(catalog.models).length,
        sessions: runtime.size,
        autoApprove: false,
        workspace: ROOT,
      });
    } catch (error) {
      return send(res, 503, {
        ok: false,
        engine: 'agy',
        error: error.message,
        stderr: acp.stderr.slice(-2000),
      });
    }
  }

  if (path === '/usage' && method === 'GET') {
    try {
      const force = url.searchParams.get('refresh') === '1';
      return send(res, 200, await getAgyQuota(force));
    } catch (error) {
      if (quotaCache) {
        return send(res, 200, {
          ...quotaCache.data,
          cached: true,
          stale: true,
          error: error.message,
        });
      }
      return sendError(res, 503, error.message);
    }
  }

  if (path === '/event' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');
    sseClients.add(res);
    emit('server.connected', {});
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  if (path === '/session' && method === 'GET') {
    try {
      return send(res, 200, await listSessions());
    } catch (error) {
      return sendError(res, 503, error.message);
    }
  }

  if (path === '/session' && method === 'POST') {
    try {
      const body = method === 'POST' ? await readBody(req) : {};
      const created = await createSession();
      if (body?.title) {
        const state = runtime.get(created.id);
        if (state) {
          state.title = String(body.title).slice(0, 120);
          persisted.titles[state.id] = state.title;
          saveStateSoon();
          emit('session.updated', { info: serializeSession(state) });
          return send(res, 200, serializeSession(state));
        }
      }
      return send(res, 200, created);
    } catch (error) {
      return sendError(res, 500, error.message);
    }
  }

  if (path === '/session/status' && method === 'GET') {
    const statuses = {};
    for (const state of runtime.values()) {
      statuses[state.id] = { type: state.busy ? 'busy' : 'idle' };
    }
    return send(res, 200, statuses);
  }

  const sessionMatch = path.match(/^\/session\/([^/]+)(?:\/(.*))?$/);
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1]);
    const rest = sessionMatch[2] || '';
    let state = runtime.get(id);
    if (!state && rest !== '') {
      state = sessionFor(id);
    }
    if (!state) return sendError(res, 404, '세션을 찾지 못했어요');

    if (!rest && method === 'GET') {
      return send(res, 200, serializeSession(state));
    }
    if (!rest && method === 'DELETE') {
      hideSession(id);
      emit('session.deleted', { info: serializeSession(state) });
      runtime.delete(id);
      await acp.notify('session/close', { sessionId: id });
      return send(res, 200, true);
    }
    if (!rest && method === 'PATCH') {
      const body = await readBody(req);
      if (body?.title) {
        state.title = String(body.title).slice(0, 120);
        persisted.titles[id] = state.title;
        saveStateSoon();
        state.updatedAt = now();
        emit('session.updated', { info: serializeSession(state) });
      }
      return send(res, 200, serializeSession(state));
    }
    if (rest === 'message' && method === 'GET') {
      try {
        await reloadSession(state);
        return send(res, 200, state.messages);
      } catch (error) {
        return sendError(res, 502, error.message);
      }
    }
    if (rest === 'todo' && method === 'GET') {
      return send(res, 200, state.todos || []);
    }
    if (rest === 'diff' && method === 'GET') {
      return send(res, 200, []);
    }
    if (rest === 'children' && method === 'GET') {
      return send(res, 200, []);
    }
    if (rest === 'prompt_async' && method === 'POST') {
      const body = await readBody(req);
      state.loaded = true;
      void promptSession(state, body).catch((error) => log('prompt failed', error.message));
      return send(res, 204);
    }
    if (rest === 'abort' && method === 'POST') {
      await acp.notify('session/cancel', { sessionId: id });
      state.busy = false;
      emit('session.status', { sessionID: id, status: { type: 'idle' } });
      emit('session.idle', { sessionID: id });
      return send(res, 200, true);
    }
    if (rest === 'summarize' && method === 'POST') {
      return sendError(res, 501, 'Agy에서는 대화를 직접 압축할 수 없어요. /compact를 보내 주세요.');
    }
    if (rest === 'fork' && method === 'POST') {
      return sendError(res, 501, 'Agy 세션은 현재 분기를 지원하지 않아요.');
    }
    const permissionMatch = rest.match(/^permissions\/(.+)$/);
    if (permissionMatch && method === 'POST') {
      const body = await readBody(req);
      try {
        await acp.respondPermission(
          decodeURIComponent(permissionMatch[1]),
          body?.response || 'once',
        );
        return send(res, 200, true);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
    }
  }

  if (path === '/config/providers' && method === 'GET') {
    const forceRefresh = url.searchParams.get('refresh') === '1';
    await loadCatalog(forceRefresh);
    return send(res, 200, providersPayload());
  }
  if (path === '/config') {
    await loadCatalog();
    return send(res, 200, { model: catalog.defaultModel, provider: 'agy' });
  }
  if (path === '/agent' && method === 'GET') {
    return send(res, 200, [
      {
        name: 'agy',
        description: 'Agy Antigravity agent',
        mode: 'primary',
        builtIn: true,
        permission: {},
        tools: {},
        options: {},
      },
      {
        name: 'plan',
        description: 'Agy plan mode',
        mode: 'subagent',
        builtIn: true,
        permission: {},
        tools: {},
        options: {},
      },
    ]);
  }
  if (path === '/path' && method === 'GET') {
    return send(res, 200, {
      state: 'agy',
      config: join(ROOT, '.agent-web', 'agy-state.json'),
      worktree: ROOT,
      directory: ROOT,
    });
  }
  if (path === '/vcs' && method === 'GET') {
    const git = await readGitInfo();
    return send(res, 200, { branch: git.branch, default_branch: git.branch });
  }
  if (path === '/file/status' && method === 'GET') {
    const git = await readGitInfo();
    return send(res, 200, git.files);
  }

  return sendError(res, 404, `알 수 없는 API: ${method} ${path}`);
}

async function main() {
  persisted = await loadState();
  // Warm the ACP process in the background so /health and the first session are
  // fast, but don't prevent the bridge from booting if Agy is unavailable.
  void ensureClient()
    .then(() => loadCatalog())
    .catch((error) => log('ACP warmup failed', error.message));

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      console.error('[agy-bridge] request failed', error);
      if (!res.headersSent) sendError(res, 500, error.message);
      else res.end();
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`  Agy bridge: http://127.0.0.1:${PORT}`);
    console.log(`  workspace: ${ROOT}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n  Agy bridge 종료 중 (${signal})…`);
    for (const res of sseClients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
    server.close();
    await acp.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[agy-bridge]', error);
  process.exit(1);
});
