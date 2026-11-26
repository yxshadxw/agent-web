import type {
  Agent,
  File as AgentFile,
  FileDiff,
  Message,
  Model,
  Part,
  Permission,
  Provider,
  Session,
  SessionStatus,
  Todo,
} from '@opencode-ai/sdk';
import { apiBase } from './engine';

export type Tokens = {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
  total?: number;
};

export type AgentSession = Session & {
  cost?: number;
  tokens?: Tokens;
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
  slug?: string;
};

export type AgentModel = Model & {
  variants?: Record<string, { disabled?: boolean } | undefined>;
};

export type AgentProvider = Omit<Provider, 'models'> & {
  models: Record<string, AgentModel>;
};

export type ProvidersPayload = {
  providers: AgentProvider[];
  default: Record<string, string>;
};

export type UserMessageInfo = Extract<Message, { role: 'user' }> & {
  model: { providerID: string; modelID: string; variant?: string };
};

export type AssistantMessageInfo = Extract<Message, { role: 'assistant' }> & {
  agent?: string;
  variant?: string;
  tokens: Tokens;
};

export type MessageWithParts = {
  info: Message;
  parts: Part[];
};

export type PermissionRequest = Permission;

export type PathInfo = {
  state: string;
  config: string;
  worktree: string;
  directory: string;
};

export type VcsInfo = {
  branch?: string;
  default_branch?: string;
};

export type AgyStatus = {
  ok: boolean;
  engine?: string;
  name?: string;
  version?: string;
  models?: number;
  sessions?: number;
  workspace?: string;
  autoApprove?: boolean;
  error?: string;
  stderr?: string;
};

export type AgyQuotaBucket = {
  id: string;
  window: string;
  name: string;
  remaining: number | null;
  resetAt: string | null;
  disabled: boolean;
  description?: string;
};

export type AgyQuotaGroup = {
  name: string;
  models: string[];
  buckets: AgyQuotaBucket[];
};

export type AgyQuota = {
  ok: boolean;
  groups: AgyQuotaGroup[];
  fetchedAt?: string;
  cached?: boolean;
  stale?: boolean;
  error?: string;
};

export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mime: string; filename?: string; url: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, '로그인이 필요해요');
  }

  if (!res.ok) {
    let message = `요청에 실패했어요 (${res.status})`;
    try {
      const body = await res.json();
      message =
        body?.data?.message ||
        body?.error?.message ||
        body?.message ||
        body?.error ||
        message;
    } catch {
      // ignore non-json error bodies
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

export const api = {
  login: async (username: string, password: string) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new ApiError(res.status, '아이디 또는 비밀번호가 올바르지 않아요');
  },

  logout: async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  },

  agyStatus: async (): Promise<AgyStatus> => {
    try {
      const res = await fetch('/agy-api/health', { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as AgyStatus;
      if (!res.ok) {
        return {
          ...body,
          ok: false,
          error: body.error || `Agy 브리지 응답 ${res.status}`,
        };
      }
      return { ...body, ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Agy 브리지에 연결할 수 없어요',
      };
    }
  },

  agyQuota: async (refresh = false): Promise<AgyQuota> => {
    try {
      const res = await fetch(`/agy-api/usage${refresh ? '?refresh=1' : ''}`, {
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        groups?: AgyQuotaGroup[];
        fetchedAt?: string;
        cached?: boolean;
        stale?: boolean;
        error?: string | { message?: string };
      };
      if (!res.ok) {
        const message =
          typeof body.error === 'string'
            ? body.error
            : body.error?.message || `Agy 사용량 요청에 실패했어요 (${res.status})`;
        return { ok: false, groups: [], error: message };
      }
      return {
        ok: body.ok !== false,
        groups: Array.isArray(body.groups) ? body.groups : [],
        fetchedAt: body.fetchedAt,
        cached: body.cached,
        stale: body.stale,
        error:
          typeof body.error === 'string' ? body.error : body.error?.message,
      };
    } catch (error) {
      return {
        ok: false,
        groups: [],
        error:
          error instanceof Error
            ? error.message
            : 'Agy 사용량을 불러오지 못했어요',
      };
    }
  },

  path: () => request<PathInfo>('/path'),
  sessions: () => request<AgentSession[]>('/session'),
  createSession: (title?: string) =>
    request<AgentSession>('/session', json(title ? { title } : {})),
  deleteSession: (id: string) =>
    request<boolean>(`/session/${id}`, { method: 'DELETE' }),
  renameSession: (id: string, title: string) =>
    request<AgentSession>(`/session/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  messages: (id: string) =>
    request<MessageWithParts[]>(`/session/${id}/message`),
  statuses: () => request<Record<string, SessionStatus>>('/session/status'),
  todos: (id: string) => request<Todo[]>(`/session/${id}/todo`),
  diff: (id: string) => request<FileDiff[]>(`/session/${id}/diff`),
  children: (id: string) => request<AgentSession[]>(`/session/${id}/children`),
  providers: (refresh?: boolean) =>
    request<ProvidersPayload>(refresh ? '/config/providers?refresh=1' : '/config/providers'),
  agents: () => request<Agent[]>('/agent'),
  vcs: () => request<VcsInfo>('/vcs'),
  fileStatus: () => request<AgentFile[]>('/file/status'),
  fork: (id: string, messageID?: string) =>
    request<AgentSession>(`/session/${id}/fork`, json(messageID ? { messageID } : {})),
  abort: (id: string) => request<boolean>(`/session/${id}/abort`, { method: 'POST' }),
  summarize: (id: string, providerID: string, modelID: string) =>
    request<boolean>(`/session/${id}/summarize`, {
      method: 'POST',
      body: JSON.stringify({ providerID, modelID }),
    }),

  prompt: (
    sessionID: string,
    body: {
      model?: { providerID: string; modelID: string };
      agent?: string;
      variant?: string;
      parts: PromptPart[];
    },
  ) =>
    request<void>(`/session/${sessionID}/prompt_async`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  replyPermission: (
    sessionID: string,
    permissionID: string,
    response: 'once' | 'always' | 'reject',
  ) =>
    request<boolean>(`/permission/${permissionID}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply: response }),
    }).catch(() =>
      request<boolean>(`/session/${sessionID}/permissions/${permissionID}`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      }),
    ),

  pendingPermissions: () =>
    request<any[]>('/permission').catch(() => [] as any[]),
};

export function modelKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`;
}

export function findModel(
  providers: AgentProvider[] | null,
  providerID?: string,
  modelID?: string,
): AgentModel | null {
  if (!providers || !providerID || !modelID) return null;
  const provider = providers.find((p) => p.id === providerID);
  return provider?.models[modelID] ?? null;
}

export function modelLabel(model: AgentModel | null, modelID: string) {
  return model?.name || modelID;
}

export function tokenTotal(tokens?: Tokens | null): number {
  if (!tokens) return 0;
  return (
    tokens.total ??
    tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  );
}

export function contextTokens(messages: MessageWithParts[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info;
    if (info.role === 'assistant') {
      const total = tokenTotal(info.tokens as Tokens);
      if (total > 0) return total;
    }
  }
  return 0;
}

export function sessionCost(messages: MessageWithParts[], session?: AgentSession | null) {
  if (session?.cost) return session.cost;
  return messages.reduce(
    (sum, m) => sum + (m.info.role === 'assistant' ? m.info.cost || 0 : 0),
    0,
  );
}

export function sessionTokens(messages: MessageWithParts[], session?: AgentSession | null) {
  if (session?.tokens) return session.tokens;
  const result: Tokens = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  };
  for (const m of messages) {
    if (m.info.role !== 'assistant') continue;
    const t = m.info.tokens as Tokens;
    result.input += t.input;
    result.output += t.output;
    result.reasoning += t.reasoning;
    result.cache.read += t.cache.read;
    result.cache.write += t.cache.write;
  }
  return result;
}

export function lastUserMessage(messages: MessageWithParts[]): UserMessageInfo | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info;
    if (info.role === 'user') return info as UserMessageInfo;
  }
  return null;
}
