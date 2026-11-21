import { spawn } from 'node:child_process';

const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const MAX_BODY = 1024 * 1024;
const MAX_PROMPT = 20_000;
const TURN_TIMEOUT = 5 * 60_000;
const MAX_TOOLS = 80;
const MAX_TOOL_TEXT = 12_000;

function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }
  return String(value);
}

function codexToolRecord(item, eventType) {
  const type = asText(item?.type) || 'tool';
  let name = type;
  let command = '';
  if (type === 'command_execution') {
    name = 'bash';
    command = asText(item.command);
  } else if (type === 'file_change') {
    name = 'edit';
    const changes = Array.isArray(item.changes) ? item.changes : [];
    command = changes.map((change) => asText(change?.path || change)).filter(Boolean).join('\n');
  } else if (type === 'mcp_tool_call') {
    name = [item.server, item.tool].map(asText).filter(Boolean).join('/') || 'mcp';
    command = asText(item.arguments);
  } else if (type === 'web_search') {
    name = 'web';
    command = asText(item.query);
  } else {
    name = asText(item.name) || type;
    command = asText(item.command ?? item.query ?? item.path ?? item.arguments ?? '');
  }
  const status =
    asText(item.status) ||
    (eventType === 'item.completed'
      ? item.exit_code === 0
        ? 'completed'
        : item.exit_code != null
          ? 'failed'
          : 'completed'
      : 'running');
  const output = asText(item.aggregated_output ?? item.output ?? item.result ?? '');
  return {
    id: asText(item.id),
    type,
    name,
    command: command.slice(0, 4_000),
    status,
    output: output.slice(0, MAX_TOOL_TEXT),
  };
}

function send(res, status, body) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('요청이 너무 큽니다.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON 요청을 읽지 못했습니다.'));
      }
    });
    req.on('error', reject);
  });
}

function run(command, args, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} 응답 시간이 초과됐습니다.`));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

function runCodex(prompt, threadId, root, options = {}) {
  return new Promise((resolve, reject) => {
    const modelArgs = options.model ? ['--model', options.model] : [];
    const effortArgs = options.effort
      ? ['-c', `model_reasoning_effort="${options.effort}"`]
      : [];
    const args = threadId
      ? [
          ...effortArgs,
          'exec',
          'resume',
          '--json',
          '--skip-git-repo-check',
          ...modelArgs,
          threadId,
          prompt,
        ]
      : [
          ...effortArgs,
          'exec',
          '--json',
          '--skip-git-repo-check',
          ...(options.autoApprove
            ? ['--dangerously-bypass-approvals-and-sandbox']
            : ['--sandbox', 'workspace-write']),
          ...modelArgs,
          prompt,
        ];

    const child = spawn(CODEX_BIN, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let buffer = '';
    let stderr = '';
    let resolvedThread = threadId || null;
    let text = '';
    let reasoning = '';
    let usage = null;
    let failure = null;
    const toolsById = new Map();
    let finished = false;

    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve({
        threadId: resolvedThread,
        text: text.trim(),
        reasoning: reasoning.trim(),
        tools: [...toolsById.values()],
        usage,
      });
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Codex 응답 시간이 초과됐습니다.'));
    }, TURN_TIMEOUT);

    const consume = (line) => {
      const value = line.trim();
      if (!value) return;
      let event;
      try {
        event = JSON.parse(value);
      } catch {
        return;
      }
      if (event.type === 'thread.started' && event.thread_id) {
        resolvedThread = event.thread_id;
      }
      if (
        (event.type === 'item.started' ||
          event.type === 'item.updated' ||
          event.type === 'item.completed') &&
        event.item
      ) {
        const type = asText(event.item.type);
        if (type && type !== 'agent_message' && type !== 'reasoning') {
          const key = asText(event.item.id) || `${type}:${toolsById.size}`;
          const previous = toolsById.get(key);
          const next = codexToolRecord(event.item, event.type);
          toolsById.set(key, {
            ...previous,
            ...next,
            id: next.id || previous?.id || key,
            command: next.command || previous?.command || '',
            output: next.output || previous?.output || '',
          });
          while (toolsById.size > MAX_TOOLS) {
            const oldest = toolsById.keys().next().value;
            if (!oldest) break;
            toolsById.delete(oldest);
          }
        }
      }
      if (event.type === 'item.completed' && event.item) {
        if (event.item.type === 'agent_message') {
          const message = asText(event.item.text || event.item.summary);
          if (message) text += `${message}\n`;
        }
        if (event.item.type === 'reasoning') {
          const thought = asText(event.item.text || event.item.summary);
          if (thought) reasoning += `${thought}\n`;
        }
      }
      if (event.type === 'turn.completed' && event.usage) usage = event.usage;
      if (event.type === 'error') failure = event.message || event.error?.message || 'Codex 오류';
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12_000);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (buffer.trim()) consume(buffer);
      if (finished) return;
      if (failure) {
        finish(new Error(failure));
        return;
      }
      if (code !== 0 && !text.trim()) {
        finish(new Error(stderr.trim() || `Codex exited ${code}`));
        return;
      }
      finish();
    });
  });
}

let quotaCache = null;

function readCodexQuota() {
  if (quotaCache && Date.now() - quotaCache.at < 20_000) return quotaCache.value;
  const value = new Promise((resolve, reject) => {
    const child = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let buffer = '';
    let settled = false;
    let stderr = '';
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      quotaCache = error ? null : { at: Date.now(), value };
      if (error) reject(error);
      else resolve(result);
    };
    const send = (payload) => {
      if (settled || child.stdin.destroyed) return;
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    };
    const timer = setTimeout(() => finish(new Error('Codex 한도 응답 시간이 초과됐습니다.')), 15_000);
    child.on('error', (error) => finish(error));
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    });
    child.on('close', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server exited ${code}`));
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        let message;
        try {
          message = JSON.parse(raw);
        } catch {
          continue;
        }
        if (message.id === 1 && message.result) {
          send({ jsonrpc: '2.0', method: 'initialized', params: {} });
          send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} });
          continue;
        }
        if (message.id !== 2) continue;
        if (message.error) {
          finish(new Error(message.error.message || 'Codex 계정 한도를 읽지 못했습니다.'));
          return;
        }
        const result = message.result || {};
        const snapshot =
          result.rateLimitsByLimitId?.codex || result.rateLimits || null;
        if (!snapshot) {
          finish(new Error('Codex가 계정 한도를 반환하지 않았습니다.'));
          return;
        }
        finish(null, {
          plan: snapshot.planType || null,
          primary: snapshot.primary || null,
          secondary: snapshot.secondary || null,
          credits: snapshot.credits || null,
          ordinaryUsageAllowed: result.ordinaryUsageAllowed ?? null,
          fetchedAt: Date.now(),
        });
      }
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'agent-web', version: '1.0.0' } },
    });
  });
  quotaCache = { at: Date.now(), value };
  value.catch(() => {
    if (quotaCache?.value === value) quotaCache = null;
  });
  return value;
}

let healthCache = null;

async function health() {
  if (healthCache && Date.now() - healthCache.at < 30_000) return healthCache.value;
  const value = await run(CODEX_BIN, ['login', 'status'], 15_000)
    .then(({ stdout }) => ({
      ok: /logged in/i.test(stdout),
      auth: /chatgpt/i.test(stdout) ? 'ChatGPT' : 'Codex',
      detail: stdout.trim().slice(0, 300),
    }))
    .catch((error) => ({ ok: false, error: error.message }));
  healthCache = { at: Date.now(), value };
  return value;
}

export function createCodexHandler({ root, workingRoot = process.cwd() }) {
  let busy = false;

  return async (req, res, next) => {
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && path === '/health') {
      try {
        return send(res, 200, { ...(await health()), workspace: workingRoot });
      } catch (error) {
        return send(res, 503, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && path === '/quota') {
      try {
        return send(res, 200, { ok: true, ...(await readCodexQuota()) });
      } catch (error) {
        return send(res, 503, { ok: false, error: error.message });
      }
    }

    if (req.method === 'POST' && path === '/chat') {
      if (busy) {
        return send(res, 429, { ok: false, error: 'Codex가 이미 작업 중입니다.' });
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return send(res, 400, { ok: false, error: error.message });
      }
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      const model =
        typeof body?.model === 'string' && /^[a-zA-Z0-9._:-]{1,80}$/.test(body.model)
          ? body.model
          : '';
      const autoApprove = Boolean(body?.autoApprove);
      const requestedEffort = typeof body?.effort === 'string' ? body.effort : '';
      const effort = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(requestedEffort)
        ? requestedEffort
        : '';
      const threadId =
        typeof body?.threadId === 'string' && /^[a-zA-Z0-9_-]{8,120}$/.test(body.threadId)
          ? body.threadId
          : '';
      if (!prompt) return send(res, 400, { ok: false, error: '메시지를 입력해 주세요.' });
      if (prompt.length > MAX_PROMPT) {
        return send(res, 400, { ok: false, error: '메시지가 너무 깁니다.' });
      }
      busy = true;
      try {
        const result = await runCodex(prompt, threadId, workingRoot || root, {
          model,
          autoApprove,
          effort,
        });
        return send(res, 200, {
          ok: true,
          ...result,
          text:
            result.text ||
            result.reasoning ||
            'Codex가 작업을 완료했지만 표시할 텍스트 응답이 없습니다.',
        });
      } catch (error) {
        return send(res, 502, { ok: false, error: error.message });
      } finally {
        busy = false;
      }
    }

    if (typeof next === 'function') return next();
    return send(res, 404, { ok: false, error: '알 수 없는 Codex 요청입니다.' });
  };
}
