import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event, Message, Part, SessionStatus, Todo, FileDiff, File as AgentFile } from '@opencode-ai/sdk';
import { apiBase, getEngine } from '../lib/engine';
import {
  api,
  ApiError,
  findModel,
  modelKey,
  setUnauthorizedHandler,
  type AgentModel,
  type AgentProvider,
  type AgentSession,
  type MessageWithParts,
  type PathInfo,
  type PermissionRequest,
  type PromptPart,
  type ProvidersPayload,
  type VcsInfo,
  lastUserMessage,
} from '../lib/api';

type AuthState = 'checking' | 'required' | 'ok' | 'error';
type ConnectionState = 'connecting' | 'online' | 'offline';

export type ModelSelection = {
  providerID: string;
  modelID: string;
  variant: string;
};

const ENGINE = getEngine();
const LAST_SESSION_KEY = `agent-web:last-session:${ENGINE}`;
const MODEL_KEY = `agent-web:model:${ENGINE}`;

function readStoredModel(): ModelSelection | null {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModelSelection;
    if (!parsed?.providerID || !parsed?.modelID) return null;
    return parsed;
  } catch {
    return null;
  }
}

function preferredVariant(model: AgentModel | null, current?: string): string {
  const variants = model?.variants
    ? Object.entries(model.variants)
        .filter(([, value]) => !value || !value.disabled)
        .map(([key]) => key)
    : [];
  if (current && variants.includes(current)) return current;
  if (variants.includes('high')) return 'high';
  if (variants.includes('medium')) return 'medium';
  return variants[0] ?? '';
}

function pickInitialModel(providers: ProvidersPayload): ModelSelection {
  const stored = readStoredModel();
  if (stored && findModel(providers.providers, stored.providerID, stored.modelID)) {
    const model = findModel(providers.providers, stored.providerID, stored.modelID);
    return { ...stored, variant: preferredVariant(model, stored.variant) };
  }

  const preferred =
    findModel(providers.providers, 'opencode', 'deepseek-v4.1-flash-free') ||
    Object.values(providers.providers)
      .flatMap((provider) => Object.values(provider.models))
      .find((model) => Object.keys(model.variants ?? {}).length > 0) ||
    Object.values(providers.providers)
      .flatMap((provider) => Object.values(provider.models))
      .find(Boolean);

  if (preferred) {
    return {
      providerID: preferred.providerID,
      modelID: preferred.id,
      variant: preferredVariant(preferred),
    };
  }

  const entry = Object.entries(providers.default)[0];
  return entry
    ? { providerID: entry[0], modelID: entry[1], variant: '' }
    : { providerID: 'opencode', modelID: 'big-pickle', variant: '' };
}

function upsertSession(list: AgentSession[], session: AgentSession): AgentSession[] {
  const index = list.findIndex((item) => item.id === session.id);
  const next = index === -1 ? [session, ...list] : list.map((item, i) => (i === index ? session : item));
  return next.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
}

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  const value = error as {
    name?: string;
    message?: string;
    data?: { message?: string };
  };
  return value.data?.message || value.message || value.name || '알 수 없는 오류가 발생했어요';
}

function partKey(part: Part) {
  return part.id;
}

export function useAgent() {
  const [auth, setAuthState] = useState<AuthState>('checking');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionID, setSessionIDState] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageWithParts[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [todos, setTodos] = useState<Todo[]>([]);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [children, setChildren] = useState<AgentSession[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [providers, setProviders] = useState<ProvidersPayload | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [pathInfo, setPathInfo] = useState<PathInfo | null>(null);
  const [vcs, setVcs] = useState<VcsInfo | null>(null);
  const [gitFiles, setGitFiles] = useState<AgentFile[]>([]);
  const [model, setModelState] = useState<ModelSelection>({
    providerID: '',
    modelID: '',
    variant: '',
  });
  const [autoApprove, setAutoApproveState] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authRef = useRef(auth);
  const sessionRef = useRef<string | null>(null);
  const providersRef = useRef<ProvidersPayload | null>(null);
  const autoApproveRef = useRef(autoApprove);
  const orphanParts = useRef<Record<string, Record<string, Part>>>({});
  const diffTimer = useRef<number | undefined>(undefined);
  const idleTimer = useRef<number | undefined>(undefined);
  const refreshSeq = useRef(0);
  const openedBefore = useRef(false);

  authRef.current = auth;
  providersRef.current = providers;
  autoApproveRef.current = autoApprove;

  const setSessionID = useCallback((id: string | null) => {
    sessionRef.current = id;
    setSessionIDState(id);
    if (id) localStorage.setItem(LAST_SESSION_KEY, id);
    else localStorage.removeItem(LAST_SESSION_KEY);
  }, []);

  const setModel = useCallback((next: ModelSelection) => {
    setModelState(next);
    localStorage.setItem(MODEL_KEY, JSON.stringify(next));
  }, []);

  const refreshGit = useCallback(async () => {
    try {
      const [branchInfo, files] = await Promise.all([api.vcs(), api.fileStatus()]);
      setVcs(branchInfo);
      setGitFiles(files);
    } catch {
      // git is optional; keep the last known state
    }
  }, []);

  const refreshDiff = useCallback(async (id: string) => {
    try {
      const diff = await api.diff(id);
      if (sessionRef.current === id) setDiffs(diff);
    } catch {
      // ignore
    }
  }, []);

  const refreshChildren = useCallback(async (id: string) => {
    try {
      const list = await api.children(id);
      if (sessionRef.current === id) setChildren(list);
    } catch {
      // ignore
    }
  }, []);

  const loadSession = useCallback(
    async (id: string) => {
      const seq = ++refreshSeq.current;
      const [nextMessages, nextTodos, nextDiff, nextChildren] = await Promise.all([
        api.messages(id),
        api.todos(id).catch(() => []),
        api.diff(id).catch(() => []),
        api.children(id).catch(() => []),
      ]);
      if (refreshSeq.current !== seq || sessionRef.current !== id) return;
      setMessages(nextMessages);
      setTodos(nextTodos);
      setDiffs(nextDiff);
      setChildren(nextChildren);

      const user = lastUserMessage(nextMessages);
      if (user?.model) {
        const candidate = findModel(
          providersRef.current?.providers ?? null,
          user.model.providerID,
          user.model.modelID,
        );
        if (candidate) {
          setModel({
            providerID: user.model.providerID,
            modelID: user.model.modelID,
            variant: preferredVariant(candidate, user.model.variant),
          });
        }
      }
    },
    [setModel],
  );

  const selectSession = useCallback(
    async (id: string | null) => {
      setSessionID(id);
      setMessages([]);
      setTodos([]);
      setDiffs([]);
      setChildren([]);
      setPermissions([]);
      setError(null);
      setSending(false);
      orphanParts.current = {};
      refreshSeq.current += 1;
      if (!id) return;
      try {
        await loadSession(id);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [loadSession, setSessionID],
  );

  const bootstrap = useCallback(async () => {
    setAuthState('checking');
    try {
      const [nextSessions, nextProviders, nextAgents, nextStatuses, nextPath] =
        await Promise.all([
          api.sessions(),
          api.providers(),
          api.agents(),
          api.statuses().catch(() => ({}) as Record<string, SessionStatus>),
          api.path().catch(() => null),
        ]);
      setSessions(nextSessions);
      setProviders(nextProviders);
      providersRef.current = nextProviders;
      setAgents(nextAgents.filter((agent) => agent.mode !== 'subagent').map((agent) => agent.name));
      setStatuses(nextStatuses);
      setPathInfo(nextPath);
      setModelState((current) => {
        if (current.providerID && findModel(nextProviders.providers, current.providerID, current.modelID)) {
          return current;
        }
        const selection = pickInitialModel(nextProviders);
        localStorage.setItem(MODEL_KEY, JSON.stringify(selection));
        return selection;
      });
      setAuthState('ok');
      void refreshGit();

      const stored = localStorage.getItem(LAST_SESSION_KEY);
      if (stored && nextSessions.some((session) => session.id === stored)) {
        void selectSession(stored);
      } else {
        setSessionID(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthState('required');
      } else {
        setAuthState('error');
        setError(errorText(err) || '에이전트 서버에 연결할 수 없어요');
      }
    }
  }, [refreshGit, selectSession, setSessionID]);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthState('required'));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (auth !== 'ok') return;

    const source = new EventSource(`${apiBase()}/event`);
    source.onopen = () => {
      setConnection('online');
      if (openedBefore.current) {
        void api.sessions().then(setSessions).catch(() => undefined);
        const current = sessionRef.current;
        if (current) void loadSession(current);
      }
      openedBefore.current = true;
    };
    source.onerror = () => setConnection('offline');
    source.onmessage = (event) => {
      let parsed: Event;
      try {
        parsed = JSON.parse(event.data) as Event;
      } catch {
        return;
      }
      setConnection('online');

      switch (parsed.type) {
        case 'server.connected':
          break;
        case 'session.created':
        case 'session.updated': {
          const info = parsed.properties.info;
          setSessions((current) => upsertSession(current, info));
          break;
        }
        case 'session.deleted': {
          const info = parsed.properties.info;
          setSessions((current) => current.filter((session) => session.id !== info.id));
          if (sessionRef.current === info.id) void selectSession(null);
          break;
        }
        case 'message.updated': {
          const info = parsed.properties.info;
          if (sessionRef.current !== info.sessionID) break;
          setMessages((current) => {
            const index = current.findIndex((message) => message.info.id === info.id);
            if (index === -1) {
              const pending = orphanParts.current[info.id];
              const parts = pending ? Object.values(pending) : [];
              delete orphanParts.current[info.id];
              return [...current, { info, parts }];
            }
            return current.map((message, i) =>
              i === index ? { info, parts: message.parts } : message,
            );
          });
          break;
        }
        case 'message.removed': {
          const { sessionID: sid, messageID } = parsed.properties;
          if (sessionRef.current !== sid) break;
          setMessages((current) => current.filter((message) => message.info.id !== messageID));
          break;
        }
        case 'message.part.updated': {
          const part = parsed.properties.part;
          if (sessionRef.current !== part.sessionID) break;
          setMessages((current) => {
            const index = current.findIndex((message) => message.info.id === part.messageID);
            if (index === -1) {
              const bucket = orphanParts.current[part.messageID] ?? {};
              bucket[partKey(part)] = part;
              orphanParts.current[part.messageID] = bucket;
              return current;
            }
            return current.map((message, i) => {
              if (i !== index) return message;
              const partIndex = message.parts.findIndex(
                (item) =>
                  item.id === part.id ||
                  (part.type === 'tool' &&
                    item.type === 'tool' &&
                    item.callID === part.callID),
              );
              const parts =
                partIndex === -1
                  ? [...message.parts, part]
                  : message.parts.map((item, j) => (j === partIndex ? part : item));
              return { ...message, parts };
            });
          });
          break;
        }
        case 'message.part.removed': {
          const { sessionID: sid, messageID, partID } = parsed.properties;
          if (sessionRef.current !== sid) break;
          setMessages((current) =>
            current.map((message) =>
              message.info.id === messageID
                ? { ...message, parts: message.parts.filter((part) => part.id !== partID) }
                : message,
            ),
          );
          break;
        }
        case 'session.status': {
          const { sessionID: sid, status } = parsed.properties;
          setStatuses((current) => ({ ...current, [sid]: status }));
          if (status.type === 'idle') {
            setSending(false);
            if (sessionRef.current === sid) {
              window.clearTimeout(idleTimer.current);
              idleTimer.current = window.setTimeout(() => {
                if (sessionRef.current !== sid) return;
                void loadSession(sid).catch(() => undefined);
              }, 120);
            }
          }
          break;
        }
        case 'session.idle': {
          const sid = parsed.properties.sessionID;
          setStatuses((current) => ({ ...current, [sid]: { type: 'idle' } }));
          setSending(false);
          if (sessionRef.current === sid) {
            window.clearTimeout(idleTimer.current);
            idleTimer.current = window.setTimeout(() => {
              if (sessionRef.current !== sid) return;
              void loadSession(sid).catch(() => undefined);
              void refreshChildren(sid);
            }, 120);
          }
          break;
        }
        case 'session.error': {
          const { sessionID: sid, error: cause } = parsed.properties;
          if (sid && sessionRef.current !== sid) break;
          setError(errorText(cause));
          setSending(false);
          break;
        }
        case 'todo.updated': {
          if (sessionRef.current !== parsed.properties.sessionID) break;
          setTodos(parsed.properties.todos);
          break;
        }
        case 'session.diff': {
          if (sessionRef.current !== parsed.properties.sessionID) break;
          setDiffs(parsed.properties.diff);
          break;
        }
        case 'permission.updated':
        case 'permission.asked' as any: {
          const raw = (parsed as any).properties;
          const permission = {
            ...raw,
            title:
              raw.title ||
              `${raw.permission || raw.type || 'permission'} ${(raw.patterns || []).join(', ')}`.trim(),
          } as PermissionRequest;
          if (autoApproveRef.current) {
            void api
              .replyPermission(permission.sessionID, permission.id, 'once')
              .catch(() => undefined);
          } else {
            setPermissions((current) =>
              current.some((item) => item.id === permission.id)
                ? current
                : [...current, permission],
            );
          }
          break;
        }
        case 'permission.replied': {
          const { permissionID } = parsed.properties;
          setPermissions((current) => current.filter((item) => item.id !== permissionID));
          break;
        }
        case 'file.edited': {
          const current = sessionRef.current;
          if (!current) break;
          window.clearTimeout(diffTimer.current);
          diffTimer.current = window.setTimeout(() => {
            if (sessionRef.current !== current) return;
            void refreshDiff(current);
            void refreshGit();
          }, 700);
          break;
        }
        default:
          break;
      }
    };

    return () => {
      source.close();
      window.clearTimeout(diffTimer.current);
      window.clearTimeout(idleTimer.current);
    };
  }, [auth, loadSession, refreshChildren, refreshDiff, refreshGit, selectSession, setSessionID]);

  useEffect(() => {
    const stored = localStorage.getItem('agent-web:auto-approve');
    if (stored === '1') setAutoApproveState(true);
  }, []);

  const setAutoApprove = useCallback((value: boolean) => {
    setAutoApproveState(value);
    localStorage.setItem('agent-web:auto-approve', value ? '1' : '0');
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      await api.login(username, password);
      await bootstrap();
    },
    [bootstrap],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setAuthState('required');
  }, []);

  const createSession = useCallback(async () => {
    const created = await api.createSession();
    setSessions((current) => upsertSession(current, created));
    await selectSession(created.id);
    return created;
  }, [selectSession]);

  const send = useCallback(
    async (text: string, files: { mime: string; filename?: string; url: string }[] = []) => {
      const trimmed = text.trim();
      if (!trimmed && files.length === 0) return;
      setError(null);
      setSending(true);

      let id = sessionRef.current;
      try {
        if (!id) {
          const created = await api.createSession(
            trimmed ? trimmed.slice(0, 70) : undefined,
          );
          id = created.id;
          setSessionID(id);
          setSessions((current) => upsertSession(current, created));
        }
        const parts: PromptPart[] = [];
        if (trimmed) parts.push({ type: 'text', text: trimmed });
        for (const file of files) {
          parts.push({ type: 'file', mime: file.mime, filename: file.filename, url: file.url });
        }
        const selection = model.providerID
          ? { providerID: model.providerID, modelID: model.modelID }
          : undefined;
        await api.prompt(id, {
          model: selection,
          agent: ENGINE === 'agy' ? 'agy' : 'build',
          variant: model.variant || undefined,
          parts,
        });
      } catch (err) {
        setSending(false);
        setError(errorText(err));
      }
    },
    [model, setSessionID],
  );

  const abort = useCallback(async () => {
    const id = sessionRef.current;
    if (!id) return;
    try {
      await api.abort(id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }, []);

  useEffect(() => {
    // Catch permission requests missed by the event stream (e.g. emitted while
    // the page was backgrounded) so a tool never waits forever.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void api.pendingPermissions().then((list) => {
        for (const raw of list) {
          if (sessionRef.current && raw.sessionID !== sessionRef.current) continue;
          if (autoApproveRef.current) {
            void api.replyPermission(raw.sessionID, raw.id, 'once').catch(() => undefined);
          } else {
            const permission = {
              ...raw,
              title: raw.title || `${raw.permission} ${(raw.patterns || []).join(', ')}`.trim(),
            } as PermissionRequest;
            setPermissions((current) =>
              current.some((item) => item.id === permission.id) ? current : [...current, permission],
            );
          }
        }
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  const replyPermission = useCallback(
    async (permission: PermissionRequest, response: 'once' | 'always' | 'reject') => {
      setPermissions((current) => current.filter((item) => item.id !== permission.id));
      try {
        await api.replyPermission(permission.sessionID, permission.id, response);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id);
      setSessions((current) => current.filter((session) => session.id !== id));
      if (sessionRef.current === id) await selectSession(null);
    },
    [selectSession],
  );

  const renameSession = useCallback(async (id: string, title: string) => {
    const updated = await api.renameSession(id, title);
    setSessions((current) => upsertSession(current, updated));
  }, []);

  const forkSession = useCallback(
    async (id: string, messageID?: string) => {
      const created = await api.fork(id, messageID);
      setSessions((current) => upsertSession(current, created));
      await selectSession(created.id);
      return created;
    },
    [selectSession],
  );

  const selectModel = useCallback(
    (providerID: string, modelID: string) => {
      const candidate = findModel(providersRef.current?.providers ?? null, providerID, modelID);
      if (!candidate) return;
      setModel({
        providerID,
        modelID,
        variant: preferredVariant(candidate, model.variant),
      });
    },
    [model.variant, setModel],
  );

  const selectVariant = useCallback(
    (variant: string) => {
      setModel({ ...model, variant });
    },
    [model, setModel],
  );

  const selectedSession = sessions.find((item) => item.id === sessionID) ?? null;
  const status = sessionID ? statuses[sessionID] : undefined;
  const busy = sending || status?.type === 'busy' || status?.type === 'retry';
  const selectedModel = findModel(
    providers?.providers ?? null,
    model.providerID,
    model.modelID,
  );

  return {
    auth,
    connection,
    sessions,
    sessionID,
    session: selectedSession,
    statuses,
    messages,
    status,
    busy,
    todos,
    diffs,
    children,
    permissions,
    providers,
    agents,
    pathInfo,
    vcs,
    gitFiles,
    model,
    selectedModel,
    autoApprove,
    error,
    login,
    logout,
    retry: bootstrap,
    selectSession,
    createSession,
    send,
    abort,
    replyPermission,
    deleteSession,
    renameSession,
    forkSession,
    selectModel,
    selectVariant,
    setAutoApprove,
    refreshDiff,
    refreshGit,
    clearError: () => setError(null),
  };
}

export type AgentController = ReturnType<typeof useAgent>;
export type { AgentSession, AgentProvider, MessageWithParts };
