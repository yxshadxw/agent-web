export type OrcaAgent = {
  id: string;
  orcaSessionId: string | null;
  agent: string;
  kind?: 'chat' | 'terminal' | null;
  state: string;
  title: string;
  prompt: string;
  role?: 'coordinator' | 'worker' | null;
  worktreeId: string;
  repo: string;
  path: string;
  branch: string;
  terminalHandle: string | null;
  terminalTitle: string | null;
  terminalPreview: string;
  terminalConnected: boolean;
  updatedAt: number | null;
  interrupted: boolean;
};

export type OrcaWorktree = {
  id: string;
  repoId: string;
  repo: string;
  projectId: string | null;
  path: string;
  displayName: string;
  branch: string;
  status: string;
  isMainWorktree: boolean;
  isArchived: boolean;
  lastActivityAt: number | null;
  liveTerminalCount: number;
  preview: string;
  agents: OrcaAgent[];
};

export type OrcaProject = {
  id: string;
  repo: string;
  worktrees: OrcaWorktree[];
};

export type OrcaOverview = {
  ok: boolean;
  fetchedAt: string;
  host: string;
  currentPath: string;
  projects: OrcaProject[];
  worktrees: OrcaWorktree[];
  agents: OrcaAgent[];
  counts: {
    projects: number;
    worktrees: number;
    agents: number;
    working: number;
  };
};

export type FreebuffUsage = {
  ok: boolean;
  configured: boolean;
  plan?: 'free' | 'paid';
  hasSubscription?: boolean;
  fallbackToALaCarte?: boolean;
  apiCredits?: {
    remaining: number;
    usage: number;
    breakdown: Record<string, number>;
    nextResetAt: string | null;
    autoTopupEnabled: boolean;
  };
  planHoursAvailable?: boolean;
  note?: string;
  error?: string;
  fetchedAt: string;
};

export type TranscriptEntry = {
  kind: string;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
  name?: string;
  state?: string;
  detail?: string;
  label?: string;
  tool?: string;
  oldText?: string;
  newText?: string;
  diff?: string;
};

export type TranscriptPayload = {
  ok: boolean;
  orcaSessionId?: string;
  kind?: string | null;
  agent?: string | null;
  source?: string;
  state?: string | null;
  entries: TranscriptEntry[];
  limited?: boolean;
  fetchedAt?: string;
  error?: string;
};

export type TerminalSnapshot = {
  ok: boolean;
  handle: string;
  status: string;
  source: string;
  tail: string[];
  nextCursor: string | number | null;
  oldestCursor: string | number | null;
  latestCursor: string | number | null;
  truncated: boolean;
  limited: boolean;
  returnedLineCount: number;
  fetchedAt: string;
  error?: string;
};

export type FreebuffSessionEntry =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string; at?: string }
  | { kind: 'thinking'; text: string; at?: string }
  | {
      kind: 'tool';
      name: string;
      command: string;
      output?: string;
      running?: boolean;
      at?: string;
    };

export type FreebuffSessionPayload = {
  ok: boolean;
  chatId?: string;
  updatedAt?: number;
  state?: string;
  entries: FreebuffSessionEntry[];
  truncated?: boolean;
  fetchedAt?: string;
  error?: string;
};

export type GithubRun = {
  databaseId: number;
  status: string;
  conclusion: string | null;
  workflowName: string;
  headBranch: string;
  event: string;
  url: string;
  createdAt: string;
  displayTitle?: string;
};

export type GithubWorkflow = {
  id: number;
  name: string;
  state: string;
  path: string;
};

export type GithubInfo = {
  ok: boolean;
  connected: boolean;
  owner?: string;
  repo?: string;
  slug?: string;
  url?: string;
  actionsUrl?: string;
  account?: {
    login: string | null;
    name: string | null;
    url: string | null;
    avatarUrl: string | null;
  } | null;
  branch?: string;
  defaultBranch?: string;
  ahead?: number | null;
  behind?: number | null;
  dirty?: number;
  latestRun?: GithubRun | null;
  workflows?: GithubWorkflow[];
  path?: string;
  error?: string;
  fetchedAt?: string;
};

export type WorktreeDiffPayload = {
  ok: boolean;
  path?: string;
  branch?: string;
  files: { path: string; added: number; removed: number; status: 'added' | 'deleted' | 'modified' }[];
  diffs: { file: string; before: string; after: string; additions: number; deletions: number }[];
  error?: string;
  fetchedAt?: string;
};

export type InstructionsInfo = {
  ok: boolean;
  path: string;
  file: string;
  exists: boolean;
  content: string;
  error?: string;
};

export type MemoryInfo = {
  ok: boolean;
  path: string;
  recent: string;
  output?: string;
  synced?: boolean;
  error?: string | null;
  fetchedAt: string;
};

export type DeskMessage = {
  id: string;
  at: string | null;
  type: string;
  priority: string | null;
  subject: string;
  text: string;
  fromId: string | null;
  fromName: string;
  toId: string | null;
  toName: string;
  handled: boolean;
};

export type MessagePayload = {
  ok: boolean;
  messages: DeskMessage[];
  agents?: OrcaAgent[];
  source?: string;
  warning?: string;
  error?: string;
};

export type TerminalCreateResult = {
  ok: boolean;
  handle: string;
  title: string;
  path: string;
  overview: OrcaOverview;
  error?: string;
};

export type FreebuffContinueResult = TerminalCreateResult & {
  previousHandle: string | null;
  chatId?: string | null;
  warning?: string | null;
};

export type AttachmentResult = {
  ok: boolean;
  path: string;
  name: string;
  size: number;
  error?: string;
};

export type CommitResult = {
  ok: boolean;
  committed?: boolean;
  pushed?: boolean;
  commit?: { hash: string; message: string };
  files?: number;
  pushError?: string | null;
  conflictNotice?: { notified: boolean; coordinator?: string; reason?: string } | null;
  error?: string;
};

export type LaunchResult = {
  ok: boolean;
  team?: boolean;
  coordinator?: {
    ok: boolean;
    index: number;
    role: string;
    agent: string;
    path: string;
    isolate: boolean;
    handle?: string | null;
    sessionId?: string | null;
    kind?: string | null;
    surface?: string | null;
    worktreeId?: string | null;
    error?: string;
  } | null;
  launches: {
    ok: boolean;
    index: number;
    role?: string;
    agent: string;
    path: string;
    isolate: boolean;
    handle?: string | null;
    sessionId?: string | null;
    kind?: string | null;
    surface?: string | null;
    worktreeId?: string | null;
    error?: string;
  }[];
  overview?: OrcaOverview | null;
  error?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/orca-api${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = `요청에 실패했어요 (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error || body?.message || message;
    } catch {
      // ignore non-json errors
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const orcaApi = {
  overview: (refresh = false) =>
    request<OrcaOverview>(`/overview${refresh ? '?refresh=1' : ''}`),
  usage: (refresh = false) =>
    request<FreebuffUsage>(`/usage${refresh ? '?refresh=1' : ''}`),
  terminal: (handle: string, options?: { screen?: boolean; limit?: number }) =>
    request<TerminalSnapshot>(
      `/terminal?handle=${encodeURIComponent(handle)}&screen=${options?.screen === false ? '0' : '1'}&limit=${options?.limit ?? 800}`,
    ),
  transcript: (sessionId: string) =>
    request<TranscriptPayload>(`/transcript?sessionId=${encodeURIComponent(sessionId)}`),
  freebuffSession: (path: string, kind?: string, since?: number, handle?: string) =>
    request<FreebuffSessionPayload>(
      `/freebuff/session?path=${encodeURIComponent(path)}${kind ? `&kind=${kind}` : ''}${since ? `&since=${since}` : ''}${handle ? `&handle=${encodeURIComponent(handle)}` : ''}`,
    ),
  models: (agent: string) =>
    request<{ ok: boolean; models: { id: string; label: string }[] }>(
      `/models?agent=${encodeURIComponent(agent)}`,
    ),
  addProject: (path: string) =>
    request<{ ok: boolean; path: string; kind: string; overview: OrcaOverview }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  launch: (body: {
    path: string;
    prompt: string;
    blank?: boolean;
    agent: string;
    count: number;
    isolate: boolean;
    team?: boolean;
    workerModel?: string;
    coordinatorModel?: string;
  }) =>
    request<LaunchResult>('/launch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeWorktree: (id: string) =>
    request<{ ok: boolean; overview: OrcaOverview }>('/worktrees', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    }),
  hideProject: (id: string) =>
    request<{ ok: boolean; overview: OrcaOverview }>('/projects/hide', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  github: (path: string) =>
    request<GithubInfo>(`/github?path=${encodeURIComponent(path)}`),
  worktreeDiff: (path: string) =>
    request<WorktreeDiffPayload>(`/worktree/diff?path=${encodeURIComponent(path)}`),
  runWorkflow: (path: string, workflowId: number, ref: string) =>
    request<{ ok: boolean; message: string; error?: string }>('/github/run', {
      method: 'POST',
      body: JSON.stringify({ path, workflowId, ref }),
    }),
  commitAndPush: (path: string, message: string, push: boolean, pushOnly = false) =>
    request<CommitResult>('/github/commit', {
      method: 'POST',
      body: JSON.stringify({ path, message, push, pushOnly }),
    }),
  sendTerminalKey: (handle: string, key: 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' | 'tab') =>
    request<{ ok: boolean; handle: string; key: string; error?: string }>('/terminal/key', {
      method: 'POST',
      body: JSON.stringify({ handle, key }),
    }),
  closeTerminal: (handle: string) =>
    request<{ ok: boolean; handle: string; overview: OrcaOverview }>('/terminal/close', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),
  interrupt: (handle: string) =>
    request<{ ok: boolean; handle: string; error?: string }>('/interrupt', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),
  sendTerminal: (
    handle: string,
    text: string,
    options?: { focus?: boolean; waitSubmit?: boolean },
  ) =>
    request<{ ok: boolean; handle: string; error?: string }>('/terminal/send', {
      method: 'POST',
      body: JSON.stringify({ handle, text, ...options }),
    }),
  createTerminal: (path: string, title?: string) =>
    request<TerminalCreateResult>('/terminal/create', {
      method: 'POST',
      body: JSON.stringify({ path, title }),
    }),
  continueFreebuff: (body: { path: string; handle?: string | null; chatId?: string | null }) =>
    request<FreebuffContinueResult>('/freebuff/continue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  attach: (file: { name: string; data: string }) =>
    request<AttachmentResult>('/attachment', {
      method: 'POST',
      body: JSON.stringify(file),
    }),
  attachUrl: (url: string) =>
    request<AttachmentResult>('/attachment', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  instructions: (path: string) =>
    request<InstructionsInfo>(`/instructions?path=${encodeURIComponent(path)}`),
  saveInstructions: (path: string, content: string) =>
    request<InstructionsInfo>('/instructions', {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),
  memory: (path: string) =>
    request<MemoryInfo>(`/memory?path=${encodeURIComponent(path)}`),
  messages: () => request<MessagePayload>('/messages'),
  sendMessage: (body: { text: string; toId: string; fromId?: string }) =>
    request<MessagePayload>('/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  syncMemory: (path: string) =>
    request<MemoryInfo>('/memory/sync', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
};
