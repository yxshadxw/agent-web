import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUp,
  BookOpen,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clipboard,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  FolderPlus,
  FolderTree,
  Gauge,
  Github,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  Info,
  Loader2,
  Menu,
  MessageSquare,
  Minus,
  MoreHorizontal,
  PanelRight,
  Play,
  Pause,
  Pin,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Sparkles,
  SquareTerminal,
  Terminal,
  Upload,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { File as AgentFile, FileDiff } from '@opencode-ai/sdk';
import { useAgyQuota } from '../hooks/useQuota';
import { QuotaSection, type CodexQuotaSnapshot } from './Quota';
import { InfoPanel, type TeamTreeAgent } from './InfoPanel';
import { ToolDiff, hasDiffSignal } from './ToolDiff';
import {
  orcaApi,
  type FreebuffSessionEntry,
  type FreebuffSessionPayload,
  type GithubInfo,
  type GithubWorkflow,
  type InstructionsInfo,
  type DeskMessage,
  type MemoryInfo,
  type MessagePayload,
  type OrcaAgent,
  type OrcaOverview,
  type OrcaProject,
  type OrcaWorktree,
  type TerminalSnapshot,
  type TranscriptEntry,
  type TranscriptPayload,
  type WorktreeDiffPayload,
} from '../lib/orca';
import {
  cleanUserMessage,
  highlightQuotaWarningsHtml,
  isQuotaWarningLine,
  relativeTime,
  shortPath,
  type InfoTab,
  type PinnedFile,
} from '../data';
import { AmbientBackdrop } from './AmbientBackdrop';
import { LiquidBackdrop } from './LiquidBackdrop';
import { TodoBar, deriveTodosFromTools } from './TodoBar';
import { Sheet } from './Sheet';
import { SelectMenu } from './SelectMenu';

type DeskTab = 'agents' | 'github' | 'instructions' | 'memory' | 'messages';
type RunMode = 'single' | 'parallel';

type QuickPick = {
  id: string;
  kind: 'worktree' | 'agent';
  title: string;
  meta: string;
  search: string;
  path: string;
  state: string;
  agent?: OrcaAgent;
};
const DESK_STATE_KEY = 'agent-web:parallel-desk-view:v1';

function readDeskState(): { path: string | null; tab: DeskTab; handle: string | null } {
  try {
    // The desk has to survive a full app/browser restart, not just an F5.
    // Read the previous session-only value as a one-time migration.
    const stored =
      localStorage.getItem(DESK_STATE_KEY) ||
      sessionStorage.getItem(DESK_STATE_KEY) ||
      '{}';
    const parsed = JSON.parse(stored) as {
      path?: unknown;
      tab?: unknown;
      handle?: unknown;
    };
    return {
      path: typeof parsed.path === 'string' ? parsed.path : null,
      tab: TABS.some((item) => item.id === parsed.tab) ? (parsed.tab as DeskTab) : 'agents',
      handle: typeof parsed.handle === 'string' ? parsed.handle : null,
    };
  } catch {
    return { path: null, tab: 'agents', handle: null };
  }
}

const AGENT_OPTIONS = [
  { id: 'freebuff', label: 'Freebuff', short: 'FB', cls: 'freebuff' },
  { id: 'opencode', label: 'OpenCode', short: 'OC', cls: 'opencode' },
  { id: 'antigravity', label: 'Agy', short: 'AGY', cls: 'agy' },
  { id: 'claude', label: 'Claude', short: 'CL', cls: 'claude' },
  { id: 'codex', label: 'Codex', short: 'CX', cls: 'codex' },
];

type ModelOption = { id: string; label: string };

// Model ids are taken from the local agent CLIs. Freebuff does not accept a
// launch-time model, so it is intentionally absent here.
function resolveModelLabel(
  id: string,
  agentType?: string,
  extraModels: ModelOption[] = [],
): string {
  if (!id) return id;
  const scoped = agentType ? MODEL_OPTIONS[agentType] || [] : [];
  const allStatic = Object.values(MODEL_OPTIONS).flat();
  const hit =
    extraModels.find((m) => m.id === id) ||
    scoped.find((m) => m.id === id) ||
    allStatic.find((m) => m.id === id);
  if (hit) return hit.label;
  const colonIdx = id.lastIndexOf(':');
  if (colonIdx > 0) {
    const baseId = id.slice(0, colonIdx);
    const eff = id.slice(colonIdx + 1);
    const baseHit =
      extraModels.find((m) => m.id === baseId) ||
      scoped.find((m) => m.id === baseId) ||
      allStatic.find((m) => m.id === baseId);
    if (baseHit) {
      const bare = baseHit.label.replace(/\s*\((Low|Medium|High|XHigh|Max|Ultra)\)\s*$/i, '').trim();
      const cap = eff.charAt(0).toUpperCase() + eff.slice(1).toLowerCase();
      return `${bare} (${cap})`;
    }
  }
  return id;
}

const AGY_MODEL_LABEL = (id: string) => resolveModelLabel(id);

const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  opencode: [
    { id: 'opencode/big-pickle', label: 'Big Pickle' },
    { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash Free' },
    { id: 'opencode/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
    { id: 'opencode/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { id: 'opencode/beam-free', label: 'Beam' },
    { id: 'opencode/flint-40b-free', label: 'Flint 40B' },
    { id: 'opencode/gemini-4-neon', label: 'Gemini 4 Neon' },
    { id: 'opencode/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
    { id: 'opencode/gemini-4-argon', label: 'Gemini 4 Argon' },
    { id: 'opencode/gemini-4-carbon', label: 'Gemini 4 Carbon' },
    { id: 'opencode/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'opencode/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'opencode/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { id: 'opencode/claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'opencode/claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'opencode/claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { id: 'opencode/claude-fable-5-2', label: 'Claude Fable 5.2' },
    { id: 'opencode/hy4-flash-free', label: 'HY4 Flash' },
    { id: 'opencode/iceman-free', label: 'Iceman' },
    { id: 'opencode/longcat-2.5-free', label: 'LongCat 2.5' },
    { id: 'opencode/mimo-v2.6-flash-free', label: 'MiMo V2.6 Flash' },
    { id: 'opencode/nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning' },
    { id: 'opencode/nemotron-3.5-super-vl-free', label: 'Nemotron 3.5 Super VL' },
    { id: 'opencode/tidepool-alpha-free', label: 'Tidepool Alpha' },
  ],
  antigravity: [
    { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
    { id: 'gemini-4-neon-xhigh', label: 'Gemini 4 Neon (XHigh)' },
    { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
    { id: 'gemini-4-neon-low', label: 'Gemini 4 Neon (Low)' },
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
    { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
    { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
    { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
    { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)' },
    { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
    { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
    { id: 'gemini-pro-orchestrator-neon', label: 'Orchestrator (Neon)' },
    { id: 'gemini-pro-orchestrator-g1-pro', label: 'Orchestrator (Argon)' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)' },
    { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
    { id: 'claude-sonnet-5-5-low', label: 'Claude Sonnet 5.5 (Low)' },
    { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ],
  claude: [
    { id: 'claude-opus-4-6-medium', label: 'Claude Opus 4.6 (Medium)' },
    { id: 'claude-opus-4-6-high', label: 'Claude Opus 4.6 (High)' },
    { id: 'claude-opus-4-6-max', label: 'Claude Opus 4.6 (Max)' },
    { id: 'claude-sonnet-4-6-low', label: 'Claude Sonnet 4.6 (Low)' },
    { id: 'claude-sonnet-4-6-medium', label: 'Claude Sonnet 4.6 (Medium)' },
    { id: 'claude-sonnet-4-6-high', label: 'Claude Sonnet 4.6 (High)' },
    { id: 'claude-haiku-4-5-low', label: 'Claude Haiku 4.5 (Low)' },
    { id: 'claude-haiku-4-5-medium', label: 'Claude Haiku 4.5 (Medium)' },
  ],
  codex: [
    { id: 'gpt-6-luna-medium', label: 'GPT-6 Luna (Medium)' },
    { id: 'gpt-6-luna-high', label: 'GPT-6 Luna (High)' },
    { id: 'gpt-6-luna-xhigh', label: 'GPT-6 Luna (XHigh)' },
    { id: 'gpt-5.6-terra-high', label: 'GPT-5.6 Terra (High)' },
    { id: 'gpt-5.6-terra-max', label: 'GPT-5.6 Terra (Max)' },
    { id: 'gpt-5.6-luna-medium', label: 'GPT-5.6 Luna (Medium)' },
    { id: 'gpt-5.6-luna-high', label: 'GPT-5.6 Luna (High)' },
  ],
};

function modelOptions(agent: string) {
  return MODEL_OPTIONS[agent] ?? [];
}

function modelName(agent: string, id: string) {
  if (!id) return '기본 모델';
  return modelOptions(agent).find((option) => option.id === id)?.label ?? id;
}

const TABS: { id: DeskTab; label: string }[] = [
  { id: 'agents', label: '에이전트' },
  { id: 'github', label: 'GitHub' },
  { id: 'instructions', label: '지침서' },
  { id: 'memory', label: '기억' },
  { id: 'messages', label: '메시지' },
];

function agentMeta(id: string) {
  if (id === 'terminal') {
    return { id, label: 'Shell', short: 'SH', cls: 'shell' };
  }
  return AGENT_OPTIONS.find((item) => item.id === id) || {
    id,
    label: id || 'Agent',
    short: (id || 'A').slice(0, 2).toUpperCase(),
    cls: 'other',
  };
}

const AGENT_LOGO: Record<string, string> = {
  antigravity: '/antigravity.svg',
  agy: '/antigravity.svg',
  freebuff: '/freebuff.svg',
  opencode: '/opencode.svg',
  gemini: '/gemini.png',
  codex: '/codex.svg',
  claude: '/claude.svg',
};

function AgentMark({ id, short }: { id: string; short: string }) {
  const logo = AGENT_LOGO[id];
  if (logo) return <img src={logo} alt="" className="agent-logo" />;
  return <>{short}</>;
}

function stateLabel(state: string) {
  if (state === 'working') return '작업 중';
  if (state === 'waiting') return '응답 대기';
  if (state === 'done') return '완료';
  if (state === 'error') return '오류';
  return '대기';
}

function runLabel(run: GithubInfo['latestRun']) {
  if (!run) return '실행 기록 없음';
  if (run.status === 'in_progress') return '실행 중';
  if (run.status === 'queued') return '대기열';
  if (run.conclusion === 'success') return '성공';
  if (run.conclusion === 'failure') return '실패';
  if (run.conclusion === 'cancelled') return '취소됨';
  return run.conclusion || run.status;
}

function isRunGood(run: GithubInfo['latestRun']) {
  return run?.conclusion === 'success';
}

function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  return { notice, notify };
}

function cleanAgentTitle(title?: string | null) {
  const raw = (title || '').trim();
  if (!raw) return '새 세션';
  const stripped = raw
    .replace(/^\[Agent Desk 공통 지시[^\]]*\]\s*[-—:]*\s*/i, '')
    .replace(/^\[(워커|코디네이터|지휘자)\s*역할\]\s*/i, '')
    .replace(/^────\s*From:[^\n]*\n?/i, '')
    .replace(/^Subject:\s*/i, '')
    .trim();
  return stripped || raw;
}

function formatWorktreeName(worktree: Pick<OrcaWorktree, 'displayName' | 'branch' | 'path'>) {
  const raw = (worktree.displayName || worktree.branch || worktree.path.split('/').pop() || 'worktree')
    .trim()
    .replace(/^(?:orca|wt)[/_-]+/i, '');
  if (/^(main|master)$/i.test(raw)) return '메인 작업공간';
  const parallelMatch = raw.match(/^(?:parallel|agent-desk)-([a-z0-9]+)-(\d+)$/i);
  if (parallelMatch) return `병렬 작업 #${parallelMatch[2]} (${parallelMatch[1]})`;
  return raw || '작업공간';
}

function worktreeSubMeta(worktree: Pick<OrcaWorktree, 'displayName' | 'branch' | 'path'>) {
  const pathText = shortPath(worktree.path);
  if (worktree.branch && worktree.branch !== worktree.displayName) {
    return `${worktree.branch} · ${pathText}`;
  }
  return pathText;
}

function freebuffRunningCommand(lines: string[]) {
  const cleaned = lines.map((line) => line.replace(/[│┃]/g, ' ').trimEnd());
  let start = -1;
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    if (/^\s*\$ /.test(cleaned[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  const parts: string[] = [];
  for (let i = start; i < cleaned.length; i += 1) {
    const line = cleaned[i].replace(/^\s*\$ /, '').trim();
    if (!line) continue;
    if (i > start && /^working\.\.\./i.test(line)) break;
    const timeout = line.match(/^(.*?)\s*\(\d+m timeout\)/i);
    if (timeout) {
      if (timeout[1].trim()) parts.push(timeout[1].trim());
      break;
    }
    if (/^[─╭╮╰╯]+$/.test(line)) continue;
    parts.push(line);
  }

  const command = parts.join(' ').replace(/\s+/g, ' ').trim();
  return command ? command.slice(0, 600) : null;
}

function freebuffEntryKey(entry: FreebuffSessionEntry, index: number) {
  return entry.id || `fb-${entry.kind}-${index}`;
}

function mergeFreebuffEntry(
  previous: FreebuffSessionEntry,
  next: FreebuffSessionEntry,
): FreebuffSessionEntry {
  if (previous.kind !== next.kind) return next;
  if (previous.kind === 'tool' && next.kind === 'tool') {
    const oldOutput = previous.output || '';
    const nextOutput = next.output || '';
    if (oldOutput.length > nextOutput.length && oldOutput.startsWith(nextOutput)) {
      return { ...next, output: previous.output };
    }
    return next;
  }
  if ('text' in previous && 'text' in next) {
    // A chat-store flush can briefly expose a prefix of a block. Keep the
    // longest text already rendered for that entry instead of flashing back.
    if (previous.text.length > next.text.length && previous.text.startsWith(next.text)) {
      return { ...next, text: previous.text };
    }
  }
  return next;
}

function mergeFreebuffEntries(
  previous: FreebuffSessionEntry[],
  next: FreebuffSessionEntry[],
): FreebuffSessionEntry[] {
  if (!previous.length) return next;
  const previousById = new Map(
    previous.flatMap((entry) => (entry.id ? [[entry.id, entry] as const] : [])),
  );
  return next.map((entry) => {
    const old = entry.id ? previousById.get(entry.id) : undefined;
    return old ? mergeFreebuffEntry(old, entry) : entry;
  });
}

export function ParallelDesk({ onClose }: { onClose: () => void }) {
  const initialDeskState = useRef(readDeskState());
  const [overview, setOverview] = useState<OrcaOverview | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialDeskState.current.path);
  const [tab, setTab] = useState<DeskTab>(initialDeskState.current.tab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sideOpen, setSideOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [logAgent, setLogAgent] = useState<OrcaAgent | null>(null);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedCoords, setExpandedCoords] = useState<Record<string, boolean>>({});
  const [deskInfoOpen, setDeskInfoOpen] = useState(false);
  const [deskInfoTab, setDeskInfoTab] = useState<InfoTab>('info');
  const [deskMenuOpen, setDeskMenuOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [quickIndex, setQuickIndex] = useState(0);
  const deskMenuRef = useRef<HTMLDivElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const [deskWorktreeDiff, setDeskWorktreeDiff] = useState<WorktreeDiffPayload | null>(null);
  const [deskPins, setDeskPins] = useState<PinnedFile[]>([]);
  const [deskCodexQuota, setDeskCodexQuota] = useState<CodexQuotaSnapshot | null>(null);
  const { quota: deskAgyQuota, loading: deskQuotaLoading, refresh: refreshDeskQuota } = useAgyQuota(true);
  const toggleCoord = (id: string) =>
    setExpandedCoords((prev) => ({ ...prev, [id]: !prev[id] }));
  const { notice, notify } = useNotice();
  const loadingRef = useRef(false);
  const restoreLogRef = useRef(initialDeskState.current.handle);
  const deskReadyRef = useRef(false);

  const load = useCallback(
    async (force = false, quiet = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!quiet) setLoading(true);
      try {
        const next = await orcaApi.overview(force);
        const restoredHandle = restoreLogRef.current;
        if (restoredHandle) {
          restoreLogRef.current = null;
          const restored = next.agents.find(
            (agent) => agent.terminalHandle === restoredHandle || agent.id === restoredHandle,
          );
          if (restored) setLogAgent(restored);
        }
        deskReadyRef.current = true;
        setOverview(next);
        setError(null);
        setSelectedPath((current) => {
          if (current && next.worktrees.some((worktree) => worktree.path === current)) {
            return current;
          }
          return (
            next.worktrees.find((worktree) => worktree.path === next.currentPath)?.path ||
            next.worktrees[0]?.path ||
            null
          );
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Orca 런타임에 연결하지 못했습니다.');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false, true);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!deskReadyRef.current) return;
    try {
      localStorage.setItem(
        DESK_STATE_KEY,
        JSON.stringify({
          path: selectedPath,
          tab,
          handle: logAgent?.terminalHandle || null,
        }),
      );
      sessionStorage.removeItem(DESK_STATE_KEY);
    } catch {
      // Private browsing can reject storage; the desk still works.
    }
  }, [logAgent, selectedPath, tab]);

  const selectedWorktree = useMemo(
    () => overview?.worktrees.find((worktree) => worktree.path === selectedPath) || null,
    [overview, selectedPath],
  );

  useEffect(() => {
    if (!selectedWorktree?.path) {
      setDeskPins([]);
      return;
    }
    try {
      const raw = localStorage.getItem(`agent-web:desk-pins:${selectedWorktree.path}`);
      setDeskPins(raw ? (JSON.parse(raw) as PinnedFile[]) : []);
    } catch {
      setDeskPins([]);
    }
  }, [selectedWorktree?.path]);

  const toggleDeskPin = useCallback(
    (file: PinnedFile) => {
      const scope = selectedWorktree?.path || 'desk';
      setDeskPins((current) => {
        const exists = current.some((p) => p.path === file.path);
        const next = exists ? current.filter((p) => p.path !== file.path) : [...current, file];
        try {
          localStorage.setItem(`agent-web:desk-pins:${scope}`, JSON.stringify(next));
        } catch {
          // ignore
        }
        notify(exists ? '핀을 해제했어요' : '파일을 핀했어요');
        return next;
      });
    },
    [notify, selectedWorktree?.path],
  );

  useEffect(() => {
    if (!deskMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (deskMenuRef.current && !deskMenuRef.current.contains(e.target as Node)) {
        setDeskMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDeskMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [deskMenuOpen]);

  useEffect(() => {
    if (!deskInfoOpen && !deskMenuOpen) return;
    if (!selectedWorktree?.path) return;
    let alive = true;
    void orcaApi
      .worktreeDiff(selectedWorktree.path)
      .then((res) => {
        if (alive && res.ok) setDeskWorktreeDiff(res);
      })
      .catch(() => undefined);
    void fetch('/codex-api/quota', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && (data.primary || data.secondary || data.plan)) {
          setDeskCodexQuota(data as CodexQuotaSnapshot);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [deskInfoOpen, deskMenuOpen, selectedWorktree?.path]);

  const openDeskInfo = useCallback(
    (nextTab: InfoTab = 'info') => {
      setDeskInfoTab(nextTab);
      setDeskInfoOpen(true);
      setDeskMenuOpen(false);
      refreshDeskQuota();
    },
    [refreshDeskQuota],
  );

  const deskTeamAgents = useMemo<TeamTreeAgent[]>(() => {
    const list = selectedWorktree?.agents || overview?.agents || [];
    return list.map((item) => ({
      id: item.id,
      name: cleanAgentTitle(item.title),
      model: `${agentMeta(item.agent).label} CLI`,
      role: item.role ?? null,
      agent: item.agent,
      state: item.state,
      onSelect: () => {
        setDeskInfoOpen(false);
        setLogAgent(item);
      },
    }));
  }, [overview?.agents, selectedWorktree?.agents]);

  const openWorktreeTerminal = useCallback(async () => {
    if (!selectedWorktree || openingTerminal) return;
    setOpeningTerminal(true);
    try {
      const result = await orcaApi.createTerminal(
        selectedWorktree.path,
        `${selectedWorktree.displayName} · shell`,
      );
      setOverview(result.overview);
      setLogAgent({
        id: `terminal:${result.handle}`,
        orcaSessionId: null,
        agent: 'terminal',
        state: 'done',
        title: result.title || `${selectedWorktree.displayName} 터미널`,
        prompt: '',
        worktreeId: selectedWorktree.id,
        repo: selectedWorktree.repo,
        path: selectedWorktree.path,
        branch: selectedWorktree.branch,
        terminalHandle: result.handle,
        terminalTitle: result.title,
        terminalPreview: '',
        terminalConnected: true,
        updatedAt: Date.now(),
        interrupted: false,
      });
      notify(`${selectedWorktree.displayName} 워크트리에 셸 터미널을 열었어요`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '터미널을 열지 못했어요');
    } finally {
      setOpeningTerminal(false);
    }
  }, [notify, openingTerminal, selectedWorktree]);

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (overview?.projects || [])
      .map((project) => ({
        ...project,
        worktrees: project.worktrees.filter((worktree) => {
          if (!needle) return true;
          return (
            project.repo.toLowerCase().includes(needle) ||
            worktree.displayName.toLowerCase().includes(needle) ||
            worktree.branch.toLowerCase().includes(needle) ||
            worktree.path.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((project) => project.worktrees.length > 0);
  }, [overview, query]);

  const quickPicks = useMemo<QuickPick[]>(() => {
    const picks: QuickPick[] = [];
    for (const project of overview?.projects || []) {
      for (const worktree of project.worktrees) {
        const worktreeName = formatWorktreeName(worktree);
        const worktreeMeta = `${project.repo} · ${worktree.branch || 'detached'} · 에이전트 ${worktree.agents.length}`;
        picks.push({
          id: `worktree:${worktree.path}`,
          kind: 'worktree',
          title: worktreeName,
          meta: worktreeMeta,
          search: [project.repo, worktree.displayName, worktree.branch, worktree.path, worktreeMeta]
            .join(' ')
            .toLowerCase(),
          path: worktree.path,
          state: worktree.status,
        });
        for (const agent of worktree.agents) {
          const meta = agentMeta(agent.agent);
          const role = roleLabel(agent.role);
          const title = cleanAgentTitle(agent.title);
          const agentMetaText = `${meta.label}${role ? ` · ${role}` : ''} · ${project.repo} / ${worktreeName}`;
          picks.push({
            id: `agent:${agent.id}`,
            kind: 'agent',
            title,
            meta: agentMetaText,
            search: [
              project.repo,
              worktree.displayName,
              worktree.branch,
              worktree.path,
              meta.label,
              role,
              agent.title,
              agent.state,
            ]
              .join(' ')
              .toLowerCase(),
            path: worktree.path,
            state: agent.state,
            agent,
          });
        }
      }
    }
    return picks;
  }, [overview]);

  const quickResults = useMemo(() => {
    const needle = quickQuery.trim().toLowerCase();
    const list = needle
      ? quickPicks.filter((pick) => pick.search.includes(needle))
      : quickPicks.filter((pick) => pick.kind === 'worktree');
    return list.slice(0, 60);
  }, [quickPicks, quickQuery]);

  const openQuickSwitch = () => {
    setDeskMenuOpen(false);
    setQuickQuery('');
    setQuickIndex(0);
    setQuickOpen(true);
  };

  const chooseQuickPick = (pick: QuickPick) => {
    setQuickOpen(false);
    setQuickQuery('');
    setSelectedPath(pick.path);
    setSideOpen(false);
    if (pick.agent) setLogAgent(pick.agent);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setDeskMenuOpen(false);
      setQuickQuery('');
      setQuickIndex(0);
      setQuickOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!quickOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setQuickOpen(false);
    };
    const timer = window.setTimeout(() => quickInputRef.current?.focus(), 20);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [quickOpen]);

  useEffect(() => {
    setQuickIndex(0);
  }, [quickQuery]);

  useEffect(() => {
    setQuickIndex((current) => Math.min(current, Math.max(0, quickResults.length - 1)));
  }, [quickResults.length]);

  useEffect(() => {
    if (!quickOpen) return;
    document
      .getElementById(`desk-quick-option-${quickIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [quickIndex, quickOpen]);

  const openLog = useCallback((agent: OrcaAgent) => {
    setLogAgent(agent);
  }, []);

  const removeWorktree = useCallback(
    async (worktree: OrcaWorktree) => {
      if (removingId) return;
      if (
        !window.confirm(
          `'${worktree.displayName}' 워크트리를 Orca에서 삭제할까요?\n\n커밋하지 않은 변경도 사라질 수 있습니다. 실행 중인 터미널은 함께 종료됩니다.`,
        )
      ) {
        return;
      }
      setRemovingId(worktree.id);
      try {
        const result = await orcaApi.removeWorktree(worktree.id);
        setOverview(result.overview);
        setSelectedPath((current) => (current === worktree.path ? null : current));
        notify('워크트리를 삭제했어요');
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : '워크트리를 삭제하지 못했어요');
      } finally {
        setRemovingId(null);
      }
    },
    [notify, removingId],
  );

  const hideProject = useCallback(
    async (project: OrcaProject) => {
      if (removingId) return;
      if (
        !window.confirm(
          `'${project.repo}' 프로젝트를 Orca 사이드바에서 숨길까요?\n\n실행 중인 터미널과 파일은 유지됩니다.`,
        )
      ) {
        return;
      }
      setRemovingId(project.id);
      try {
        const result = await orcaApi.hideProject(project.id);
        setOverview(result.overview);
        setSelectedPath((current) =>
          result.overview.worktrees.some((worktree) => worktree.path === current)
            ? current
            : null,
        );
        notify('프로젝트를 사이드바에서 숨겼어요');
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : '프로젝트를 숨기지 못했어요');
      } finally {
        setRemovingId(null);
      }
    },
    [notify, removingId],
  );

  if (loading && !overview) {
    return (
      <div className="desk-stage">
        <div className="desk-boot">
          <span className="desk-boot-mark">
            <Boxes size={22} />
          </span>
          <div>
            <strong>병렬 데스크를 여는 중</strong>
            <span>Orca 워크트리와 에이전트를 불러옵니다.</span>
          </div>
          <Loader2 size={18} className="spin" />
          <button className="desk-icon" onClick={onClose} aria-label="채팅으로 돌아가기">
            <ArrowLeft size={18} />
          </button>
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="desk-stage">
        <div className="desk-boot desk-boot-error">
          <AlertTriangle size={22} />
          <div>
            <strong>Orca 런타임에 연결할 수 없어요</strong>
            <span>{error}</span>
          </div>
          <button className="desk-btn" onClick={() => void load(true)}>
            <RefreshCw size={14} /> 다시 연결
          </button>
          <button className="desk-icon" onClick={onClose} aria-label="채팅으로 돌아가기">
            <ArrowLeft size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="desk-stage">
      <div
        className="desk-shell"
        onPointerMove={(event) => {
          const el = event.currentTarget;
          const rect = el.getBoundingClientRect();
          el.style.setProperty(
            '--desk-px',
            `${(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100).toFixed(2)}%`,
          );
          el.style.setProperty(
            '--desk-py',
            `${(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100).toFixed(2)}%`,
          );
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.setProperty('--desk-px', '50%');
          event.currentTarget.style.setProperty('--desk-py', '18%');
        }}
      >
        <AmbientBackdrop className="is-desk" />
        <LiquidBackdrop className="is-desk" />
        <div
          className={`desk-side-backdrop ${sideOpen ? 'open' : ''}`}
          onClick={() => setSideOpen(false)}
        />
        <aside className={`desk-sidebar ${sideOpen ? 'open' : ''}`}>
          <div className="desk-side-head">
            <div className="desk-side-brand">
              <span className="desk-brand-mark">
                <Boxes size={17} />
              </span>
              <div>
                <strong>Parallel Desk</strong>
                <span>Orca · {overview?.host || 'local'}</span>
              </div>
            </div>
            <button className="desk-icon desk-side-close" onClick={() => setSideOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="desk-side-summary">
            <span>
              <b>{overview?.counts.projects || 0}</b> 프로젝트
            </span>
            <span>
              <b>{overview?.counts.worktrees || 0}</b> 워크트리
            </span>
            <span className="hot">
              <b>{overview?.counts.working || 0}</b> 작업 중
            </span>
          </div>

          <label className="desk-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="프로젝트 · 워크트리 검색"
              spellCheck={false}
            />
          </label>

          <div className="desk-project-list">
            {projects.length === 0 && (
              <div className="desk-side-empty">
                <Search size={20} />
                <span>검색 결과가 없어요.</span>
              </div>
            )}
            {projects.map((project) => (
              <section className="desk-project" key={project.id}>
                <div className="desk-project-head">
                  <span className="desk-project-name">
                    <span className="desk-project-ico">{project.repo.slice(0, 1).toUpperCase()}</span>
                    {project.repo}
                  </span>
                  <span className="desk-project-count">{project.worktrees.length}</span>
                  <button
                    className="desk-project-hide"
                    onClick={() => void hideProject(project)}
                    disabled={removingId === project.id}
                    title="프로젝트 숨기기"
                    aria-label={`${project.repo} 프로젝트 숨기기`}
                  >
                    {removingId === project.id ? (
                      <Loader2 size={11} className="spin" />
                    ) : (
                      <Trash2 size={11} />
                    )}
                  </button>
                </div>
                <div className="desk-worktrees">
                  {project.worktrees.map((worktree) => {
                    const working = worktree.agents.filter(
                      (agent) => agent.state === 'working',
                    ).length;
                    return (
                      <div className="desk-worktree-group" key={worktree.path}>
                        <div
                          className={`desk-worktree ${
                            selectedPath === worktree.path ? 'active' : ''
                          }`}
                        >
                          <button
                            className="desk-worktree-open"
                            onClick={() => {
                              setSelectedPath(worktree.path);
                              setSideOpen(false);
                            }}
                          >
                            <span className={`desk-status-dot ${worktree.status}`} />
                            <span className="desk-worktree-main">
                              <span className="desk-worktree-name">
                                {formatWorktreeName(worktree)}
                                {worktree.isMainWorktree &&
                                  worktree.displayName.toLowerCase() !== 'main' && <em>main</em>}
                              </span>
                              <span className="desk-worktree-meta">
                                {worktreeSubMeta(worktree)}
                              </span>
                            </span>
                            {working > 0 ? (
                              <span className="desk-worktree-live">{working}</span>
                            ) : (
                              <span className="desk-worktree-agents">{worktree.agents.length}</span>
                            )}
                          </button>
                          <button
                            className="desk-worktree-del"
                            onClick={() => void removeWorktree(worktree)}
                            disabled={removingId === worktree.id}
                            title="워크트리 삭제"
                            aria-label={`${worktree.displayName} 워크트리 삭제`}
                          >
                            {removingId === worktree.id ? (
                              <Loader2 size={11} className="spin" />
                            ) : (
                              <Trash2 size={11} />
                            )}
                          </button>
                        </div>
                        {worktree.agents.length > 0 && (() => {
                          const coordinators = worktree.agents.filter((a) => a.role === 'coordinator');
                          const localWorkers = worktree.agents.filter((a) => a.role === 'worker');
                          const projectWorkers = project.worktrees.flatMap((w) =>
                            w.agents.filter((a) => a.role === 'worker'),
                          );
                          const worktreeWorkers =
                            coordinators.length > 0 && projectWorkers.length > localWorkers.length
                              ? projectWorkers
                              : localWorkers;
                          const singles = worktree.agents.filter((a) => !a.role);
                          const renderAgentRow = (agent: OrcaAgent, extraSub?: string) => {
                            const meta = agentMeta(agent.agent);
                            const badgeText = agent.role
                              ? roleLabel(agent.role)
                              : agent.agent === 'terminal'
                                ? '터미널'
                                : '단일 워커';
                            const badgeCls = agent.role || (agent.agent === 'terminal' ? 'shell' : 'single');
                            return (
                              <button
                                type="button"
                                className={`desk-side-agent ${agent.state}`}
                                key={agent.id}
                                onClick={() => {
                                  setSelectedPath(agent.path || worktree.path);
                                  openLog(agent);
                                  setSideOpen(false);
                                }}
                                title={agent.title}
                              >
                                <span className={`desk-agent-badge desk-side-agent-badge ${meta.cls}`}>
                                  <AgentMark id={meta.id} short={meta.short} />
                                </span>
                                <span className="desk-side-agent-main">
                                  <strong>{meta.label}</strong>
                                  <small>{extraSub ? `${extraSub} · ${cleanAgentTitle(agent.title)}` : cleanAgentTitle(agent.title)}</small>
                                </span>
                                <span className={`desk-role ${badgeCls}`}>{badgeText}</span>
                              </button>
                            );
                          };
                          return (
                            <div
                              className="desk-side-agents"
                              aria-label={`${worktree.displayName} 에이전트`}
                            >
                              {coordinators.map((coord, coordIdx) => {
                                const childWorkers = coordIdx === 0 ? worktreeWorkers : [];
                                const isOpen = Boolean(expandedCoords[coord.id]);
                                return (
                                  <div key={coord.id} className="desk-side-coord-group">
                                    {renderAgentRow(coord)}
                                    {childWorkers.length > 0 && (
                                      <div className="desk-side-workers-wrap">
                                        <button
                                          type="button"
                                          className="desk-side-workers-toggle"
                                          onClick={() => toggleCoord(coord.id)}
                                          aria-expanded={isOpen}
                                        >
                                          <ChevronRight size={11} className={isOpen ? 'rot' : ''} />
                                          <span>워커 {childWorkers.length}명</span>
                                        </button>
                                        {isOpen && (
                                          <div className="desk-side-worker-children">
                                            {childWorkers.map((worker) =>
                                              renderAgentRow(
                                                worker,
                                                worker.branch && worker.branch !== worktree.branch
                                                  ? worker.branch
                                                  : formatWorktreeName({
                                                      displayName: worker.path.split('/').pop() || '',
                                                      branch: worker.branch,
                                                      path: worker.path,
                                                    }),
                                              ),
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {coordinators.length === 0 && worktreeWorkers.map((w) => renderAgentRow(w))}
                              {singles.map((s) => renderAgentRow(s))}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="desk-side-foot">
            <button className="desk-add-project" onClick={() => setAddOpen(true)}>
              <FolderPlus size={16} />
              프로젝트 추가
            </button>
          </div>
        </aside>

        <main className="desk-main">
          <header className="desk-top">
            <button
              className="desk-icon desk-mobile-menu"
              onClick={() => setSideOpen(true)}
              aria-label="워크스페이스 열기"
            >
              <Menu size={20} />
            </button>
            <div className="desk-main-title">
              <span className="desk-title-mark">
                <GitCommitHorizontal size={15} />
              </span>
              <div>
                <strong>병렬 작업 콘솔</strong>
                <span>{overview?.counts.working || 0}개 에이전트가 움직이는 중</span>
              </div>
            </div>
            <div className="desk-top-actions" ref={deskMenuRef}>
              <button
                type="button"
                className="desk-icon desk-quick-trigger"
                onClick={openQuickSwitch}
                aria-label="빠른 이동"
                title="빠른 이동 (Ctrl/Cmd+K)"
              >
                <Search size={17} />
              </button>
              <button
                className="desk-icon"
                onClick={() => void load(true)}
                aria-label="새로고침"
                title="새로고침"
              >
                <RefreshCw size={17} className={loading ? 'spin' : ''} />
              </button>
              <button
                className="desk-btn chat-back"
                onClick={onClose}
                aria-label="일반 채팅으로 돌아가기"
                title="일반 채팅으로 돌아가기"
              >
                <ArrowLeft size={14} />
                <span>일반 채팅</span>
              </button>
              <button
                type="button"
                className={`desk-icon ${deskMenuOpen ? 'is-active' : ''}`}
                onClick={() => setDeskMenuOpen((v) => !v)}
                aria-label="더 보기"
                aria-expanded={deskMenuOpen}
                title="더 보기"
              >
                <MoreHorizontal size={18} />
              </button>
              <button
                type="button"
                className="desk-icon boxed"
                onClick={() => openDeskInfo('info')}
                aria-label="정보 패널 열기"
                title="정보 · 파일 · Diff · Git · Pin"
              >
                <PanelRight size={17} />
              </button>
              {deskMenuOpen && (
                <div className="menu-pop desk-menu-pop" role="menu">
                  <button className="menu-item" role="menuitem" onClick={() => openDeskInfo('info')}>
                    <span className="menu-ico"><Info size={16} /></span>
                    <span>정보</span>
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => openDeskInfo('files')}>
                    <span className="menu-ico"><FolderTree size={16} /></span>
                    <span>파일</span>
                    {deskWorktreeDiff?.diffs.length ? (
                      <span className="menu-badge">{deskWorktreeDiff.diffs.length}</span>
                    ) : null}
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => openDeskInfo('diff')}>
                    <span className="menu-ico"><GitCompareArrows size={16} /></span>
                    <span>Diff</span>
                    {deskWorktreeDiff?.diffs.length ? (
                      <span className="menu-badge">{deskWorktreeDiff.diffs.length}</span>
                    ) : null}
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => openDeskInfo('git')}>
                    <span className="menu-ico"><GitBranch size={16} /></span>
                    <span>Git</span>
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => openDeskInfo('pin')}>
                    <span className="menu-ico"><Pin size={16} /></span>
                    <span>Pin</span>
                    {deskPins.length ? <span className="menu-badge">{deskPins.length}</span> : null}
                  </button>
                  <button className="menu-item with-sep" role="menuitem" onClick={() => openDeskInfo('info')}>
                    <span className="menu-ico"><Gauge size={16} /></span>
                    <span>컨텍스트</span>
                  </button>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => openDeskInfo('info')}
                  >
                    <span className="menu-ico"><Activity size={16} /></span>
                    <span>사용량 한도</span>
                  </button>
                  <button
                    className="menu-item with-sep"
                    role="menuitem"
                    disabled={!selectedWorktree || openingTerminal}
                    onClick={() => {
                      setDeskMenuOpen(false);
                      void openWorktreeTerminal();
                    }}
                  >
                    <span className="menu-ico"><Plus size={16} /></span>
                    <span>새 셸 터미널</span>
                  </button>
                  <button
                    className="menu-item"
                    role="menuitem"
                    disabled={!selectedWorktree}
                    onClick={() => {
                      setDeskMenuOpen(false);
                      if (!selectedWorktree) return;
                      void navigator.clipboard.writeText(selectedWorktree.path).then(
                        () => notify('워크트리 경로를 복사했어요'),
                        () => notify('복사할 수 없어요'),
                      );
                    }}
                  >
                    <span className="menu-ico"><Copy size={16} /></span>
                    <span>워크트리 경로 복사</span>
                  </button>
                  <button
                    className="menu-item with-sep"
                    role="menuitem"
                    onClick={openQuickSwitch}
                  >
                    <span className="menu-ico"><Search size={16} /></span>
                    <span>빠른 이동</span>
                    <span className="menu-kbd">Ctrl K</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="desk-scroll">
            {error && overview && (
              <div className="desk-banner" role="alert">
                <AlertTriangle size={15} />
                <span>{error}</span>
                <button onClick={() => void load(true)}>다시 시도</button>
              </div>
            )}

            <div className="desk-context">
              <div className="desk-context-main">
                <div className="desk-crumb">
                  <span>{selectedWorktree?.repo || '프로젝트'}</span>
                  <ChevronRight size={13} />
                  <strong>{selectedWorktree ? formatWorktreeName(selectedWorktree) : '워크트리 선택'}</strong>
                  {selectedWorktree?.isMainWorktree &&
                    selectedWorktree.displayName.toLowerCase() !== 'main' && <em>main</em>}
                </div>
                <div className="desk-path" title={selectedWorktree?.path}>
                  <Terminal size={12} />
                  {selectedWorktree ? shortPath(selectedWorktree.path) : '왼쪽에서 워크트리를 선택하세요'}
                </div>
              </div>
              {selectedWorktree && (
                <div className="desk-context-meta">
                  <span>
                    <GitBranch size={13} />
                    {selectedWorktree.branch || 'detached'}
                  </span>
                  <span>
                    <Bot size={13} />
                    {selectedWorktree.agents.length} agents
                  </span>
                  {selectedWorktree.liveTerminalCount > 0 && (
                    <span className="live">
                      <CircleDot size={11} />
                      {selectedWorktree.liveTerminalCount} terminals
                    </span>
                  )}
                  <button
                    type="button"
                    className="desk-btn ghost small desk-open-terminal"
                    onClick={() => void openWorktreeTerminal()}
                    disabled={openingTerminal}
                    title="이 워크트리에 셸 터미널 열기"
                  >
                    {openingTerminal ? (
                      <Loader2 size={12} className="spin" />
                    ) : (
                      <SquareTerminal size={12} />
                    )}
                    {openingTerminal ? '여는 중' : '터미널'}
                  </button>
                </div>
              )}
            </div>

            <nav className="desk-tabs" role="tablist">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={tab === item.id}
                  className={`desk-tab ${tab === item.id ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === 'agents' && (
                    <span>{selectedWorktree?.agents.length || 0}</span>
                  )}
                </button>
              ))}
            </nav>

            {tab === 'agents' && selectedWorktree && (
              <AgentsTab
                worktree={selectedWorktree}
                overview={overview}
                onLog={openLog}
                onOverview={setOverview}
                notify={notify}
              />
            )}
            {tab === 'agents' && !selectedWorktree && (
              <DeskEmpty
                icon={<Boxes size={26} />}
                title="워크트리를 선택해 주세요"
                text="왼쪽에서 프로젝트를 고르면 에이전트를 띄울 수 있어요."
              />
            )}
            {tab === 'github' && selectedWorktree && (
              <GithubTab path={selectedWorktree.path} notify={notify} />
            )}
            {tab === 'instructions' && selectedWorktree && (
              <InstructionsTab path={selectedWorktree.path} notify={notify} />
            )}
            {tab === 'memory' && selectedWorktree && (
              <MemoryTab path={selectedWorktree.path} notify={notify} />
            )}
            {tab === 'messages' && <MessagesTab overview={overview} notify={notify} />}
            {(tab === 'github' || tab === 'instructions' || tab === 'memory') &&
              !selectedWorktree && (
                <DeskEmpty
                  icon={<Boxes size={26} />}
                  title="워크트리를 선택해 주세요"
                  text="프로젝트를 선택하면 이 탭을 사용할 수 있어요."
                />
              )}
          </div>
        </main>
      </div>

      {quickOpen &&
        createPortal(
          <div
            className="desk-quick-layer"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setQuickOpen(false);
            }}
          >
            <section
              className="desk-quick"
              role="dialog"
              aria-modal="true"
              aria-label="빠른 이동"
            >
              <div className="desk-quick-head">
                <span className="desk-quick-mark">
                  <Search size={16} />
                </span>
                <input
                  ref={quickInputRef}
                  value={quickQuery}
                  onChange={(event) => setQuickQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setQuickIndex((current) =>
                        Math.min(Math.max(0, quickResults.length - 1), current + 1),
                      );
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setQuickIndex((current) => Math.max(0, current - 1));
                    } else if (event.key === 'Enter') {
                      event.preventDefault();
                      const pick = quickResults[quickIndex];
                      if (pick) chooseQuickPick(pick);
                    }
                  }}
                  placeholder="워크트리나 에이전트 검색"
                  aria-label="빠른 이동 검색"
                  aria-controls="desk-quick-list"
                  aria-activedescendant={
                    quickResults[quickIndex] ? `desk-quick-option-${quickIndex}` : undefined
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <kbd>ESC</kbd>
                <button
                  type="button"
                  className="desk-quick-close"
                  onClick={() => setQuickOpen(false)}
                  aria-label="빠른 이동 닫기"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="desk-quick-meta">
                <span>{quickQuery.trim() ? '검색 결과' : '워크트리'}</span>
                <span>{quickResults.length}개</span>
              </div>
              <div
                className="desk-quick-list"
                id="desk-quick-list"
                role="listbox"
                aria-label="빠른 이동 결과"
              >
                {quickResults.length === 0 && (
                  <div className="desk-quick-empty">
                    <Search size={18} />
                    <strong>일치하는 항목이 없어요</strong>
                    <span>프로젝트, 워크트리, 에이전트 이름으로 검색해 보세요.</span>
                  </div>
                )}
                {quickResults.map((pick, index) => {
                  const meta = pick.agent ? agentMeta(pick.agent.agent) : null;
                  return (
                    <button
                      type="button"
                      key={pick.id}
                      id={`desk-quick-option-${index}`}
                      role="option"
                      aria-selected={index === quickIndex}
                      className={`desk-quick-option ${index === quickIndex ? 'active' : ''}`}
                      onMouseEnter={() => setQuickIndex(index)}
                      onClick={() => chooseQuickPick(pick)}
                    >
                      <span className={`desk-quick-pick ${meta?.cls || 'worktree'}`}>
                        {meta ? (
                          <AgentMark id={meta.id} short={meta.short} />
                        ) : (
                          <GitBranch size={16} />
                        )}
                      </span>
                      <span className="desk-quick-copy">
                        <strong>{pick.title}</strong>
                        <small>{pick.meta}</small>
                      </span>
                      {pick.kind === 'agent' ? (
                        <span className={`desk-state ${pick.state}`}>
                          {stateLabel(pick.state)}
                        </span>
                      ) : (
                        <span className={`desk-status-dot ${pick.state}`} />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="desk-quick-foot">
                <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
                <span><kbd>Enter</kbd> 열기</span>
                <span><kbd>Ctrl</kbd><kbd>K</kbd> 닫기</span>
              </div>
            </section>
          </div>,
          document.body,
        )}

      {logAgent && (
        <LogDrawer
          key={logAgent.terminalHandle || logAgent.id}
          agent={logAgent}
          overview={overview}
          notify={notify}
          onClose={() => setLogAgent(null)}
          onOverview={setOverview}
          onContinue={setLogAgent}
          onOpenInfo={openDeskInfo}
        />
      )}
      {(() => {
        const activeDeskAgent =
          logAgent ||
          selectedWorktree?.agents?.find((item) => item.state === 'working') ||
          selectedWorktree?.agents?.[0] ||
          null;
        return (
          <InfoPanel
            open={deskInfoOpen}
            tab={deskInfoTab}
            onTab={setDeskInfoTab}
            onClose={() => setDeskInfoOpen(false)}
            session={
              selectedWorktree
                ? {
                    id:
                      activeDeskAgent?.orcaSessionId ||
                      activeDeskAgent?.terminalHandle ||
                      selectedWorktree.id,
                    title: activeDeskAgent
                      ? cleanAgentTitle(activeDeskAgent.title)
                      : formatWorktreeName(selectedWorktree),
                    directory: selectedWorktree.path,
                    agent: activeDeskAgent?.agent || 'orca',
                    time: {
                      created:
                        activeDeskAgent?.updatedAt ||
                        selectedWorktree.lastActivityAt ||
                        Date.now(),
                      updated:
                        activeDeskAgent?.updatedAt ||
                        selectedWorktree.lastActivityAt ||
                        Date.now(),
                    },
                    version: '1',
                    projectID: selectedWorktree.repoId || selectedWorktree.repo,
                  }
                : null
            }
            parentSession={null}
            messages={[]}
            diffs={(deskWorktreeDiff?.diffs || []) as FileDiff[]}
            children={[]}
            gitFiles={(deskWorktreeDiff?.files || []) as AgentFile[]}
            vcs={
              deskWorktreeDiff?.branch || selectedWorktree?.branch
                ? {
                    branch: deskWorktreeDiff?.branch || selectedWorktree?.branch,
                    default_branch: 'main',
                  }
                : null
            }
            pathInfo={
              selectedWorktree
                ? {
                    state: '',
                    config: '',
                    worktree: selectedWorktree.path,
                    directory: selectedWorktree.path,
                  }
                : null
            }
            providers={activeDeskAgent ? agentMeta(activeDeskAgent.agent).label : 'Orca'}
            modelName={
              activeDeskAgent
                ? resolveModelLabel(
                    (activeDeskAgent.orcaSessionId &&
                      localStorage.getItem(`agyModel:${activeDeskAgent.orcaSessionId}`)) ||
                      '',
                    activeDeskAgent.agent,
                  ) || agentMeta(activeDeskAgent.agent).label
                : selectedWorktree
                  ? formatWorktreeName(selectedWorktree)
                  : '워크트리'
            }
            contextLimit={0}
            activeEngine={activeDeskAgent?.agent || 'agy'}
            codexQuota={deskCodexQuota}
            teamAgents={deskTeamAgents}
            quota={deskAgyQuota}
            quotaLoading={deskQuotaLoading}
            onRefreshQuota={refreshDeskQuota}
            pinned={deskPins}
            onTogglePin={toggleDeskPin}
            onOpenSession={() => undefined}
            onToast={notify}
          />
        );
      })()}
      {addOpen && (
        <AddProjectDialog
          onClose={() => setAddOpen(false)}
          onAdded={(next, path) => {
            setOverview(next);
            if (path) setSelectedPath(path);
            setAddOpen(false);
            notify('프로젝트를 Orca에 추가했어요');
          }}
        />
      )}

      {notice && (
        <div className="desk-notice" role="status">
          <Check size={13} strokeWidth={3} />
          {notice}
        </div>
      )}
    </div>
  );
}

function DeskEmpty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="desk-empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function AgentsTab({
  worktree,
  overview,
  onLog,
  onOverview,
  notify,
}: {
  worktree: OrcaWorktree;
  overview: OrcaOverview | null;
  onLog: (agent: OrcaAgent) => void;
  onOverview: (overview: OrcaOverview) => void;
  notify: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [agentType, setAgentType] = useState('freebuff');
  const [count, setCount] = useState(1);
  const [runMode, setRunMode] = useState<RunMode>('single');
  const [advanced, setAdvanced] = useState(false);
  const [isolate, setIsolate] = useState(true);
  const [workerModel, setWorkerModel] = useState('');
  const [coordinatorModel, setCoordinatorModel] = useState('');
  const [modelTarget, setModelTarget] = useState<'worker' | 'coordinator' | null>(null);
  const [launching, setLaunching] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [liveModels, setLiveModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    setWorkerModel('');
    setCoordinatorModel('');
    setModelTarget(null);
  }, [agentType]);

  useEffect(() => {
    let alive = true;
    void orcaApi
      .models(agentType)
      .then((res) => {
        if (alive && res.ok && Array.isArray(res.models)) {
          setLiveModels(res.models);
        } else if (alive) {
          setLiveModels([]);
        }
      })
      .catch(() => {
        if (alive) setLiveModels([]);
      });
    return () => {
      alive = false;
    };
  }, [agentType, worktree.path, modelTarget]);

  const launchModelOptions = useMemo(() => {
    const base = modelOptions(agentType);
    if (!liveModels.length) return base;
    const seen = new Set(liveModels.map((m) => m.id));
    return [...liveModels, ...base.filter((m) => !seen.has(m.id))];
  }, [agentType, liveModels]);

  const chooseModel = (id: string) => {
    if (modelTarget === 'coordinator') setCoordinatorModel(id);
    if (modelTarget === 'worker') setWorkerModel(id);
    setModelTarget(null);
  };

  const isSingle = runMode === 'single';
  const running = worktree.agents.filter((agent) => agent.state === 'working').length;
  const waiting = worktree.agents.filter((agent) => agent.state === 'waiting').length;

  const launch = async (blank = false) => {
    if ((!blank && !prompt.trim()) || launching) return;
    setLaunching(true);
    setFailures([]);
    try {
      const result = await orcaApi.launch({
        path: worktree.path,
        prompt: blank ? '' : prompt.trim(),
        blank,
        agent: agentType,
        count: blank ? 1 : isSingle ? 1 : count,
        isolate,
        team: blank ? false : !isSingle,
        workerModel: isSingle ? workerModel.trim() : '',
        coordinatorModel: isSingle ? '' : coordinatorModel.trim(),
      });
      if (result.overview) onOverview(result.overview);
      const launched = [
        ...result.launches,
        ...(result.coordinator ? [result.coordinator] : []),
      ];
      const success = launched.filter((launchResult) => launchResult.ok);
      if (success.length) {
        const nowTs = String(Date.now() - 5000);
        for (const item of success) {
          const key = item.handle || item.sessionId;
          if (key) localStorage.setItem(`sessionSince:${key}`, nowTs);
        }
        const launchedModel = isSingle ? workerModel.trim() : coordinatorModel.trim();
        if (agentType === 'antigravity' && launchedModel) {
          for (const item of success) {
            if (item.sessionId) {
              localStorage.setItem(`agyModel:${item.sessionId}`, launchedModel);
            }
          }
        }
        if (!blank) setPrompt('');
        notify(
          blank
            ? `${agentMeta(agentType).label} 세션을 열었어요`
            : isSingle
              ? `${agentMeta(agentType).label} 1명을 ${
                  isolate ? '새 워크트리에서 ' : ''
                }시작했어요`
              : `코디네이터 1명을 ${
                  isolate ? '새 워크트리에서 ' : ''
                }시작했어요 · 워커 ${count}명 지시`,
        );
        // "세션만 열기" should land in the session that was just created,
        // not leave the user on the launch form.
        if (blank) {
          const launched = success[0];
          const launchedChat = launched.surface === 'chat' || launched.kind === 'chat';
          const overviewAgents = result.overview?.agents || overview?.agents || [];
          const nextAgent = overviewAgents.find(
            (item) =>
              (launched.sessionId && item.orcaSessionId === launched.sessionId) ||
              (launched.handle && item.terminalHandle === launched.handle),
          );
          if (nextAgent) {
            onLog(nextAgent);
          } else if (launched.sessionId || (!launchedChat && launched.handle)) {
            const sessionId = launched.sessionId || null;
            const handle = launchedChat ? null : launched.handle || null;
            const label = agentMeta(agentType).label;
            onLog({
              id: `launch:${sessionId || handle}`,
              orcaSessionId: sessionId,
              agent: launched.agent || agentType,
              kind: launchedChat ? 'chat' : 'terminal',
              state: 'working',
              title: launchedChat ? `${label} 채팅` : `${label} 세션`,
              prompt: '',
              worktreeId: launched.worktreeId || worktree.id,
              repo: worktree.repo,
              path: launched.path || worktree.path,
              branch: worktree.branch,
              terminalHandle: handle,
              terminalTitle: launchedChat ? null : `${label} 세션`,
              terminalPreview: '',
              terminalConnected: Boolean(handle),
              updatedAt: Date.now(),
              interrupted: false,
            });
          }
        }
      }
      const failed = launched
        .filter((launchResult) => !launchResult.ok)
        .map((launchResult) => launchResult.error || '실행에 실패했어요');
      if (failed.length) {
        setFailures(failed);
        if (!success.length) notify(failed[0]);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '에이전트를 시작하지 못했어요';
      setFailures([message]);
      notify(message);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="desk-agents">
      <section className="desk-launch">
        <div className="desk-launch-head">
          <div>
            <span className="desk-kicker">
              <Zap size={12} /> {isSingle ? 'SINGLE RUN' : 'PARALLEL RUN'}
            </span>
            <h2>{isSingle ? '단일 에이전트로 시작' : '작업 한 줄로 팀 시작'}</h2>
            <p>
              {isSingle
                ? `코디네이터 없이 ${agentMeta(agentType).label} 1명이 맡은 작업을 끝까지 진행합니다.`
                : `코디네이터 1명이 워커 ${count}명에게 일을 나눠 진행합니다.`}{' '}
              {isolate
                ? '새 워크트리에서 실행해 파일 충돌을 줄입니다.'
                : '같은 워크트리에서 실행합니다. 파일 충돌에 주의하세요.'}
              {agentType === 'antigravity' && ' Agy 세션은 CLI 대신 채팅으로 열립니다.'}
            </p>
          </div>
          <span className="desk-launch-count">
            <b>1</b>
            <span>{isSingle ? '에이전트' : `코디네이터 · 워커 ${count}명`}</span>
          </span>
        </div>

        <div className="desk-run-modes" role="tablist" aria-label="실행 방식">
          <button
            type="button"
            role="tab"
            aria-selected={isSingle}
            className={`desk-run-mode ${isSingle ? 'active' : ''}`}
            onClick={() => setRunMode('single')}
          >
            <span className="desk-run-mode-ico"><Bot size={14} /></span>
            <span>
              <b>단일</b>
              <small>코디네이터 없이 1명</small>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isSingle}
            className={`desk-run-mode ${!isSingle ? 'active' : ''}`}
            onClick={() => setRunMode('parallel')}
          >
            <span className="desk-run-mode-ico"><Boxes size={14} /></span>
            <span>
              <b>병렬</b>
              <small>코디네이터가 관리</small>
            </span>
          </button>
        </div>

        <textarea
          className="desk-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void launch();
            }
          }}
          placeholder="예: 로그인 화면의 접근성 문제를 찾아 고치고 테스트까지 실행해줘"
          rows={3}
        />

        <div className="desk-launch-controls simple">
          <div className="desk-launch-summary">
            <span className={`desk-agent-badge ${agentMeta(agentType).cls}`}>
              <AgentMark id={agentType} short={agentMeta(agentType).short} />
            </span>
            <span className="desk-launch-summary-main">
              <b>{agentMeta(agentType).label}</b>
              <small>
                {isSingle ? '코디네이터 없이 단독 실행' : `코디네이터 1 · 워커 ${count}명 지시`}
                {isolate ? ' · 새 워크트리' : ' · 현재 워크트리'}
              </small>
            </span>
            <button
              type="button"
              className={`desk-advanced-toggle ${advanced ? 'open' : ''}`}
              onClick={() => setAdvanced((value) => !value)}
              aria-expanded={advanced}
            >
              {advanced ? '간단히' : '고급 설정'}
              <ChevronDown size={13} />
            </button>
          </div>

          {advanced && (
            <div className="desk-advanced">
              <div className="desk-agent-choice" role="group" aria-label="에이전트 선택">
                {AGENT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={`desk-agent-tab ${agentType === option.id ? 'active' : ''} ${option.cls}`}
                    onClick={() => setAgentType(option.id)}
                  >
                    <span><AgentMark id={option.id} short={option.short} /></span>
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="desk-advanced-row">
                {!isSingle && (
                  <>
                    <div className="desk-counter" aria-label="워커 수">
                      <button
                        onClick={() => setCount((value) => Math.max(1, value - 1))}
                        disabled={count <= 1}
                        aria-label="워커 줄이기"
                      >
                        <Minus size={13} />
                      </button>
                      <span>{count}</span>
                      <button
                        onClick={() => setCount((value) => Math.min(6, value + 1))}
                        disabled={count >= 6}
                        aria-label="워커 늘리기"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <small className="desk-counter-label">워커</small>
                  </>
                )}

                <label className="desk-check">
                  <input
                    type="checkbox"
                    checked={isolate}
                    onChange={(event) => setIsolate(event.target.checked)}
                  />
                  <span>
                    <b>새 워크트리</b>
                    <small>충돌 방지</small>
                  </span>
                </label>
              </div>

              {modelOptions(agentType).length > 0 ? (
                <div className="desk-model-row">
                  <div className="desk-model-field">
                    <span>{isSingle ? '모델' : '코디네이터 모델'}</span>
                    <button
                      type="button"
                      className="desk-model-trigger"
                      onClick={() => setModelTarget(isSingle ? 'worker' : 'coordinator')}
                      aria-haspopup="dialog"
                      aria-label={`${isSingle ? '모델' : '코디네이터 모델'} 선택: ${modelName(agentType, isSingle ? workerModel : coordinatorModel)}`}
                    >
                      <span>{modelName(agentType, isSingle ? workerModel : coordinatorModel)}</span>
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <span className="desk-model-note">
                    <ShieldCheck size={11} /> 공통 지시서 · 자율 진행
                  </span>
                </div>
              ) : (
                <div className="desk-model-row">
                  <span className="desk-model-note">
                    <ShieldCheck size={11} />{' '}
                    {agentType === 'freebuff'
                      ? 'Freebuff는 실행 시 모델을 지정할 수 없어 자체 설정을 사용합니다.'
                      : agentType === 'codex'
                        ? 'Codex는 자체 로그인과 모델 설정을 사용합니다.'
                        : '모델을 지정하지 않으면 에이전트 기본값을 사용합니다.'}
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            className="desk-launch-btn"
            onClick={() => void launch()}
            disabled={!prompt.trim() || launching}
          >
            {launching ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            {launching
              ? isSingle
                ? '시작 중…'
                : '코디네이터 시작 중…'
              : isSingle
                ? '에이전트 1명 시작'
                : '코디네이터 1명 시작'}
          </button>
          <button
            type="button"
            className="desk-session-only"
            onClick={() => void launch(true)}
            disabled={launching}
            title="명령 없이 에이전트 세션만 엽니다"
          >
            {launching ? <Loader2 size={13} className="spin" /> : <SquareTerminal size={13} />}
            세션만 열기
          </button>
        </div>
        {failures.length > 0 && (
          <div className="desk-launch-errors">
            {failures.slice(0, 3).map((failure, index) => (
              <div key={`${failure}-${index}`}>
                <AlertTriangle size={12} />
                {failure}
              </div>
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={modelTarget !== null}
        onClose={() => setModelTarget(null)}
        label={
          modelTarget === 'coordinator' ? '코디네이터 모델 선택' : '모델 선택'
        }
      >
        <div className="sheet-content model-sheet desk-model-sheet">
          <div className="sheet-head">
            <span className="sheet-title">
              {modelTarget === 'coordinator' ? '코디네이터 모델' : '모델'}
            </span>
            <span className="sheet-sub">{agentMeta(agentType).label}</span>
          </div>
          <div className="sheet-list">
            <button
              className={`sheet-row model-row ${(modelTarget === 'coordinator' ? coordinatorModel : workerModel) === '' ? 'selected' : ''}`}
              onClick={() => chooseModel('')}
            >
              <span className="model-name">기본 모델</span>
              <span className="row-provider">자동</span>
              {(modelTarget === 'coordinator' ? coordinatorModel : workerModel) === '' && (
                <span className="row-check"><Check size={12} /></span>
              )}
            </button>
            {launchModelOptions.map((option) => {
              const selected = (modelTarget === 'coordinator' ? coordinatorModel : workerModel) === option.id;
              return (
                <button
                  key={option.id}
                  className={`sheet-row model-row ${selected ? 'selected' : ''}`}
                  onClick={() => chooseModel(option.id)}
                >
                  <span className="model-name">{option.label}</span>
                  <span className="row-provider">{option.id}</span>
                  {selected && <span className="row-check"><Check size={12} /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </Sheet>

      <div className="desk-stat-row">
        <div>
          <span className="desk-stat-dot working" />
          <b>{running}</b>
          <span>작업 중</span>
        </div>
        <div>
          <span className="desk-stat-dot waiting" />
          <b>{waiting}</b>
          <span>응답 대기</span>
        </div>
        <div>
          <span className="desk-stat-dot done" />
          <b>{worktree.agents.length - running - waiting}</b>
          <span>완료 · 대기</span>
        </div>
        <div className="desk-stat-path" title={worktree.path}>
          <GitBranch size={13} />
          {worktree.branch || 'detached'}
        </div>
      </div>

      {worktree.agents.length === 0 ? (
        <DeskEmpty
          icon={<Bot size={27} />}
          title="아직 에이전트가 없어요"
          text="위에서 단일 또는 병렬 실행을 선택해 에이전트를 띄워보세요."
        />
      ) : (
        <div className="desk-agent-grid">
          {worktree.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onClick={() => onLog(agent)} />
          ))}
        </div>
      )}

      {overview && overview.agents.length > worktree.agents.length && (
        <div className="desk-other-projects">
          <div className="desk-subhead">
            <span>다른 워크트리에서 실행 중</span>
            <span>{overview.agents.length - worktree.agents.length}</span>
          </div>
          <div className="desk-mini-grid">
            {overview.agents
              .filter((agent) => agent.path !== worktree.path)
              .slice(0, 4)
              .map((agent) => (
                <button className="desk-mini-agent" key={agent.id} onClick={() => onLog(agent)}>
                  <span className={`desk-agent-badge ${agentMeta(agent.agent).cls}`}>
                    <AgentMark id={agent.agent} short={agentMeta(agent.agent).short} />
                  </span>
                  <span>
                    <b>{agentMeta(agent.agent).label}</b>
                    <small>
                      {roleLabel(agent.role) ? `${roleLabel(agent.role)} · ` : ''}
                      {agent.repo} / {shortPath(agent.path)}
                    </small>
                  </span>
                  <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function roleLabel(role: OrcaAgent['role']) {
  if (role === 'coordinator') return '지휘자';
  if (role === 'worker') return '워커';
  return '';
}

function AgentCard({ agent, onClick }: { agent: OrcaAgent; onClick: () => void }) {
  const meta = agentMeta(agent.agent);
  return (
    <button className={`desk-agent-card ${agent.state}`} onClick={onClick}>
      <div className="desk-agent-card-head">
        <span className={`desk-agent-badge ${meta.cls}`}>
          <AgentMark id={meta.id} short={meta.short} />
        </span>
        <span className="desk-agent-card-title">
          <b>{meta.label}</b>
          <small>
            {agent.kind === 'chat'
              ? 'Orca 채팅'
              : agent.terminalConnected
                ? '터미널 연결됨'
                : '터미널 없음'}
          </small>
        </span>
        {agent.role && (
          <span className={`desk-role ${agent.role}`}>{roleLabel(agent.role)}</span>
        )}
        <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
      </div>
      <strong className="desk-agent-name">{cleanAgentTitle(agent.title)}</strong>
      {agent.prompt && cleanAgentTitle(agent.prompt) !== cleanAgentTitle(agent.title) && (
        <p className="desk-agent-prompt">{cleanAgentTitle(agent.prompt)}</p>
      )}
      <div className="desk-agent-foot">
        <span>
          <Clock3 size={12} />
          {agent.updatedAt ? relativeTime(agent.updatedAt) : '방금'}
        </span>
        <span>
          {agent.kind === 'chat' ? <MessageSquare size={12} /> : <SquareTerminal size={12} />}
          {agent.kind === 'chat' ? '채팅' : '로그'}
        </span>
      </div>
    </button>
  );
}

function GithubTab({ path, notify }: { path: string; notify: (message: string) => void }) {
  const [info, setInfo] = useState<GithubInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitBusy, setCommitBusy] = useState<'commit' | 'push' | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await orcaApi.github(path);
      setInfo(next);
      setError(next.ok ? null : next.error || 'GitHub 정보를 불러오지 못했어요.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'GitHub 정보를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const runWorkflow = async (workflow: GithubWorkflow) => {
    if (!info?.branch) return;
    if (!window.confirm(`${workflow.name} 워크플로를 ${info.branch} 브랜치에서 실행할까요?`)) {
      return;
    }
    setRunning(workflow.id);
    try {
      const result = await orcaApi.runWorkflow(path, workflow.id, info.branch);
      notify(result.message || '워크플로를 시작했어요');
      window.setTimeout(() => void load(), 3000);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '워크플로를 시작하지 못했어요');
    } finally {
      setRunning(null);
    }
  };

  const commitChanges = async (push: boolean, pushOnly = false) => {
    if ((!pushOnly && !commitMessage.trim()) || commitBusy) return;
    setCommitBusy(push ? 'push' : 'commit');
    setCommitError(null);
    try {
      const result = await orcaApi.commitAndPush(
        path,
        pushOnly ? '' : commitMessage.trim(),
        push,
        pushOnly,
      );
      if (result.ok) {
        const label = result.committed ? `커밋 ${result.commit?.hash || ''}` : '푸시';
        notify(`${label}${result.pushed ? ' · 푸시 완료' : ''}`.trim());
        setCommitMessage('');
        await load();
      } else {
        const reason = result.pushError || result.error || '푸시하지 못했어요.';
        setCommitError(reason);
        if (result.conflictNotice?.notified) {
          notify(`푸시 실패 · 충돌 해결을 ${result.conflictNotice.coordinator}에게 보냈어요`);
        } else {
          notify(reason);
        }
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '커밋하지 못했어요.';
      setCommitError(message);
      notify(message);
    } finally {
      setCommitBusy(null);
    }
  };

  if (loading && !info) {
    return <DeskLoading text="GitHub 저장소와 Actions를 확인하는 중…" />;
  }

  if (!info?.connected) {
    return (
      <DeskEmpty
        icon={<Github size={27} />}
        title="GitHub 원격 저장소가 없어요"
        text={info?.error || '이 워크트리의 origin이 GitHub를 가리켜야 Actions와 CI를 사용할 수 있어요.'}
      />
    );
  }

  return (
    <div className="desk-panel-stack">
      <div className="desk-panel-head">
        <div>
          <span className="desk-kicker">
            <Github size={12} /> GITHUB
          </span>
          <h2>{info.slug}</h2>
          <p>{info.path}</p>
          {info.account?.login ? (
            <div className="desk-github-account" title={info.account.url || undefined}>
              <Github size={11} />
              @{info.account.login} 연결됨
            </div>
          ) : (
            <div className="desk-github-account" title="로컬 터미널에서 gh auth login 실행 후 새로고침하세요">
              <Github size={11} />
              GitHub 미연결 · 터미널에서 gh auth login 필요
            </div>
          )}
        </div>
        <div className="desk-panel-actions">
          <a className="desk-btn ghost" href={info.actionsUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Actions
          </a>
          <button className="desk-icon" onClick={() => void load()} aria-label="GitHub 새로고침">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="desk-banner">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <section className="desk-commit-panel">
        <div className="desk-commit-head">
          <span>
            <GitCommitHorizontal size={14} />
            커밋 & 푸시
          </span>
          <small>
            {info.branch} · 변경 {info.dirty ?? 0}개
          </small>
        </div>
        <div className="desk-commit-row">
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="커밋 메시지"
            maxLength={200}
            spellCheck={false}
          />
          <button
            className="desk-btn ghost small"
            onClick={() => void commitChanges(false)}
            disabled={!commitMessage.trim() || commitBusy !== null}
          >
            {commitBusy === 'commit' ? <Loader2 size={13} className="spin" /> : <GitCommitHorizontal size={13} />}
            커밋
          </button>
          <button
            className="desk-btn small"
            onClick={() => void commitChanges(true)}
            disabled={!commitMessage.trim() || commitBusy !== null}
          >
            {commitBusy === 'push' ? <Loader2 size={13} className="spin" /> : <GitBranch size={13} />}
            커밋 + 푸시
          </button>
          <button
            className="desk-btn ghost small"
            onClick={() => void commitChanges(true, true)}
            disabled={commitBusy !== null}
            title="커밋하지 않고 로컬 커밋을 원격에 푸시"
          >
            {commitBusy === 'push' ? <Loader2 size={13} className="spin" /> : <GitBranch size={13} />}
            푸시만
          </button>
        </div>
        <p className="desk-commit-hint">
          변경 사항이 없어도 앞선 커밋은 푸시만으로 올릴 수 있어요. 푸시가 충돌하면
          코디네이터 세션에 충돌 해결 메시지를 보냅니다. 강제 푸시는 하지 않습니다.
        </p>
        {commitError && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {commitError}
          </div>
        )}
      </section>

      <div className="desk-ci-grid">
        <div className="desk-ci-card">
          <span className="desk-ci-label">기준 브랜치 대비</span>
          <strong className={info.ahead ? 'warn' : ''}>
            {info.ahead === null || info.ahead === undefined
              ? '확인 불가'
              : info.ahead > 0
                ? `+${info.ahead} 커밋 앞섬`
                : '앞선 커밋 없음'}
          </strong>
          <small>
            {info.defaultBranch || 'main'}
            {info.behind ? ` · ${info.behind} 커밋 뒤짐` : ''}
            {info.dirty ? ` · 변경 ${info.dirty}개` : ''}
          </small>
        </div>
        <div className={`desk-ci-card ${isRunGood(info.latestRun) ? 'good' : ''}`}>
          <span className="desk-ci-label">최근 CI</span>
          <strong className={isRunGood(info.latestRun) ? 'good' : ''}>
            {runLabel(info.latestRun)}
          </strong>
          <small>
            {info.latestRun
              ? `${info.latestRun.workflowName} · ${info.latestRun.headBranch}`
              : '아직 실행 기록이 없어요'}
          </small>
        </div>
        <div className="desk-ci-card">
          <span className="desk-ci-label">현재 브랜치</span>
          <strong>{info.branch}</strong>
          <small>{info.workflows?.length || 0}개 워크플로</small>
        </div>
      </div>

      <div className="desk-subhead">
        <span>워크플로 · CI</span>
        <span>{(info.workflows || []).length}</span>
      </div>

      {(info.workflows || []).length === 0 ? (
        <DeskEmpty
          icon={<Github size={24} />}
          title="등록된 워크플로가 없어요"
          text="저장소에 .github/workflows가 있으면 여기서 바로 실행할 수 있어요."
        />
      ) : (
        <div className="desk-workflow-list">
          {(info.workflows || []).map((workflow) => (
            <div className="desk-workflow" key={workflow.id}>
              <span className="desk-workflow-ico">
                <Github size={15} />
              </span>
              <span className="desk-workflow-main">
                <b>{workflow.name}</b>
                <small>{workflow.path}</small>
              </span>
              <span className={`desk-workflow-state ${workflow.state}`}>{workflow.state}</span>
              <button
                className="desk-btn small"
                onClick={() => void runWorkflow(workflow)}
                disabled={running !== null || workflow.state !== 'active'}
              >
                {running === workflow.id ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Play size={13} />
                )}
                실행
              </button>
            </div>
          ))}
        </div>
      )}

      {info.latestRun && (
        <a
          className="desk-latest-run"
          href={info.latestRun.url}
          target="_blank"
          rel="noreferrer"
        >
          <span className={`desk-run-dot ${info.latestRun.conclusion || info.latestRun.status}`} />
          <span>
            <b>{info.latestRun.displayTitle || info.latestRun.workflowName}</b>
            <small>
              {info.latestRun.workflowName} · {info.latestRun.headBranch} ·{' '}
              {relativeTime(new Date(info.latestRun.createdAt).getTime())}
            </small>
          </span>
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function InstructionsTab({ path, notify }: { path: string; notify: (message: string) => void }) {
  const [data, setData] = useState<InstructionsInfo | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await orcaApi.instructions(path);
      setData(next);
      setContent(next.content);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '지침서를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await orcaApi.saveInstructions(path, content);
      setData(next);
      notify('워크트리 지침서를 저장했어요');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '지침서를 저장하지 못했어요');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <DeskLoading text="워크트리 지침서를 읽는 중…" />;

  return (
    <div className="desk-panel-stack">
      <div className="desk-panel-head">
        <div>
          <span className="desk-kicker">
            <BookOpen size={12} /> WORKTREE RULES
          </span>
          <h2>작업 지침서</h2>
          <p>이 워크트리의 AGENTS.md · 에이전트가 작업할 때 함께 읽습니다.</p>
        </div>
        <button className="desk-btn" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          저장
        </button>
      </div>
      {error && (
        <div className="desk-banner">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}
      <div className="desk-editor-meta">
        <span>
          <FileText size={13} />
          {data?.file || 'AGENTS.md'}
        </span>
        <span>{content.length.toLocaleString('ko-KR')}자</span>
      </div>
      <textarea
        className="desk-editor"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="# 작업 지침&#10;&#10;- 이 워크트리에서 지켜야 할 규칙을 적어 주세요.&#10;- 테스트와 검증 명령도 함께 적으면 좋아요."
        spellCheck={false}
      />
      <div className="desk-editor-foot">
        <span>
          <ShieldCheck size={13} />
          저장하면 이 워크트리에만 적용됩니다.
        </span>
        <button className="desk-btn ghost small" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={12} /> 되돌리기
        </button>
      </div>
    </div>
  );
}

function MemoryTab({ path, notify }: { path: string; notify: (message: string) => void }) {
  const [data, setData] = useState<MemoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await orcaApi.memory(path));
    } catch (cause) {
      setData({
        ok: false,
        path,
        recent: '',
        error: cause instanceof Error ? cause.message : '기억을 불러오지 못했어요.',
        fetchedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const next = await orcaApi.syncMemory(path);
      setData(next);
      notify(next.ok ? 'ai-memory 기록을 동기화했어요' : next.error || '동기화하지 못했어요');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '동기화하지 못했어요');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="desk-panel-stack">
      <div className="desk-panel-head">
        <div>
          <span className="desk-kicker">
            <Sparkles size={12} /> AI-MEMORY
          </span>
          <h2>프로젝트 기억</h2>
          <p>이 워크트리에서 축적된 최근 위키 페이지와 동기화 상태입니다.</p>
        </div>
        <div className="desk-panel-actions">
          <button className="desk-btn ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> 새로고침
          </button>
          <button className="desk-btn" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}
            기억 동기화
          </button>
        </div>
      </div>

      <div className="desk-memory-status">
        <span className={`desk-status-dot ${data?.ok ? 'working' : 'error'}`} />
        {data?.ok ? 'ai-memory 연결됨' : data?.error || 'ai-memory 상태 확인 필요'}
        {data?.synced && <em>방금 동기화</em>}
      </div>

      {loading && !data && <DeskLoading text="ai-memory의 최근 기록을 읽는 중…" />}
      {!loading && data && (
        <pre className="desk-memory-output">
          {data.recent || '아직 이 워크트리에 기록된 기억이 없어요.'}
        </pre>
      )}
      <div className="desk-editor-foot">
        <span>
          <Zap size={13} />
          동기화는 ai-memory의 recover를 실행하고 최근 페이지를 다시 읽습니다.
        </span>
      </div>
    </div>
  );
}

function MessagesTab({
  overview,
  notify,
}: {
  overview: OrcaOverview | null;
  notify: (message: string) => void;
}) {
  const [payload, setPayload] = useState<MessagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [toId, setToId] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const agents = overview?.agents.filter((agent) => agent.terminalHandle || agent.orcaSessionId) || [];
  const recipients = payload?.agents?.length ? payload.agents : agents;

  const load = useCallback(async () => {
    try {
      const next = await orcaApi.messages();
      setPayload(next);
    } catch (cause) {
      setPayload({
        ok: false,
        messages: [],
        error: cause instanceof Error ? cause.message : '메시지를 불러오지 못했어요.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!toId && recipients[0]?.id) setToId(recipients[0].id);
  }, [toId, recipients]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || !toId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const next = await orcaApi.sendMessage({ text: text.trim(), toId });
      setPayload(next);
      setText('');
      if (next.error) {
        setSendError(next.error);
      } else {
        notify('메시지를 작업자 세션에 전달했어요');
      }
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '메시지를 전달하지 못했어요');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="desk-message-layout">
      <section className="desk-message-main">
        <div className="desk-panel-head">
          <div>
            <span className="desk-kicker">
              <MessageSquare size={12} /> ORCA INBOX
            </span>
            <h2>작업자 메시지</h2>
            <p>Orca orchestration inbox를 읽고, 특정 작업자 세션으로 직접 보냅니다.</p>
          </div>
          <button className="desk-icon" onClick={() => void load()} aria-label="메시지 새로고침">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>

        <form className="desk-message-compose" onSubmit={send}>
          <div className="desk-message-route">
            <label>
              받는 작업자
              <SelectMenu
                value={toId}
                onChange={setToId}
                ariaLabel="받는 작업자"
                placeholder={recipients.length ? '작업자 선택' : '연결된 작업자가 없습니다'}
                options={recipients.map((agent) => ({
                  value: agent.id,
                  label: `${roleLabel(agent.role) ? `[${roleLabel(agent.role)}] ` : ''}${agentMeta(agent.agent).label} · ${agent.title.slice(0, 42)}`,
                  description: `${shortPath(agent.path)} · ${stateLabel(agent.state)}`,
                  meta: relativeTime(agent.updatedAt ?? undefined),
                }))}
              />
            </label>
            <span className="desk-message-arrow">→</span>
            <label>
              보내는 곳
              <span className="desk-message-static">Desk</span>
            </label>
          </div>
          <div className="desk-message-input">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="작업자 세션에 전달할 메시지"
              rows={2}
            />
            <button
              type="submit"
              className="desk-btn"
              disabled={!text.trim() || !toId || sending}
            >
              {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              전송
            </button>
          </div>
          <div className="desk-message-hint">
            <ShieldCheck size={12} />
            `orca orchestration send`로 실제 세션에 전달합니다. Freebuff·OpenCode 모두 해당됩니다.
          </div>
          {sendError && (
            <div className="desk-banner">
              <AlertTriangle size={14} />
              {sendError}
            </div>
          )}
        </form>

        <div className="desk-inbox-note">
          <ShieldCheck size={12} />
          받은 메시지는 Orca inbox에서, 보낸 메시지는 로컬 기록에서 함께 표시합니다.
        </div>

        <div className="desk-subhead">
          <span>받은 메시지</span>
          <span>{payload?.messages.length || 0}</span>
        </div>
        {payload?.warning && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {payload.warning}
          </div>
        )}
        {payload && !payload.ok && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {payload.error}
          </div>
        )}
        {!payload || payload.messages.length === 0 ? (
          <DeskEmpty
            icon={<MessageSquare size={25} />}
            title="아직 받은 메시지가 없어요"
            text="코디네이터와 워커가 Orca orchestration으로 메시지를 주고받으면 여기에 표시됩니다."
          />
        ) : (
          <div className="desk-message-list">
            {[...payload.messages].reverse().map((message: DeskMessage) => {
              const fromAgent = agents.find((agent) => agent.id === message.fromId);
              return (
                <article
                  className={`desk-message inbox ${message.handled ? 'handled' : 'unread'}`}
                  key={message.id}
                >
                  <div className="desk-message-head">
                    <span className={`desk-agent-badge ${agentMeta(fromAgent?.agent || '').cls}`}>
                      {message.fromName.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <b>{message.fromName}</b>
                      <small>
                        → {message.toName}
                        {message.at
                          ? ` · ${relativeTime(new Date(message.at).getTime())}`
                          : ' · Orca inbox'}
                      </small>
                    </span>
                    <span className="desk-delivery ok">{message.type}</span>
                  </div>
                  {message.subject && <strong className="desk-message-subject">{message.subject}</strong>}
                  <p>{message.text}</p>
                  {!message.handled && <small className="desk-message-unread">아직 읽지 않음</small>}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <aside className="desk-roster">
        <div className="desk-subhead">
          <span>작업자 명단</span>
          <span>{agents.length}</span>
        </div>
        {agents.length === 0 ? (
          <div className="desk-roster-empty">메시지를 받을 터미널이 아직 없어요.</div>
        ) : (
          agents.map((agent) => (
            <div
              className="desk-roster-item"
              key={agent.id}
              title={`${agent.repo} / ${agent.path}`}
            >
              <span className={`desk-agent-badge ${agentMeta(agent.agent).cls}`}>
                <AgentMark id={agent.agent} short={agentMeta(agent.agent).short} />
              </span>
              <span>
                <b>{agentMeta(agent.agent).label}</b>
                <small>{agent.title.slice(0, 48)}</small>
              </span>
              <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
            </div>
          ))
        )}
      </aside>
    </div>
  );
}

function DeskLoading({ text }: { text: string }) {
  return (
    <div className="desk-loading">
      <Loader2 size={17} className="spin" />
      {text}
    </div>
  );
}

const TranscriptMarkdown = memo(function TranscriptMarkdown({
  text,
  className = 'desk-transcript-md',
}: {
  text: string;
  className?: string;
}) {
  const html = useMemo(
    () =>
      highlightQuotaWarningsHtml(
        DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }) as string, {
          ADD_ATTR: ['target'],
          FORBID_TAGS: ['style', 'form', 'input'],
        }),
      ),
    [text],
  );
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
});

/**
 * Reveal appended reasoning at a steady 24fps instead of swapping a whole
 * paragraph in on every poll. The source may arrive in chunks, but the eye sees
 * one continuous stream.
 */
function useSmoothText(text: string, active: boolean) {
  // Start from the saved text. Re-entering a working session must not replay
  // reasoning the model already produced; only later appended chunks type in.
  const [shown, setShown] = useState(text);
  const shownRef = useRef(shown);
  const frameRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const from = shownRef.current;
    if (text === from) return;

    // A poll can briefly return a prefix while Freebuff flushes its chat store.
    // Never erase text that is already visible; wait for the next full chunk.
    if (from.length > text.length && from.startsWith(text)) return;

    if (!text.startsWith(from)) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      shownRef.current = text;
      setShown(text);
      return;
    }

    const added = text.length - from.length;
    // A finished block must not keep typing underneath a tool card. Big chunks
    // are also flushed at step boundaries, so show them immediately instead of
    // making the following tool look like it arrived first.
    if (!activeRef.current || added > 1_600) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      shownRef.current = text;
      setShown(text);
      return;
    }

    const duration = Math.min(1_600, Math.max(180, added * 1.15));
    const startedAt = performance.now();
    let lastPaint = 0;
    window.cancelAnimationFrame(frameRef.current);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      if (progress === 1 || now - lastPaint >= 24) {
        const next = text.slice(0, from.length + Math.ceil(added * progress));
        if (next !== shownRef.current) {
          shownRef.current = next;
          setShown(next);
        }
        lastPaint = now;
      }
      if (progress < 1) frameRef.current = window.requestAnimationFrame(tick);
      else frameRef.current = 0;
    };
    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [text]);

  // If the turn goes idle while the reveal is still in flight, finish it on
  // the same render so a tool card is never shown above a half-typed thought.
  useEffect(() => {
    if (active || shownRef.current === text) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    shownRef.current = text;
    setShown(text);
  }, [active, text]);

  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  return active ? shown : text;
}

const SmoothTranscriptMarkdown = memo(function SmoothTranscriptMarkdown({
  text,
  active,
  className,
}: {
  text: string;
  active: boolean;
  className?: string;
}) {
  const shown = useSmoothText(text, active);
  return <TranscriptMarkdown text={shown} className={className} />;
});

/**
 * A thought stays open once it starts streaming. The old controlled `open`
 * prop closed the previous step the moment the next reasoning block arrived,
 * which made it look like tool output had cancelled the preceding thought.
 */
const FreebuffThought = memo(function FreebuffThought({
  entry,
  live,
  streaming,
}: {
  entry: Extract<FreebuffSessionEntry, { kind: 'thinking' }>;
  live: boolean;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);

  useEffect(() => {
    if (live && !wasLive.current) setOpen(true);
    wasLive.current = live;
  }, [live]);

  return (
    <details
      className={`desk-freebuff-think ${live ? 'is-live' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={live ? '추론 중' : '추론'}>
        <ChevronRight size={13} className="desk-think-chev" />
        <span>추론</span>
        {live && <span className="thinking-live" />}
        <small>{entry.text.length.toLocaleString('ko-KR')}자</small>
      </summary>
      <div className={`desk-freebuff-think-body ${streaming ? 'is-streaming' : ''}`}>
        <SmoothTranscriptMarkdown text={entry.text} active={streaming} />
      </div>
    </details>
  );
});

type FreebuffModel = {
  id: string;
  label: string;
  hours: number;
  effort: string;
};

const FREEBUFF_MODELS: FreebuffModel[] = [
  {
    id: 'deepseek-v4.1-flash-fast',
    label: 'DeepSeek V4.1 Flash Fast',
    hours: 3,
    effort: 'High / Max 선택',
  },
  {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    hours: 2,
    effort: 'High / Max 선택',
  },
  {
    id: 'deepseek-v4.1-flash-slow',
    label: 'DeepSeek V4.1 Flash Slow',
    hours: 1,
    effort: 'Low 고정',
  },
];


type FreebuffEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const FREEBUFF_EFFORT_LABEL: Record<FreebuffEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

type FreebuffPickerModel = {
  id: string;
  label: string;
  description: string;
  multiplier: string | null;
  efforts: FreebuffEffort[];
  defaultEffort: FreebuffEffort;
};

const FREEBUFF_PICKER_MODELS: FreebuffPickerModel[] = [
  { id: 'deepseek-v4.1-flash-fast', label: 'DeepSeek V4.1 Flash Fast', description: '가장 빠름 · max', multiplier: '3x', efforts: ['low', 'high', 'max'], defaultEffort: 'high' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', description: '안정적 속도 · high', multiplier: '2x', efforts: ['low', 'high', 'max'], defaultEffort: 'high' },
  { id: 'muse-spark-1.3', label: 'Muse Spark 1.3', description: '혼잡 시 대체 · high', multiplier: '3x', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: '강력한 범용 · high', multiplier: '4x', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
  { id: 'muse-ember', label: 'Muse Ember', description: 'Meta · 빠름 · medium', multiplier: '6x', efforts: ['medium'], defaultEffort: 'medium' },
  { id: 'claude-haiku-5.5', label: 'Claude Haiku 5.5', description: 'Anthropic · 100k · medium', multiplier: '6x', efforts: ['medium'], defaultEffort: 'medium' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', description: 'OpenAI · 하루 2회 · medium', multiplier: '30x', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'deepseek-v4.1-flash-slow', label: 'DeepSeek V4.1 Flash Slow', description: '가장 저렴 · low', multiplier: '1x', efforts: ['low'], defaultEffort: 'low' },
  { id: 'beam-1.0', label: 'Beam 1.0', description: 'Reflection · coding · high', multiplier: null, efforts: ['high'], defaultEffort: 'high' },
  { id: 'nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning', description: '빠름 · high', multiplier: null, efforts: ['high'], defaultEffort: 'high' },
];

type FreebuffSentMessage = {
  id: string;
  text: string;
  at: number;
  afterBlock?: number;
};

type DeskFlowItem =
  | { kind: 'block'; block: TerminalBlock; key: string }
  | { kind: 'message'; message: FreebuffSentMessage; key: string };

const FREEBUFF_SENT_LIMIT = 60;
const FREEBUFF_HISTORY_PAGE = 80;
const FREEBUFF_SESSION_ENDED =
  /your session ended before this request started|send your message again to start a new one/i;
const FREEBUFF_RECOVERY_LIMIT = 3;
const FREEBUFF_RECOVERY_WINDOW = 2 * 60_000;
const FREEBUFF_RESUME_TTL = 10 * 60_000;

const FREEBUFF_TOOL_LABELS: Record<string, string> = {
  run_terminal_command: 'bash',
  run_terminal_cmd: 'bash',
  run_command: 'bash',
  bash: 'bash',
  shell: 'bash',
  terminal: 'bash',
  read_files: 'read',
  write_file: 'write',
  str_replace: 'edit',
  code_search: 'search',
  list_directory: 'ls',
  glob: 'glob',
  write_todos: 'todo',
  todo_write: 'todo',
  todowrite: 'todo',
  web_search: 'web',
  read_url: 'fetch',
  skill: 'skill',
  ask_user: 'ask',
  suggest_followups: 'suggest',
  render_ui: 'ui',
};

function freebuffToolLabel(name: string) {
  return FREEBUFF_TOOL_LABELS[name] || name;
}

function freebuffCommandHead(command: string) {
  const lines = command
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  // Tool scripts commonly start with `set +e` or a `cd`, which tells the
  // reader nothing. Use the first real step as the collapsed summary.
  return (
    lines.find(
      (line) => !/^(?:set\s+[+-][a-z]*|set\s+[+-]o\s+\w+|cd\s+\S+|#!.*)$/i.test(line),
    ) ||
    lines[0] ||
    ''
  );
}

function freebuffToolHead(entry: { name: string; command: string }) {
  if (entry.command.trim().startsWith('{')) {
    try {
      const input = JSON.parse(entry.command) as Record<string, unknown>;
      const pick = (value: unknown) =>
        typeof value === 'string' && value.trim() ? value.trim() : '';
      const paths = Array.isArray(input.paths)
        ? input.paths.filter((value): value is string => typeof value === 'string')
        : [];
      return (
        pick(input.command) ||
        pick(input.cmd) ||
        pick(input.script) ||
        pick(input.name) ||
        pick(input.pattern) ||
        pick(input.path) ||
        pick(input.file_path) ||
        pick(input.query) ||
        pick(input.url) ||
        pick(input.text) ||
        (paths.length ? paths.join(', ') : '') ||
        (Array.isArray(input.todos) ? `할 일 ${input.todos.length}개` : '') ||
        (Array.isArray(input.followups) ? `추천 ${input.followups.length}개` : '') ||
        ''
      );
    } catch {
      // Fall through to the line-based summary for non-JSON tool input.
    }
  }
  return freebuffCommandHead(entry.command);
}

function freebuffSentKey(path: string): string {
  return `agent-web:freebuff-sent:v1:${path}`;
}

function readFreebuffSent(path: string): FreebuffSentMessage[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(freebuffSentKey(path)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is FreebuffSentMessage =>
          Boolean(
            item &&
              typeof item.id === 'string' &&
              typeof item.text === 'string' &&
              typeof item.at === 'number',
          ),
      )
      .map((item) => ({
        ...item,
        afterBlock:
          typeof item.afterBlock === 'number' && item.afterBlock >= 0
            ? item.afterBlock
            : undefined,
      }))
      .slice(-FREEBUFF_SENT_LIMIT);
  } catch {
    return [];
  }
}

function writeFreebuffSent(path: string, messages: FreebuffSentMessage[]) {
  try {
    window.localStorage.setItem(freebuffSentKey(path), JSON.stringify(messages.slice(-FREEBUFF_SENT_LIMIT)));
  } catch {
    // Storage can be unavailable in private or embedded browsers.
  }
}

type FreebuffResumeTicket = {
  text: string;
  chatId: string | null;
  previousHandle: string | null;
  at: number;
};

function freebuffResumeKey(path: string): string {
  return `agent-web:freebuff-resume:v1:${path}`;
}

function readFreebuffResume(path: string): FreebuffResumeTicket | null {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(freebuffResumeKey(path)) || 'null',
    ) as FreebuffResumeTicket | null;
    if (!parsed || typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    if (Date.now() - Number(parsed.at || 0) > FREEBUFF_RESUME_TTL) {
      window.localStorage.removeItem(freebuffResumeKey(path));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeFreebuffResume(path: string, ticket: FreebuffResumeTicket | null) {
  try {
    if (ticket) window.localStorage.setItem(freebuffResumeKey(path), JSON.stringify(ticket));
    else window.localStorage.removeItem(freebuffResumeKey(path));
  } catch {
    // Storage can be unavailable in private or embedded browsers.
  }
}

function freebuffRecoveryAllowed(path: string): boolean {
  const key = `agent-web:freebuff-recovery:v1:${path}`;
  try {
    const now = Date.now();
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null') as {
      at?: number;
      count?: number;
    } | null;
    const fresh = parsed && now - Number(parsed.at || 0) < FREEBUFF_RECOVERY_WINDOW;
    const count = fresh ? Number(parsed?.count || 0) : 0;
    if (count >= FREEBUFF_RECOVERY_LIMIT) return false;
    window.localStorage.setItem(key, JSON.stringify({ at: now, count: count + 1 }));
    return true;
  } catch {
    return true;
  }
}
function remainingUntilLabel(value?: string | null): string | null {
  if (!value) return null;
  const until = new Date(value).getTime();
  if (Number.isNaN(until)) return null;
  const minutes = Math.max(0, Math.round((until - Date.now()) / 60_000));
  if (minutes < 1) return '곧 리셋';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}일 ${hours % 24}시간 남음`;
  }
  return hours > 0 ? `${hours}시간 ${rest}분 남음` : `${rest}분 남음`;
}

function cleanFreebuffTail(lines: string[]): string[] {
  const cleaned: string[] = [];
  for (const raw of lines) {
    let line = raw
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\r$/, '')
      .replace(/\s*[⎘▄▟▙■□]\s*$/g, '')
      .trimEnd();
    if (!line.trim()) {
      if (cleaned[cleaned.length - 1] !== '') cleaned.push('');
      continue;
    }
    if (
      /Ad \[Report|revana\.si|openllm\.sh|seedance|generate ai|access coding agents|run coding agents|developer-f|connect revana|scale your video|start generating|try .*free/i.test(
        line,
      )
    ) {
      continue;
    }
    if (
      /Enter a coding task|Add to the current task|for history|for help|←\s*for history|\?\s*for help|End session|DeepSeek V4\.1 Flash Fast|model to change|Show\s+\d+\s+more\s+lines?|Show\s+more\s+lines?|·\s*Chat:|(?:thinking|working)\.\.\.|\b\d+[hm]\s+left\b|Muse Ember|Claude Haiku|GPT-6\.1 Terra|STANDARD · Free|Free and low-cost models|PREMIUM|choose model|Tab reasoning|Enter select|Esc cancel|^\s*\d+x\s*$/i.test(
        line,
      )
    ) {
      continue;
    }
    // Keep box-drawing tables intact so the renderer can turn the raw
    // terminal table into an HTML table. The old cleanup stripped every
    // column separator and left fragments like "│ 1" floating in the log.
    if (/[┌┐└┘├┤┬┴┼]/.test(line) || /^\s*[│┃]/.test(line)) {
      cleaned.push(line.trimEnd());
      continue;
    }
    if (/^\s*[█▀▄]/.test(line)) continue;
    if (
      /May use data for AI training|Session active|\d+\/\d+ hours remaining|Starter plan|\d+ day streak|Streak perk|^\s*[│╭╰╮╯─]+\s*$/.test(
        line,
      )
    ) {
      continue;
    }
    if (/^[╭╰╮╯─]+$/.test(line.trim())) continue;
    if (!line.replace(/[│╭╰╮╯─\s]/g, '')) continue;
    line = line.replace(/^[│]\s?/, '').replace(/\s*[│]$/, '').trimEnd();
    const bullet = line.trim().match(/^([⎘•△▽█✕■●⏺▸‣])\s*(.*)$/);
    if (bullet) {
      const rest = bullet[2].trim();
      if (!rest || /^•\s*\d+s\b/.test(line.trim())) continue;
      const looksLikeTool =
        commandMeta(rest) ||
        /^(?:bash|shell|sh|zsh|exec(?:ute)?|run|ran|command|cmd|terminal|read(?:_file)?|write(?:_file)?|edit(?:_file)?|glob|grep|search|apply|patch|todo|task|web|fetch)\b/i.test(
          rest,
        ) ||
        /^(?:git|npm|pnpm|yarn|bun|cargo|node|python3?|pytest|ls|cat|rg|grep|find|sed|awk|curl|make|docker|kubectl|go|rustc|tsc|vite)\b/.test(
          rest,
        );
      if (!looksLikeTool) continue;
      line = rest;
    }
    if (/^(?:[>›❯]|←)\s*$/.test(line.trim())) continue;
    cleaned.push(line);
  }
  while (cleaned[0] === '') cleaned.shift();
  while (cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned;
}

type TerminalTool = {
  name: string;
  command: string;
  running: boolean;
};

type TerminalBlock = {
  kind: 'text' | 'thinking' | 'command' | 'stamp' | 'table';
  lines: string[];
  table?: TerminalTable;
  tool?: TerminalTool;
};

function commandMeta(line: string): TerminalTool | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const prefixed = /^(?:\$|›|❯|➜|⏵|▸|‣|⏺|»|>|•|●|✓|✔|☑|→)\s+/.test(trimmed);
  const namedPrefix = /^(?:bash|shell|sh|zsh|exec(?:ute)?|command|cmd|terminal|tool)\s*[:：]/i.test(trimmed);
  if (!prefixed && !namedPrefix) return null;
  const cleaned = trimmed.replace(/^(?:\$|›|❯|➜|⏵|▸|‣|⏺|»|>|•|●|✓|✔|☑|→)\s*/, '');
  const nameMatch = cleaned.match(
    /^(bash|shell|sh|zsh|cmd|powershell|pwsh|exec(?:ute)?|run|ran|command|read(?:_file)?|write(?:_file)?|edit(?:_file)?|glob|grep|search|apply(?:[_\s-]?patch)?|patch|task|todo(?:write)?|webfetch|fetch|browser|terminal|tool)\b/i,
  );
  if (!nameMatch) {
    // Plain `$ command` rows are shell calls too.
    if (/^\$\s+/.test(trimmed)) {
      return {
        name: 'bash',
        command: cleaned,
        running: /(?:…|\.\.\.|running|in progress|실행 중)$/i.test(trimmed),
      };
    }
    return null;
  }
  let name = nameMatch[1].toLowerCase().replace(/[_\s-]/g, '');
  let command = cleaned
    .slice(nameMatch[0].length)
    .replace(/^[\s:：—–-]+/, '')
    .trim();
  // Some TUIs render `Ran bash <command>` / `Ran command: <command>`.
  if (name === 'ran' || name === 'run') {
    const nested = command.match(
      /^(bash|shell|sh|zsh|cmd|powershell|pwsh|exec(?:ute)?|command|read(?:_file)?|write(?:_file)?|edit(?:_file)?|glob|grep|search|apply(?:[_\s-]?patch)?|patch|task|todo(?:write)?|webfetch|fetch|browser|terminal|tool)\b[\s:：-]*(.*)$/i,
    );
    if (nested) {
      name = nested[1].toLowerCase().replace(/[_\s-]/g, '');
      command = nested[2].trim() || command;
    } else {
      name = 'bash';
    }
  }
  if (!command) return null;
  // Some TUIs render `Bash(git status)` instead of `Bash git status`.
  if (command.startsWith('(') && command.endsWith(')')) {
    command = command.slice(1, -1).trim();
  }
  return {
    name,
    command,
    running: /(?:…|\.\.\.|running|in progress|실행 중)$/i.test(trimmed),
  };
}

function terminalLineClass(line: string) {
  if (/-?\s*Thinking\b|추론\s*상황/i.test(line)) return 'thinking';
  if (commandMeta(line)) return 'command';
  if (/^\s*\[\d{1,2}:\d{2}\s*(?:AM|PM)\]/i.test(line)) return 'stamp';
  return '';
}

type TerminalTable = { header: string[]; rows: string[][] };

function tableCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function pipeTableAt(lines: string[], start: number): { table: TerminalTable; length: number } | null {
  const header = tableCells(lines[start] || '');
  const divider = tableCells(lines[start + 1] || '');
  if (!header || !divider || divider.length !== header.length) return null;
  if (!divider.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const rows: string[][] = [];
  let end = start + 2;
  while (end < lines.length) {
    const row = tableCells(lines[end]);
    if (!row) break;
    rows.push(row);
    end += 1;
  }
  if (rows.length === 0) return null;
  return { table: { header, rows }, length: end - start };
}

function boxTableAt(lines: string[], start: number): { table: TerminalTable; length: number } | null {
  const top = (lines[start] || '').trim();
  if (!/^[┌┏╭]/.test(top)) return null;
  let end = start + 1;
  while (end < lines.length && !/^[└┗╰]/.test((lines[end] || '').trim())) end += 1;
  if (end >= lines.length) return null;
  const inside = lines.slice(start + 1, end);
  const content = inside
    .map((line) => line.split(/[│┃║]/).slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && cells.some(Boolean));
  if (content.length < 2) return null;
  const separator = inside.findIndex((line) => /[├┼╞╪]/.test(line));
  const splitAt = separator >= 0
    ? inside.slice(0, separator).filter((line) => /[│┃║]/.test(line)).length
    : 0;
  const header = splitAt > 0 ? content[splitAt - 1] : content[0];
  const rows = content.filter((_, index) => index !== (splitAt > 0 ? splitAt - 1 : 0));
  if (rows.length === 0) return null;
  return { table: { header, rows }, length: end - start + 1 };
}

function terminalBlocks(lines: string[]): TerminalBlock[] {
  const blocks: TerminalBlock[] = [];
  let inThinking = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const table = pipeTableAt(lines, index) || boxTableAt(lines, index);
    if (table) {
      blocks.push({ kind: 'table', lines: [], table: table.table });
      index += table.length - 1;
      inThinking = false;
      continue;
    }
    // A rejected box is usually terminal chrome. Tool rows can live inside a
    // box, so keep their inner text instead of discarding the command with the
    // border. Pure borders are still dropped.
    if (/[┌┐└┘├┤┬┴┼]/.test(line)) continue;
    let contentLine = line;
    if (/^\s*[│┃]/.test(line)) {
      contentLine = line
        .replace(/^\s*[│┃]\s?/, '')
        .replace(/\s*[│┃]\s*$/, '')
        .trimEnd();
      if (!contentLine.trim()) continue;
    }
    const explicit = terminalLineClass(contentLine);
    // Freebuff prints the gray reasoning block under `• Thinking` with a
    // deeper indent than the answer. Keep those wrapped lines in the same
    // gray block instead of leaking them into the normal answer.
    const reasoningLine = inThinking && /^\s{4,}\S/.test(contentLine);
    const kind = (explicit || (reasoningLine ? 'thinking' : 'text')) as
      | 'text'
      | 'thinking'
      | 'command'
      | 'stamp';
    if (explicit === 'thinking') inThinking = true;
    else if (kind === 'text' && /^\s{0,3}\S/.test(contentLine)) inThinking = false;
    if (kind === 'command') {
      const tool = commandMeta(contentLine);
      if (tool) {
        // Every invocation gets its own tool card. Do not swallow the whole
        // command (or its arguments) into one generic TOOL text block.
        blocks.push({ kind, lines: [contentLine], tool });
        continue;
      }
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.lines.push(contentLine);
    else blocks.push({ kind, lines: [contentLine] });
  }
  return blocks;
}

function TerminalBlockContent({ block }: { block: TerminalBlock }) {
  if (block.kind === 'table' && block.table) {
    return (
      <div className="desk-term-block table">
        <div className="desk-term-table-wrap">
          <table className="desk-term-table">
            <thead>
              <tr>
                {block.table.header.map((cell, index) => (
                  <th key={`${index}-${cell.slice(0, 12)}`}>{cell || '—'}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cellIndex}-${cell.slice(0, 12)}`}>{cell || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (block.kind === 'command') {
    const tool = block.tool;
    return (
      <details className="desk-tool-card">
        <summary>
          <span className={`desk-tool-check ${tool?.running ? 'running' : ''}`}>
            {tool?.running ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
          </span>
          <span className="desk-tool-terminal">
            <Terminal size={12} />
          </span>
          <strong>{tool?.name || 'bash'}</strong>
          <code title={tool?.command || block.lines.join('\n')}>
            {tool?.command || block.lines.join(' ')}
          </code>
          <small>{tool?.running ? '실행 중' : '완료'}</small>
          <ChevronDown size={12} className="desk-tool-chev" />
        </summary>
        <pre>{block.lines.join('\n')}</pre>
      </details>
    );
  }

  return (
    <div className={`desk-term-block ${block.kind}`}>
      {block.kind === 'thinking' && (
        <div className="desk-term-block-label">THINKING</div>
      )}
      {block.lines.map((line, index) => (
        <div
          className={`desk-term-line ${block.kind} ${isQuotaWarningLine(line) ? 'quota-warn' : ''}`}
          key={`${index}-${line.slice(0, 18)}`}
        >
          {line || '\u00a0'}
        </div>
      ))}
    </div>
  );
}

function freebuffStatus(lines: string[], working: boolean) {
  const joined = lines.join(' ');
  const knownModels = [...FREEBUFF_PICKER_MODELS].sort(
    (left, right) => right.label.length - left.label.length,
  );
  // A long footer wraps onto the next line. The last `/model to change` row
  // can therefore be only a continuation and contain neither the model nor
  // the effort. Prefer the actual model-bearing row, which is the footer in
  // the normal view and the selected row when the model sheet is open.
  const footer =
    [...lines].reverse().find((line) => /\/model to change|Chat:\s*/i.test(line)) || '';
  const modelLine =
    [...lines]
      .reverse()
      .find((line) => knownModels.some((option) => line.includes(option.label))) || '';
  const statusSource = modelLine || footer || joined;
  const effortSource = modelLine || footer || joined;
  const model = knownModels.find((option) => statusSource.includes(option.label)) ?? null;
  const hours = joined.match(/(\d+)\s*\/\s*(\d+)\s+hours remaining/i);
  const remainingHours = hours ? Number(hours[1]) : null;
  const totalHours = hours ? Number(hours[2]) : null;
  const usedHours =
    remainingHours !== null && totalHours !== null
      ? Math.max(0, totalHours - remainingHours)
      : null;
  // Freebuff's footer uses compact human time (`41m left`, `1h 20m left`)
  // rather than the older `N/M hours remaining` form. Accept both, including
  // day/second fragments, so the timer does not fall back to context size.
  const left =
    joined.match(
      /((?:\d+\s*d(?:\s+\d+\s*h)?(?:\s+\d+\s*m)?)|(?:\d+\s*h(?:\s+\d+\s*m)?(?:\s+\d+\s*s)?)|(?:\d+\s*m(?:\s+\d+\s*s)?)|(?:\d+\s*s))\s+left\b/i,
    )?.[1] ?? null;
  return {
    left: left?.replace(/\s+/g, ' ').trim() ?? null,
    planLeft: hours ? `${hours[1]}/${hours[2]}` : null,
    hoursRemaining: remainingHours,
    totalHours,
    usedHours,
    model: model?.label ?? null,
    modelMultiplier: model?.multiplier ?? null,
    effort: effortSource.match(/(?:•|·|effort[:=]?)\s*(xhigh|max|high|medium|low|minimal)\b/i)?.[1]?.toLowerCase() ?? null,
    context: joined.match(/(\d+(?:\.\d+)?[KkMm]?)\s*\(\s*(\d+(?:\.\d+)?)%\s*\)/)?.[1] ?? null,
    contextPercent: Number(
      joined.match(/(\d+(?:\.\d+)?[KkMm]?)\s*\(\s*(\d+(?:\.\d+)?)%\s*\)/)?.[2] ?? NaN,
    ),
    elapsed: joined.match(/(?:thinking|working)\.\.\.\s*(\d+m\s*\d+s|\d+m|\d+s)/i)?.[1] ?? null,
    thinking: working,
  };
}

// Agy's native screen ends with a footer like `Gemini 3.8 Flash · high`, and
// its /usage screen prints weekly and five-hour remaining rows. The Orca chat
// payload does not include either, so read them from the live screen when it
// exists and fall back to the account quota below.
function agyStatus(lines: string[]) {
  const joined = lines.join('\n');
  const footer = [...lines]
    .reverse()
    .find((line) => /(?:Gemini|Claude|GPT|Orchestrator)[^·\n]*·\s*(?:high|medium|low|xhigh)\b/i.test(line));
  const model = footer?.match(/([^·]+?)\s*·\s*(high|medium|low|xhigh)\s*$/i);
  const weekly = joined.match(
    /Weekly Limit Remaining[\s\S]{0,180}?\[\s*[^\]]*]\s*([\d.]+)\s*%?/i,
  );
  const fiveHour = joined.match(
    /Five Hour Limit Remaining[\s\S]{0,180}?\[\s*[^\]]*]\s*([\d.]+)\s*%?/i,
  );
  return {
    model: model?.[1]?.trim() || null,
    effort: model?.[2]?.toLowerCase() || null,
    weekly: weekly?.[1] ?? null,
    fiveHour: fiveHour?.[1] ?? null,
    account: joined.match(/Account:\s*(\S+)/i)?.[1] ?? null,
  };
}


function selectedFreebuffPickerModel(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/[│┃║]\s*›\s*(.+?)\s*•/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
type AgyGroup =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; texts: string[] }
  | { kind: 'tools'; tools: TranscriptEntry[] };

function agyToolDisplay(name: string) {
  const normalized = String(name || '').toLowerCase();
  if (
    normalized.includes('execute') ||
    normalized.includes('bash') ||
    normalized.includes('shell')
  ) {
    return { kind: 'bash', label: 'bash', Icon: Terminal };
  }
  if (
    normalized.includes('read') ||
    normalized.includes('glob') ||
    normalized.includes('grep') ||
    normalized.includes('search')
  ) {
    return { kind: 'read', label: 'read', Icon: Search };
  }
  if (
    normalized.includes('edit') ||
    normalized.includes('write') ||
    normalized.includes('patch')
  ) {
    return { kind: 'write', label: 'edit', Icon: Save };
  }
  if (normalized.includes('web') || normalized.includes('fetch')) {
    return { kind: 'web', label: 'web', Icon: FileText };
  }
  return { kind: 'tool', label: 'tool', Icon: Wrench };
}

function AgyToolRow({ tool }: { tool: TranscriptEntry }) {
  const [open, setOpen] = useState(false);
  const meta = agyToolDisplay(tool.tool || tool.name || '');
  const state = String(tool.state || 'completed').toLowerCase();
  const running = state === 'running' || state === 'pending';
  const failed = state === 'failed' || state === 'error';
  const label = running ? '실행 중' : failed ? '실패' : '완료';
  const Icon = meta.Icon;
  const detailText = tool.detail || tool.text || '';
  const summaryText = (tool.detail || tool.label || tool.name || meta.label).split('\n')[0];

  return (
    <div className={`tool real desk-agy-tool ${open || failed ? 'open' : ''} ${failed ? 'failed' : ''}`}>
      <div
        className="tool-main"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        aria-expanded={open || failed}
      >
        <span className={`tool-status ${running ? 'running' : failed ? 'error' : 'done'}`}>
          {running ? (
            <Loader2 size={13} className="spin" />
          ) : failed ? (
            <X size={13} />
          ) : (
            <Check size={13} strokeWidth={3} />
          )}
        </span>
        <span className={`tool-ico kind-${meta.kind}`}>
          <Icon size={14} />
        </span>
        <span className="tool-kind">{meta.kind}</span>
        <span className="tool-name">{summaryText}</span>
        <span className="tool-time">{label}</span>
        <ChevronDown size={14} className={`tool-chev ${open || failed ? 'open' : ''}`} />
      </div>
      {(open || failed) && (
        <div className="tool-detail">
          {(tool.diff || hasDiffSignal(detailText) || (typeof tool.newText === 'string' && tool.newText.length > 0)) && (
            <ToolDiff
              oldText={tool.oldText}
              newText={tool.newText}
              rawDiff={tool.diff || (hasDiffSignal(detailText) ? detailText : undefined)}
              fileName={summaryText}
            />
          )}
          <div className="tool-detail-label">입력</div>
          <pre className="tool-args">{detailText || `${tool.name || meta.label}\nstate: ${state}`}</pre>
        </div>
      )}
    </div>
  );
}

function AgyThinking({ texts, busy }: { texts: string[]; busy: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="thinking desk-agy-thinking">
      <button
        className="thinking-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={15} className="chev open" />
        ) : (
          <ChevronRight size={15} className="chev" />
        )}
        <span>생각</span>
        {busy && <span className="thinking-live" />}
      </button>
      {open && (
        <div className="thinking-body reasoning-body">
          {texts.map((text, index) => (
            <p key={`${index}-${text.slice(0, 16)}`}>{text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function AgyChatThread({
  entries,
  busy,
  copied,
  modelLabel,
  effortLabel,
  onCopy,
  onRefresh,
}: {
  entries: TranscriptEntry[];
  busy: boolean;
  copied: boolean;
  modelLabel?: string;
  effortLabel?: string;
  onCopy: () => void;
  onRefresh: () => void;
}) {
  const groups = useMemo(() => {
    const next: AgyGroup[] = [];
    for (const entry of entries) {
      if (entry.kind === 'tool') {
        const last = next[next.length - 1];
        if (last?.kind === 'tools') last.tools.push(entry);
        else next.push({ kind: 'tools', tools: [entry] });
        continue;
      }
      if (entry.kind === 'thinking' || entry.kind === 'reasoning') {
        if (!entry.text?.trim()) continue;
        const last = next[next.length - 1];
        if (last?.kind === 'thinking') last.texts.push(entry.text);
        else next.push({ kind: 'thinking', texts: [entry.text] });
        continue;
      }
      if (entry.kind === 'message' && entry.text?.trim()) {
        next.push({
          kind: entry.role === 'user' ? 'user' : 'assistant',
          text: entry.text,
        });
      }
    }
    return next;
  }, [entries]);

  if (groups.length === 0) return null;

  return (
    <div className="desk-agy-thread">
      {groups.map((group, index) => {
        if (group.kind === 'user') {
          return (
            <div className="desk-agy-user" key={`user-${index}`}>
              {cleanUserMessage(group.text)}
            </div>
          );
        }
        if (group.kind === 'thinking') {
          return (
            <AgyThinking
              key={`thinking-${index}`}
              texts={group.texts}
              busy={busy && index === groups.length - 1}
            />
          );
        }
        if (group.kind === 'tools') {
          return (
            <div className="tools desk-agy-tools" key={`tools-${index}`}>
              {group.tools.map((tool, toolIndex) => (
                <AgyToolRow key={`tool-${index}-${toolIndex}-${tool.name || 'tool'}`} tool={tool} />
              ))}
            </div>
          );
        }
        return (
          <div className="assistant-text desk-agy-answer" key={`assistant-${index}`}>
            <TranscriptMarkdown text={group.text} className="desk-agy-md" />
          </div>
        );
      })}
      {busy && (
        <div className="desk-agy-working">
          <Loader2 size={14} className="spin" />
          <span>작업 중…</span>
        </div>
      )}
      <div className="msg-meta desk-agy-meta">
        <div className="meta-actions">
          <button className="meta-btn" onClick={onCopy} aria-label={copied ? '복사됨' : '대화 복사'}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button className="meta-btn" onClick={onRefresh} aria-label="대화 새로고침">
            <RefreshCw size={14} />
          </button>
        </div>
        <span className="meta-time">
          {modelLabel && modelLabel !== '모델' && modelLabel !== 'Agy'
            ? `${modelLabel}${effortLabel && effortLabel !== 'effort' ? ` · ${effortLabel}` : ''}`
            : 'Agy · Orca chat'}
        </span>
      </div>
    </div>
  );
}

type HandoffEntry = {
  kind: string;
  role?: string;
  text?: string;
  name?: string;
  command?: string;
};

function clipHandoff(text: string | undefined, max: number): string {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

function buildHandoffBrief(agent: OrcaAgent, entries: HandoffEntry[], tail: string[]): string {
  const users: string[] = [];
  const assistants: string[] = [];
  const tools: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'message') {
      if (entry.role === 'user' && entry.text) users.push(entry.text);
      else if (entry.role === 'assistant' && entry.text) assistants.push(entry.text);
    } else if (entry.kind === 'tool') {
      const detail = entry.command || entry.name || 'tool';
      tools.push(detail.split('\n')[0]);
    }
  }
  const fallback = tail.filter((line) => line.trim()).slice(-12).join('\n');
  const lastUser = clipHandoff(users[users.length - 1] || agent.prompt, 700);
  const lastAssistant = clipHandoff(assistants[assistants.length - 1] || fallback, 900);
  const recentTools = tools
    .slice(-4)
    .map((tool) => clipHandoff(tool, 160))
    .filter(Boolean);
  return [
    `[인수인계] ${agent.title}`,
    `워크트리: ${agent.path}`,
    `브랜치: ${agent.branch || '—'}`,
    `현재 상태: ${stateLabel(agent.state)}`,
    lastUser ? `마지막 요청: ${lastUser}` : '',
    lastAssistant ? `최근 진행: ${lastAssistant}` : '',
    recentTools.length ? `최근 툴: ${recentTools.join(' / ')}` : '',
    '이 작업을 이어받아 계속 진행해 주세요. 기존 워크트리와 변경 사항을 먼저 확인하고, 완료되면 결과를 알려주세요.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function HandoffSheet({
  source,
  overview,
  brief,
  onClose,
  onSent,
}: {
  source: OrcaAgent;
  overview: OrcaOverview | null;
  brief: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const eligible = (agents: OrcaAgent[]) =>
    agents.filter(
      (agent) =>
        agent.id !== source.id &&
        (!source.orcaSessionId || agent.orcaSessionId !== source.orcaSessionId) &&
        Boolean(agent.terminalHandle || agent.orcaSessionId),
    );
  const [agents, setAgents] = useState<OrcaAgent[]>(() => eligible(overview?.agents || []));
  const [toId, setToId] = useState('');
  const [text, setText] = useState(brief);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void orcaApi
      .overview(true)
      .then((next) => {
        if (!alive) return;
        setAgents(eligible(next.agents));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Refresh once when the handoff sheet opens; the overview cache is refreshed
    // by the desk anyway, but a just-launched worker should be selectable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id]);

  useEffect(() => {
    setToId((current) =>
      current && agents.some((agent) => agent.id === current) ? current : agents[0]?.id || '',
    );
  }, [agents]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!toId || !text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await orcaApi.sendMessage({
        text: text.trim(),
        toId,
        fromId: source.id,
      });
      if (result.ok === false || result.error) {
        throw new Error(result.error || '인수인계 메시지를 전달하지 못했어요.');
      }
      const target = agents.find((agent) => agent.id === toId);
      onSent(target ? `${target.title}에 인수인계했어요` : '인수인계 메시지를 전달했어요');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '인수인계 메시지를 전달하지 못했어요.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open onClose={onClose} label="에이전트 인수인계" className="desk-handoff-sheet">
      <div className="sheet-content desk-handoff">
        <div className="sheet-head">
          <span className="sheet-title">에이전트 인수인계</span>
          <span className="sheet-sub">{source.repo}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label="인수인계 닫기"
          >
            <X size={15} />
          </button>
        </div>
        <form className="desk-handoff-form" onSubmit={send}>
          <label className="desk-handoff-field">
            <span>받는 에이전트</span>
            <SelectMenu
              value={toId}
              onChange={setToId}
              ariaLabel="인수인계 받는 에이전트"
              placeholder={agents.length ? '에이전트 선택' : '인수인계할 다른 에이전트가 없어요'}
              disabled={!agents.length}
              options={agents.map((agent) => ({
                value: agent.id,
                label: `${roleLabel(agent.role) ? `[${roleLabel(agent.role)}] ` : ''}${agentMeta(agent.agent).label} · ${agent.title.slice(0, 42)}`,
                description: `${shortPath(agent.path)} · ${stateLabel(agent.state)}`,
                meta: relativeTime(agent.updatedAt ?? undefined),
              }))}
            />
          </label>
          <label className="desk-handoff-field">
            <span>전달할 작업 요약</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
              rows={8}
              placeholder="이 작업을 이어받을 에이전트에게 전달할 내용"
            />
          </label>
          <div className="desk-handoff-meta">
            <span>{text.length.toLocaleString('ko-KR')} / 2,000자</span>
            <span>Orca orchestration으로 전달</span>
          </div>
          {!agents.length && (
            <div className="desk-handoff-empty">
              <AlertTriangle size={14} />
              다른 워크트리나 채팅에 에이전트를 먼저 띄워 주세요.
            </div>
          )}
          {error && (
            <div className="desk-handoff-error" role="alert">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}
          <div className="desk-handoff-actions">
            <button type="button" className="desk-btn ghost" onClick={onClose} disabled={sending}>
              취소
            </button>
            <button
              type="submit"
              className="desk-btn"
              disabled={sending || !toId || !text.trim()}
            >
              {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              인수인계
            </button>
          </div>
        </form>
      </div>
    </Sheet>
  );
}

function LogDrawer({
  agent,
  overview,
  notify,
  onClose,
  onOverview,
  onContinue,
  onOpenInfo,
}: {
  agent: OrcaAgent;
  overview: OrcaOverview | null;
  notify: (message: string) => void;
  onClose: () => void;
  onOverview: (overview: OrcaOverview) => void;
  onContinue: (agent: OrcaAgent) => void;
  onOpenInfo?: (tab?: InfoTab) => void;
}) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [view, setView] = useState<'chat' | 'terminal'>('chat');
  const [freebuffHistoryLimit, setFreebuffHistoryLimit] = useState(FREEBUFF_HISTORY_PAGE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [logQuery, setLogQuery] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [sentMessages, setSentMessages] = useState<FreebuffSentMessage[]>(() =>
    readFreebuffSent(agent.path),
  );
  const [freebuffSession, setFreebuffSession] = useState<FreebuffSessionPayload | null>(null);
  const [freebuffHot, setFreebuffHot] = useState(false);
  const [attachment, setAttachment] = useState<{ path: string; name: string; size: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [freebuffPanel, setFreebuffPanel] = useState<'model' | 'effort' | 'usage' | null>(null);
  const [freebuffClosing, setFreebuffClosing] = useState(false);
  const [freebuffSwitching, setFreebuffSwitching] = useState(false);
  const [freebuffTimeLeft, setFreebuffTimeLeft] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [autoRecovery, setAutoRecovery] = useState<
    'idle' | 'resuming' | 'sending' | 'done' | 'failed'
  >('idle');
  const [autoRecoveryNote, setAutoRecoveryNote] = useState<string | null>(null);
  const [resumeTicket, setResumeTicket] = useState<FreebuffResumeTicket | null>(() =>
    readFreebuffResume(agent.path),
  );
  const [resumeRetry, setResumeRetry] = useState(0);
  const autoRecoveryRef = useRef('');
  const resumeAttemptsRef = useRef(0);
  const sessionSinceRef = useRef(0);
  const lastTerminalReadRef = useRef(0);
  const snapshotRef = useRef<TerminalSnapshot | null>(null);
  const loadInFlightRef = useRef(false);
  const loadStartedAtRef = useRef(0);
  const loadTokenRef = useRef(0);
  const sessionInFlightRef = useRef(false);
  const sessionStartedAtRef = useRef(0);
  const sessionTokenRef = useRef(0);
  snapshotRef.current = snapshot;

  useEffect(() => {
    setTranscript(null);
    setSnapshot(null);
    setFreebuffSession(null);
    setError(null);
  }, [agent.id, agent.terminalHandle]);

  useEffect(() => {
    // Reopening a long Freebuff chat should paint the latest turn quickly, not
    // mount hundreds of old reasoning and tool cards at once.
    setFreebuffHistoryLimit(FREEBUFF_HISTORY_PAGE);
  }, [agent.id, freebuffSession?.chatId]);
  const [freebuffModelOverride, setFreebuffModelOverride] = useState<string | null>(null);
  const [freebuffEffortOverride, setFreebuffEffortOverride] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const freebuffPanelTimerRef = useRef<number | undefined>(undefined);
  const sentPathRef = useRef(agent.path);
  const isOpenCode =
    agent.agent === 'opencode' ||
    /^OpenCode\b/i.test(agent.title) ||
    /^OpenCode\b/i.test(agent.terminalTitle || '');
  // OpenCode shares Freebuff's structured chat view instead of a raw terminal.
  const isFreebuff =
    isOpenCode ||
    agent.agent === 'freebuff' ||
    /^Freebuff\b/i.test(agent.title) ||
    /^Freebuff\b/i.test(agent.terminalTitle || '');

  useEffect(() => {
    // A step is flushed to disk whole. Keep the last block live briefly after
    // the update so it still types in even when `working` flips to idle in the
    // same response.
    if (!isFreebuff || !freebuffSession?.updatedAt) {
      setFreebuffHot(false);
      return;
    }
    setFreebuffHot(true);
    const timer = window.setTimeout(() => setFreebuffHot(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [freebuffSession?.updatedAt, isFreebuff]);
  const agentLabel = isOpenCode ? 'OpenCode' : 'Freebuff';
  const isShell = agent.agent === 'terminal' && !isFreebuff;
  const isChat =
    !isFreebuff &&
    (agent.kind === 'chat' ||
      (!agent.terminalHandle && Boolean(agent.orcaSessionId)));
  const isAgy = agent.agent === 'antigravity';
  const isCodex = agent.agent === 'codex';
  const isClaude = agent.agent === 'claude';
  const isAgyChat = isChat && isAgy;
  const canPickModel = isAgyChat || isCodex || (MODEL_OPTIONS[agent.agent]?.length ?? 0) > 0;
  const { quota: agyQuota, loading: agyQuotaLoading, refresh: refreshAgyQuota } = useAgyQuota(isAgy || isClaude || isCodex);
  const [codexDrawerQuota, setCodexDrawerQuota] = useState<CodexQuotaSnapshot | null>(null);
  useEffect(() => {
    if (!isCodex && !isClaude) return;
    let alive = true;
    void fetch('/codex-api/quota', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && (data.primary || data.secondary || data.plan)) {
          setCodexDrawerQuota(data as CodexQuotaSnapshot);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isCodex, isClaude]);
  const displayMeta = isOpenCode
    ? { id: 'opencode', label: 'OpenCode', short: 'OC', cls: 'opencode' }
    : isFreebuff
    ? { id: 'freebuff', label: 'Freebuff', short: 'FB', cls: 'freebuff' }
    : agentMeta(agent.agent);
  const transcriptEntries = useMemo(
    () =>
      (transcript?.entries || []).filter(
        (entry) =>
          (entry.kind === 'message' ||
            entry.kind === 'reasoning' ||
            entry.kind === 'thinking' ||
            entry.kind === 'tool') &&
          typeof entry.text === 'string' &&
          entry.text.trim(),
      ),
    [transcript],
  );
  const agyEntries = useMemo(
    () =>
      (transcript?.entries || []).filter(
        (entry) =>
          (entry.kind === 'message' ||
            entry.kind === 'reasoning' ||
            entry.kind === 'thinking' ||
            entry.kind === 'tool') &&
          (entry.kind === 'tool' || (typeof entry.text === 'string' && entry.text.trim())),
      ),
    [transcript],
  );
  const hasTranscript = agyEntries.length > 0;
  const agyBucket = useMemo(() => {
    const groups = agyQuota?.groups || [];
    const storedModel = agent.orcaSessionId
      ? localStorage.getItem(`agyModel:${agent.orcaSessionId}`) || ''
      : '';
    const hint = `${transcript?.model || ''} ${storedModel}`.toLowerCase();
    const preferredGroup =
      (/argon/i.test(hint) && groups.find((g) => /argon/i.test(g.name))) ||
      (/claude|gpt/i.test(hint) && groups.find((g) => /claude/i.test(g.name))) ||
      groups.find((g) => /gemini\s+models/i.test(g.name));
    const sourceBuckets = preferredGroup
      ? preferredGroup.buckets
      : groups.flatMap((group) => group.buckets);
    const buckets = (sourceBuckets || []).filter(
      (bucket) => !bucket.disabled && typeof bucket.remaining === 'number',
    );
    if (!buckets.length) return groups[0]?.buckets?.[0] || null;
    return buckets.reduce((min, bucket) =>
      (bucket.remaining ?? 100) < (min.remaining ?? 100) ? bucket : min,
    );
  }, [agent.orcaSessionId, agyQuota, transcript?.model]);
  const agyRemainingPct =
    typeof agyBucket?.remaining === 'number'
      ? Math.max(0, Math.min(100, agyBucket.remaining))
      : 0;
  const agyTimeLabel = agyBucket?.resetAt ? remainingUntilLabel(agyBucket.resetAt) : null;
  const agyRemainingLabel = agyBucket?.disabled
    ? '미적용'
    : typeof agyBucket?.remaining === 'number'
      ? `${agyBucket.remaining}%`
      : '—';
  const agyScreen = useMemo(() => agyStatus(snapshot?.tail ?? []), [snapshot]);
  const agyUsageGroup = useMemo(() => {
    const groups = agyQuota?.groups || [];
    return (
      groups.find(
        (group) =>
          /gemini/i.test(group.name) || group.models.some((model) => /gemini/i.test(model)),
      ) ||
      groups[0] ||
      null
    );
  }, [agyQuota]);
  const agyUsageText = useMemo(() => {
    if (!isAgy) return '';
    const parts: string[] = [];
    if (agyScreen.weekly) parts.push(`주간 ${agyScreen.weekly}%`);
    if (agyScreen.fiveHour) parts.push(`5시간 ${agyScreen.fiveHour}%`);
    if (!parts.length && agyUsageGroup) {
      for (const bucket of agyUsageGroup.buckets.slice(0, 2)) {
        if (typeof bucket.remaining !== 'number') continue;
        const key = `${bucket.name} ${bucket.window}`;
        const label = /week|주간/i.test(key)
          ? '주간'
          : /5|five|시간/i.test(key)
            ? '5시간'
            : bucket.name;
        parts.push(`${label} ${bucket.remaining}%`);
      }
    }
    return parts.join(' · ') || '사용량 —';
  }, [agyScreen, agyUsageGroup, isAgy]);
  // Orca-managed Agy chats have no terminal screen to read the model from, so
  // fall back to the Agy bridge's configured default model.
  const [agyDefault, setAgyDefault] = useState<{ model: string; effort: string } | null>(null);
  useEffect(() => {
    if (!isAgy || agyScreen.model) return;
    let alive = true;
    void (async () => {
      try {
        const [cfg, prov] = await Promise.all([
          fetch('/agy-api/config', { credentials: 'include' }).then((r) => r.json()),
          fetch('/agy-api/config/providers', { credentials: 'include' }).then((r) => r.json()),
        ]);
        const id = cfg?.model as string;
        const meta = prov?.providers?.[0]?.models?.[id];
        if (alive && id) setAgyDefault({ model: meta?.name || id, effort: 'high' });
      } catch {
        /* keep placeholder */
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAgy, agyScreen.model]);
  const [agyModelOverride, setAgyModelOverride] = useState<string | null>(null);
  const [liveDrawerModels, setLiveDrawerModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    setAgyModelOverride(null);
  }, [agent.id, agent.orcaSessionId]);
  const liveTranscriptModelId =
    transcript?.model
      ? transcript.effort && !transcript.model.toLowerCase().endsWith(`-${transcript.effort.toLowerCase()}`)
        ? `${transcript.model}-${transcript.effort.toLowerCase()}`
        : transcript.model
      : null;
  const pickedAgyModel =
    agyModelOverride ||
    liveTranscriptModelId ||
    (agent.orcaSessionId ? localStorage.getItem(`agyModel:${agent.orcaSessionId}`) : null);
  const pickedLabel = pickedAgyModel
    ? resolveModelLabel(pickedAgyModel, agent.agent, liveDrawerModels)
    : null;
  const pickedEffort = pickedLabel?.match(/\((Low|Medium|High|XHigh|Max|Ultra)\)\s*$/i)?.[1]?.toLowerCase();
  const agyModelLabel =
    pickedLabel?.replace(/\s*\((Low|Medium|High|XHigh|Max|Ultra)\)\s*$/i, '').trim() ||
    agyScreen.model ||
    (!isAgyChat && isAgy ? agyDefault?.model : null) ||
    (isCodex ? 'GPT-6 Luna' : isClaude ? 'Claude Opus 4.6' : isAgy ? '모델' : displayMeta.label);
  const agyEffortLabel =
    pickedEffort ||
    agyScreen.effort ||
    (!isAgyChat && isAgy ? agyDefault?.effort : null) ||
    (isCodex || isClaude ? 'medium' : 'effort');
  // A chat stays a chat even if Orca also exposes a terminal handle for it.
  const canShowTerminal = Boolean(agent.terminalHandle) && !isChat;
  const isThinking =
    (isFreebuff && freebuffSession?.state === 'working') ||
    (transcript ? transcript.state === 'working' : agent.state === 'working');
  const freebuffStreaming = isFreebuff && (isThinking || freebuffHot);
  const displayTail = useMemo(
    () => (isFreebuff ? cleanFreebuffTail(snapshot?.tail ?? []) : snapshot?.tail ?? []),
    [isFreebuff, snapshot],
  );
  const displayBlocks = useMemo(() => terminalBlocks(displayTail), [displayTail]);
  const freebuffFlow = useMemo<DeskFlowItem[]>(() => {
    if (!isFreebuff || sentMessages.length === 0) {
      return displayBlocks.map((block, index) => ({
        kind: 'block' as const,
        block,
        key: `block-${index}-${block.kind}`,
      }));
    }

    // Put each user turn back into the live log instead of pinning a separate
    // "sent messages" list below the terminal. New turns know how many output
    // blocks existed when they were sent; older turns fall back to finding
    // their echoed prompt in the output.
    const slots = new Map<number, FreebuffSentMessage[]>();
    const blockText = displayBlocks.map((block) =>
      block.lines.join(' ').replace(/\s+/g, ' ').toLowerCase(),
    );
    let searchFrom = 0;
    for (const message of sentMessages) {
      let position = -1;
      if (typeof message.afterBlock === 'number') {
        position = Math.max(0, Math.min(displayBlocks.length, message.afterBlock));
      } else {
        const needle = message.text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 64);
        if (needle) {
          for (let index = searchFrom; index < blockText.length; index += 1) {
            if (blockText[index].includes(needle)) {
              position = index;
              searchFrom = index + 1;
              break;
            }
          }
        }
        if (position < 0) position = displayBlocks.length;
      }
      const current = slots.get(position) || [];
      current.push(message);
      slots.set(position, current);
    }

    const flow: DeskFlowItem[] = [];
    displayBlocks.forEach((block, index) => {
      for (const message of slots.get(index) || []) {
        flow.push({ kind: 'message', message, key: `message-${message.id}` });
      }
      flow.push({ kind: 'block', block, key: `block-${index}-${block.kind}` });
    });
    for (const message of slots.get(displayBlocks.length) || []) {
      flow.push({ kind: 'message', message, key: `message-${message.id}` });
    }
    return flow;
  }, [displayBlocks, isFreebuff, sentMessages]);
  const freebuffSessionEntries = useMemo(
    () =>
      freebuffSession?.ok && Array.isArray(freebuffSession.entries)
        ? freebuffSession.entries
        : [],
    [freebuffSession],
  );
  const freebuffPendingCommand = useMemo(() => {
    if (!isFreebuff || isOpenCode || freebuffSession?.state !== 'working') return null;
    if (snapshot?.status !== 'running') return null;
    const last = freebuffSessionEntries[freebuffSessionEntries.length - 1];
    if (!last) return null;
    if (last.kind === 'tool' || last.kind === 'error') return null;
    if (last.kind === 'message' && last.role !== 'assistant') return null;

    const command = freebuffRunningCommand(snapshot?.tail ?? []);
    if (!command) return null;
    const lastTool = [...freebuffSessionEntries].reverse().find(
      (entry): entry is Extract<FreebuffSessionEntry, { kind: 'tool' }> => entry.kind === 'tool',
    );
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    if (lastTool && normalize(lastTool.command) === normalize(command)) return null;
    return command;
  }, [freebuffSession?.state, freebuffSessionEntries, isFreebuff, isOpenCode, snapshot]);
  const logNeedle = logQuery.trim().toLowerCase();
  const visibleFreebuffEntries = useMemo(() => {
    if (!logNeedle) return freebuffSessionEntries;
    return freebuffSessionEntries.filter((entry) => {
      const text =
        entry.kind === 'tool'
          ? `${entry.name} ${entry.command} ${entry.output || ''}`
          : entry.text;
      return text.toLowerCase().includes(logNeedle);
    });
  }, [freebuffSessionEntries, logNeedle]);
  const visibleAgyEntries = useMemo(() => {
    if (!logNeedle) return agyEntries;
    return agyEntries.filter((entry) =>
      `${entry.name || ''} ${entry.tool || ''} ${entry.text || ''}`
        .toLowerCase()
        .includes(logNeedle),
    );
  }, [agyEntries, logNeedle]);
  // Only the final entry of the visible timeline can still be streaming. This
  // keeps a thought from a previous turn from animating while the next turn is
  // already running (which made old reasoning look like it arrived late).
  const lastVisibleFreebuffEntry = visibleFreebuffEntries[visibleFreebuffEntries.length - 1];
  const lastThinkingIndex =
    lastVisibleFreebuffEntry?.kind === 'thinking' ? visibleFreebuffEntries.length - 1 : -1;
  const lastAssistantIndex =
    lastVisibleFreebuffEntry?.kind === 'message' && lastVisibleFreebuffEntry.role === 'assistant'
      ? visibleFreebuffEntries.length - 1
      : -1;
  const freebuffWindowStart = logNeedle
    ? 0
    : Math.max(0, visibleFreebuffEntries.length - freebuffHistoryLimit);
  const renderedFreebuffEntries = visibleFreebuffEntries.slice(freebuffWindowStart);
  const searchMatchCount = logNeedle
    ? view === 'chat' && hasTranscript
      ? visibleAgyEntries.length
      : freebuffSessionEntries.length
        ? visibleFreebuffEntries.length
        : displayTail.filter((line) => line.toLowerCase().includes(logNeedle)).length
    : 0;
  const freebuffErrorCount = useMemo(
    () => freebuffSessionEntries.filter((entry) => entry.kind === 'error').length,
    [freebuffSessionEntries],
  );
  const pendingFreebuffMessages = useMemo(() => {
    if (!freebuffSessionEntries.length) return [];
    const updatedAt = freebuffSession?.updatedAt || 0;
    const sessionTexts = new Set(
      freebuffSessionEntries.flatMap((entry) =>
        entry.kind === 'message' && entry.role === 'user'
          ? [entry.text.replace(/\s+/g, ' ').trim()]
          : [],
      ),
    );
    let lastUserAt = 0;
    for (const entry of freebuffSessionEntries) {
      if (entry.kind !== 'message' || entry.role !== 'user' || !entry.at) continue;
      const at = Date.parse(entry.at);
      if (Number.isFinite(at) && at > lastUserAt) lastUserAt = at;
    }
    return sentMessages.filter((message) => {
      const text = message.text.replace(/\s+/g, ' ').trim();
      if (sessionTexts.has(text)) return false;
      // A failed send can still touch the chat file when Freebuff writes the
      // error row, so compare against the last echoed user turn instead of
      // relying on the file mtime alone.
      if (lastUserAt) return message.at >= lastUserAt - 2000;
      return message.at > updatedAt - 10 * 60_000;
    });
  }, [freebuffSession?.updatedAt, freebuffSessionEntries, sentMessages]);
  const freebuffMeta = useMemo(
    () => freebuffStatus(snapshot?.tail ?? [], agent.state === 'working'),
    [agent.state, snapshot],
  );
  const observedFreebuffTimeLeft =
    freebuffMeta.left ||
    (freebuffMeta.hoursRemaining !== null ? `${freebuffMeta.hoursRemaining}시간` : null);
  useEffect(() => {
    // Freebuff replaces its `41m left` row with `working...` while a turn is
    // running. Keep the last observed value instead of dropping the timer.
    if (observedFreebuffTimeLeft) setFreebuffTimeLeft(observedFreebuffTimeLeft);
  }, [observedFreebuffTimeLeft]);
  const freebuffTimeLabel = freebuffTimeLeft;
  const fbTodos = useMemo(() => {
    let lastUserIdx = -1;
    for (let i = freebuffSessionEntries.length - 1; i >= 0; i -= 1) {
      const item = freebuffSessionEntries[i];
      if (item.kind === 'message' && item.role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    const turnEntries =
      lastUserIdx >= 0
        ? freebuffSessionEntries.slice(lastUserIdx + 1)
        : freebuffSessionEntries;
    const fbTools = turnEntries.filter(
      (e): e is Extract<FreebuffSessionEntry, { kind: 'tool' }> => e.kind === 'tool',
    );
    const fbTexts = turnEntries.flatMap((e) =>
      (e.kind === 'message' && e.role === 'assistant') || e.kind === 'thinking'
        ? [e.text]
        : [],
    );
    return deriveTodosFromTools(fbTools, fbTexts, isThinking);
  }, [freebuffSessionEntries, isThinking]);

  const agyTodos = useMemo(() => {
    let lastUserIdx = -1;
    for (let i = agyEntries.length - 1; i >= 0; i -= 1) {
      const item = agyEntries[i];
      if (item.kind === 'message' && item.role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    const turnEntries =
      lastUserIdx >= 0 ? agyEntries.slice(lastUserIdx + 1) : agyEntries;
    const agyTools = turnEntries.filter((e) => e.kind === 'tool');
    const agyTexts = turnEntries
      .filter(
        (e) =>
          (e.kind === 'message' && e.role === 'assistant') ||
          e.kind === 'thinking' ||
          e.kind === 'reasoning',
      )
      .map((e) => e.text || '');
    return deriveTodosFromTools(agyTools, agyTexts, isThinking);
  }, [agyEntries, isThinking]);

  const handoffBrief = useMemo(
    () =>
      buildHandoffBrief(
        agent,
        isFreebuff ? freebuffSessionEntries : transcriptEntries,
        displayTail,
      ),
    [agent, displayTail, freebuffSessionEntries, isFreebuff, transcriptEntries],
  );
  const [agyPickerMode, setAgyPickerMode] = useState<'model' | 'effort' | null>(null);
  useEffect(() => {
    if (!agyPickerMode) return;
    let alive = true;
    void orcaApi
      .models(agent.agent)
      .then((res) => {
        if (alive && res.ok && Array.isArray(res.models)) {
          setLiveDrawerModels(res.models);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [agent.agent, agyPickerMode]);
  const agyPickerOpen = agyPickerMode !== null;
  const setAgyPickerOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    setAgyPickerMode((prev) => {
      const want = typeof next === 'function' ? next(prev !== null) : next;
      return want ? prev || 'model' : null;
    });
  };
  const [agyUsageOpen, setAgyUsageOpen] = useState(false);
  const [agySwitching, setAgySwitching] = useState(false);
  const switchAgyModel = async (modelId: string) => {
    if (agySwitching) return;
    setAgySwitching(true);
    setSendError(null);
    try {
      if (agent.terminalHandle) {
        const handle = agent.terminalHandle;
        const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const opened = await orcaApi.sendTerminal(handle, '/model', {
          focus: false,
          waitSubmit: false,
        });
        if (!opened.ok) throw new Error(opened.error || '/model 명령을 열지 못했어요.');
        await pause(750);
        const list = MODEL_OPTIONS[agent.agent] || MODEL_OPTIONS.antigravity || [];
        const targetIndex = list.findIndex((m) => m.id === modelId);
        if (targetIndex >= 0) {
          const snap = await orcaApi.terminal(handle, { screen: true, limit: 400 });
          const tail = (snap.tail ?? []).join('\n');
          const targetLabel = AGY_MODEL_LABEL(modelId);
          // Navigate down to matching row if visible, otherwise select by index
          const lines = (snap.tail ?? []).filter((line) =>
            list.some((m) => line.includes(m.label.replace(/\s*\(\w+\)\s*$/, ''))),
          );
          const curIdx = lines.findIndex((line) => /[›>●▸]/.test(line));
          const tgtIdx = lines.findIndex((line) => line.includes(targetLabel.replace(/\s*\(\w+\)\s*$/, '')));
          if (curIdx >= 0 && tgtIdx >= 0) {
            const delta = tgtIdx - curIdx;
            const key = delta >= 0 ? 'down' : 'up';
            for (let step = 0; step < Math.abs(delta); step += 1) {
              await orcaApi.sendTerminalKey(handle, key);
              await pause(200);
            }
            await orcaApi.sendTerminalKey(handle, 'enter');
          } else if (tail) {
            await orcaApi.sendTerminalKey(handle, 'enter');
          }
          await pause(500);
          void load();
        }
      }
      if (agent.orcaSessionId) {
        await orcaApi.setSessionModel({
          sessionId: agent.orcaSessionId,
          modelId,
        });
        localStorage.setItem(`agyModel:${agent.orcaSessionId}`, modelId);
      }
      setAgyModelOverride(modelId);
      notify(`${resolveModelLabel(modelId, agent.agent, liveDrawerModels)}(으)로 모델을 변경했어요`);
      setAgyPickerOpen(false);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '모델을 바꾸지 못했어요.');
    } finally {
      setAgySwitching(false);
    }
  };
  const freebuffModelLabel =
    freebuffModelOverride || freebuffMeta.model || FREEBUFF_PICKER_MODELS[0].label;
  const freebuffMultiplier =
    FREEBUFF_PICKER_MODELS.find((model) => model.label === freebuffModelLabel)?.multiplier ??
    freebuffMeta.modelMultiplier;
  const freebuffModelConfig = FREEBUFF_PICKER_MODELS.find(
    (model) => model.label === freebuffModelLabel,
  );
  const freebuffEfforts: FreebuffEffort[] =
    freebuffModelConfig?.efforts ?? ['low', 'medium', 'high'];
  const freebuffEffortLabel = (
    freebuffMeta.effort ||
    freebuffEffortOverride ||
    freebuffModelConfig?.defaultEffort ||
    'effort'
  ).toLowerCase();
  const freebuffContextPct = Number.isFinite(freebuffMeta.contextPercent)
    ? Math.max(0, Math.min(100, freebuffMeta.contextPercent))
    : 0;
  const openFreebuffPanel = (panel: 'model' | 'effort' | 'usage') => {
    window.clearTimeout(freebuffPanelTimerRef.current);
    setFreebuffClosing(false);
    setFreebuffPanel(panel);
  };

  const closeFreebuffPanel = () => {
    if (!freebuffPanel) return;
    window.clearTimeout(freebuffPanelTimerRef.current);
    setFreebuffClosing(true);
    freebuffPanelTimerRef.current = window.setTimeout(() => {
      setFreebuffPanel(null);
      setFreebuffClosing(false);
    }, 260);
  };

  const toggleFreebuffPanel = (panel: 'model' | 'effort' | 'usage') => {
    if (freebuffPanel === panel && !freebuffClosing) closeFreebuffPanel();
    else openFreebuffPanel(panel);
  };

  const load = useCallback(async () => {
    const now = Date.now();
    // A terminal read can occasionally hang on a stale host connection. Do not
    // let that one request disable polling forever: take over after 6 seconds.
    if (loadInFlightRef.current && now - loadStartedAtRef.current < 6_000) return;
    loadInFlightRef.current = true;
    loadStartedAtRef.current = now;
    const token = ++loadTokenRef.current;
    if (!agent.terminalHandle && !agent.orcaSessionId) {
      setError('이 에이전트의 터미널 핸들을 찾지 못했습니다.');
      setLoading(false);
      loadInFlightRef.current = false;
      return;
    }
    try {
      // Start the structured transcript and Freebuff chat store alongside the
      // terminal read. Waiting for the terminal first made the chat pane lag a
      // full round-trip behind the live session while Freebuff was working.
      if (agent.orcaSessionId) {
        const expectedSessionId = agent.orcaSessionId;
        void orcaApi
          .transcript(expectedSessionId)
          .then((next) => {
            if (token !== loadTokenRef.current) return;
            if (next.orcaSessionId && next.orcaSessionId !== expectedSessionId) return;
            setTranscript((current) => {
              if (
                current &&
                current.entries.length > 0 &&
                (!next.entries || next.entries.length === 0)
              ) {
                return current;
              }
              return next;
            });
          })
          .catch(() => undefined);
      }
      // Freebuff's chat store has its own fast poll below. Keeping it out of
      // this terminal request means a slow terminal read can never hold back
      // reasoning or assistant text.
      // The structured Freebuff store is the authoritative fast path. Its
      // terminal tail is only needed for model/time chrome, so read it less
      // often instead of blocking the session poll every 500ms.
      const terminalInterval = isFreebuff ? 1600 : 800;
      if (
        agent.terminalHandle &&
        (!isFreebuff ||
          !snapshotRef.current ||
          now - lastTerminalReadRef.current >= terminalInterval)
      ) {
        lastTerminalReadRef.current = now;
        try {
          const next = await orcaApi.terminal(agent.terminalHandle, {
            screen: !isFreebuff,
            limit: isFreebuff ? 5000 : 800,
          });
          if (token !== loadTokenRef.current) return;
          setSnapshot(next);
          setError(null);
        } catch (cause) {
          if (token !== loadTokenRef.current) return;
          setError(cause instanceof Error ? cause.message : '로그를 읽지 못했어요.');
        }
      }
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false);
        loadInFlightRef.current = false;
      }
    }
  }, [agent.path, agent.terminalHandle, agent.orcaSessionId, isFreebuff, isOpenCode]);

  const loadFreebuffSession = useCallback(async () => {
    if (!isFreebuff) return;
    const now = Date.now();
    if (sessionInFlightRef.current && now - sessionStartedAtRef.current < 4_000) return;
    sessionInFlightRef.current = true;
    sessionStartedAtRef.current = now;
    const token = ++sessionTokenRef.current;
    try {
      const sinceKey = agent.terminalHandle || agent.orcaSessionId;
      const lockedChat = sinceKey
        ? localStorage.getItem(`boundChat:${sinceKey}`) || undefined
        : undefined;
      // Only ask for an increment when this handle is already pinned to a
      // chat; the first read still has to list chats to find it.
      const since =
        lockedChat && sessionSinceRef.current ? sessionSinceRef.current : undefined;
      const next = await orcaApi.freebuffSession(
        agent.path,
        isOpenCode ? 'opencode' : undefined,
        since,
        agent.terminalHandle || undefined,
        lockedChat,
      );
      if (token !== sessionTokenRef.current) return;
      if (next.ok && next.chatId && sinceKey) {
        try {
          localStorage.setItem(`boundChat:${sinceKey}`, next.chatId);
        } catch {
          // ignore
        }
      }
      if (next.ok && typeof next.updatedAt === 'number') {
        sessionSinceRef.current = next.updatedAt;
      }
      if (next.ok && Array.isArray(next.entries) && next.entries.length > 0) {
        setFreebuffHot(true);
      }
      setFreebuffSession((current) => {
        const nextEntries = next.entries || [];
        const sameChat =
          !current?.chatId || !next.chatId || current.chatId === next.chatId;
        const keepEntries =
          Boolean(current?.ok && current.entries.length) &&
          (!next.ok || nextEntries.length === 0 || !sameChat);
        if (current && keepEntries) {
          const state = next.ok ? next.state ?? current.state : current.state;
          const updatedAt = next.updatedAt ?? current.updatedAt;
          if (state === current.state && updatedAt === current.updatedAt) {
            return current;
          }
          return {
            ...current,
            state,
            updatedAt,
            fetchedAt: next.fetchedAt ?? current.fetchedAt,
            unchanged: next.unchanged,
          };
        }
        const mergedEntries =
          current && sameChat
            ? mergeFreebuffEntries(current.entries, nextEntries)
            : nextEntries;
        const entriesChanged =
          !current ||
          current.entries.length !== mergedEntries.length ||
          mergedEntries.some((entry, index) => entry !== current.entries[index]);
        return !current ||
          current.updatedAt !== next.updatedAt ||
          current.state !== next.state ||
          current.chatId !== next.chatId ||
          entriesChanged
          ? { ...next, entries: mergedEntries }
          : current;
      });
    } catch {
      // A transient poll failure should never blank the live transcript.
    } finally {
      if (token === sessionTokenRef.current) sessionInFlightRef.current = false;
    }
  }, [agent.path, agent.terminalHandle, agent.orcaSessionId, isFreebuff, isOpenCode]);

  useEffect(() => {
    void load();
    if (isFreebuff) void loadFreebuffSession();

    // While Freebuff is thinking its chat store changes several times a second.
    // Poll that file on its own loop, independent from terminal reads, and wait
    // for each response before scheduling the next one so requests cannot pile up.
    let sessionPollClosed = false;
    let sessionTimer = 0;
    const pollSession = () => {
      if (sessionPollClosed || !isFreebuff) return;
      const delay = isThinking
        ? isOpenCode
          ? 120
          : 50
        : isOpenCode
          ? 600
          : 180;
      sessionTimer = window.setTimeout(() => {
        void (async () => {
          if (sessionPollClosed) return;
          if (document.visibilityState === 'visible') await loadFreebuffSession();
          pollSession();
        })();
      }, delay);
    };
    if (isFreebuff) pollSession();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, isFreebuff ? 900 : isThinking ? 450 : 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
        if (isFreebuff) void loadFreebuffSession();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      sessionPollClosed = true;
      window.clearInterval(timer);
      window.clearTimeout(sessionTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isFreebuff, isOpenCode, isThinking, load, loadFreebuffSession]);

  /* keep the transcript fresh even when the terminal read is slow */
  useEffect(() => {
    if (!agent.orcaSessionId) return;
    const expectedSessionId = agent.orcaSessionId;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void orcaApi
          .transcript(expectedSessionId)
          .then((next) => {
            if (next.orcaSessionId && next.orcaSessionId !== expectedSessionId) return;
            setTranscript((current) => {
              if (!current) return next;
              if (
                current.entries.length > 0 &&
                (!next.entries || next.entries.length === 0)
              ) {
                return current;
              }
              if (
                current.state === next.state &&
                current.model === next.model &&
                current.effort === next.effort &&
                current.entries.length === next.entries.length
              ) {
                const lastCur = current.entries[current.entries.length - 1];
                const lastNext = next.entries[next.entries.length - 1];
                if (
                  lastCur?.kind === lastNext?.kind &&
                  lastCur?.text === lastNext?.text &&
                  lastCur?.state === lastNext?.state &&
                  lastCur?.detail === lastNext?.detail
                ) {
                  return current;
                }
              }
              return next;
            });
          })
          .catch(() => undefined);
      }
    }, 900);
    return () => window.clearInterval(timer);
  }, [agent.orcaSessionId]);

  useEffect(() => {
    // A Freebuff terminal can keep running after Orca's transcript stops
    // updating. Prefer the live terminal for it; the user can still switch
    // back to the last Orca transcript with the toggle.
    setView(isShell ? 'terminal' : 'chat');
  }, [isFreebuff, isShell, agent.terminalHandle]);

  useEffect(() => {
    if (!followRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    // The transcript arrives asynchronously after the terminal snapshot, so
    // scroll again after React has painted the new message/reasoning blocks.
    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    const timer = window.setTimeout(scrollToBottom, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [
    snapshot,
    transcript,
    transcriptEntries.length,
    freebuffSession?.updatedAt,
    freebuffSessionEntries.length,
    view,
    follow,
  ]);

  useEffect(() => {
    // Freebuff types a saved step in character by character after the session
    // poll has already returned. The dependency-only scroll above cannot see
    // those characterData changes, so follow mode used to stop just above the
    // newest text. Observe the rendered content itself, not just the payload.
    const el = bodyRef.current;
    if (!el) return;
    let frame = 0;
    const stick = () => {
      if (!followRef.current || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const node = bodyRef.current;
        if (node && followRef.current) node.scrollTop = node.scrollHeight;
      });
    };
    const resize = new ResizeObserver(stick);
    const observed = new WeakSet<Element>();
    const observeNode = (node: Element | null) => {
      if (!node || observed.has(node)) return;
      observed.add(node);
      resize.observe(node);
    };
    const mutation = new MutationObserver(() => {
      observeNode(el.firstElementChild);
      for (const child of Array.from(el.children)) observeNode(child);
      stick();
    });
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    observeNode(el.firstElementChild);
    for (const child of Array.from(el.children)) observeNode(child);
    const onLoad = () => stick();
    el.addEventListener('load', onLoad, true);
    return () => {
      window.cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
      el.removeEventListener('load', onLoad, true);
    };
  }, [error, hasTranscript, view]);

  useEffect(() => {
    if (!freebuffPanel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || freebuffClosing) return;
      event.preventDefault();
      closeFreebuffPanel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [freebuffClosing, freebuffPanel]);

  useEffect(() => () => window.clearTimeout(freebuffPanelTimerRef.current), []);

  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionsOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setFreebuffModelOverride(null);
    setFreebuffEffortOverride(null);
  }, [agent.terminalHandle]);

  useEffect(() => {
    if (sentPathRef.current === agent.path) return;
    sentPathRef.current = agent.path;
    setSentMessages(readFreebuffSent(agent.path));
    setResumeTicket(readFreebuffResume(agent.path));
    setFreebuffSession(null);
  }, [agent.path]);

  useEffect(() => {
    if (sentPathRef.current !== agent.path) return;
    writeFreebuffSent(agent.path, sentMessages);
  }, [agent.path, sentMessages]);

  const copy = async () => {
    if (!snapshot && !hasTranscript) return;
    const copyEntries = agyEntries;
    const copyText =
      view === 'chat' && hasTranscript
        ? copyEntries
            .map((entry) =>
              entry.kind === 'tool'
                ? `TOOL: ${entry.name || 'tool'}${entry.state ? ` (${entry.state})` : ''}`
                : `${entry.role === 'user' ? 'YOU' : 'AGENT'}: ${entry.text || ''}`,
            )
            .join('\n\n')
        : displayTail.join('\n');
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard can fail silently
    }
  };

  const selectFreebuffModel = async (targetLabel: string) => {
    if (!agent.terminalHandle || freebuffSwitching || sending) return;
    const targetIndex = FREEBUFF_PICKER_MODELS.findIndex((model) => model.label === targetLabel);
    if (targetIndex < 0) return;
    if (freebuffModelLabel === targetLabel) {
      closeFreebuffPanel();
      return;
    }

    const handle = agent.terminalHandle;
    const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const press = async (key: 'up' | 'down' | 'enter' | 'escape') => {
      const result = await orcaApi.sendTerminalKey(handle, key);
      if (!result.ok) throw new Error(result.error || '키를 전달하지 못했어요.');
      await pause(300);
    };
    const readSelected = async () => {
      const snap = await orcaApi.terminal(handle, { screen: true, limit: 400 });
      return selectedFreebuffPickerModel(snap.tail ?? []);
    };

    setFreebuffSwitching(true);
    setSendError(null);
    try {
      const opened = await orcaApi.sendTerminal(handle, '/model', {
        focus: false,
        waitSubmit: false,
      });
      if (!opened.ok) throw new Error(opened.error || '모델 피커를 열지 못했어요.');
      await pause(850);

      let selected = await readSelected();
      if (!selected) throw new Error('Freebuff 모델 피커가 열리지 않았어요.');

      // Walk up to the first picker row without depending on the current
      // model. Freebuff's picker wraps, so stop as soon as the first row is
      // highlighted rather than sending a fixed number of keys.
      const first = FREEBUFF_PICKER_MODELS[0].label;
      for (let step = 0; step < FREEBUFF_PICKER_MODELS.length + 2; step += 1) {
        if (selected === first) break;
        await press('up');
        selected = await readSelected();
      }
      if (selected !== first) throw new Error('피커의 첫 모델로 이동하지 못했어요.');

      for (let step = 0; step < targetIndex; step += 1) {
        await press('down');
      }
      await press('enter');
      await pause(900);

      // Confirm the footer, not just the picker highlight. This is the part
      // that previously made a successful switch look like it did nothing:
      // the sheet closed while the old DeepSeek fallback stayed on screen.
      const confirmed = freebuffStatus(
        (await orcaApi.terminal(handle, { screen: true, limit: 400 })).tail ?? [],
        false,
      ).model;
      if (confirmed && confirmed !== targetLabel) {
        throw new Error(`모델이 ${confirmed}(으)로 남아 있어요. 다시 선택해 주세요.`);
      }
      setFreebuffModelOverride(targetLabel);
      setFreebuffEffortOverride(null);
      setView('terminal');
      closeFreebuffPanel();
      // Do not hold the controls hostage while a 2s terminal refresh happens;
      // the next model can be selected immediately.
      void load();
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '모델을 바꾸지 못했어요.');
      try {
        await orcaApi.sendTerminalKey(handle, 'escape');
      } catch {
        // The next terminal refresh will show the picker state.
      }
    } finally {
      setFreebuffSwitching(false);
    }
  };

  const selectFreebuffEffort = async (effort: FreebuffEffort) => {
    if (!agent.terminalHandle || freebuffSwitching || sending) return;
    if (freebuffEffortLabel === effort) {
      closeFreebuffPanel();
      return;
    }

    const handle = agent.terminalHandle;
    const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    setFreebuffSwitching(true);
    setSendError(null);
    try {
      const sent = await orcaApi.sendTerminal(handle, `/reasoning ${effort}`, {
        focus: false,
        waitSubmit: false,
      });
      if (!sent.ok) throw new Error(sent.error || 'Effort 명령을 보내지 못했어요.');

      // `/reasoning` changes the next turn only; the selected model stays put.
      // Confirm against Freebuff's footer instead of assuming the command ran.
      let confirmed: string | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await pause(250);
        const snapshot = await orcaApi.terminal(handle, { screen: true, limit: 400 });
        confirmed = freebuffStatus(snapshot.tail ?? [], false).effort;
        if (confirmed === effort) break;
      }
      if (confirmed && confirmed !== effort) {
        throw new Error(`Effort가 ${confirmed}(으)로 남아 있어요. 지원하지 않는 단계인지 확인해 주세요.`);
      }
      setFreebuffEffortOverride(effort);
      closeFreebuffPanel();
      void load();
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : 'Effort를 바꾸지 못했어요.');
      try {
        await orcaApi.sendTerminalKey(handle, 'escape');
      } catch {
        // The next terminal refresh will show the command state.
      }
    } finally {
      setFreebuffSwitching(false);
    }
  };

  const attachData = async (name: string, data: string) => {
    setAttaching(true);
    setSendError(null);
    try {
      const result = await orcaApi.attach({ name, data });
      setAttachment({ path: result.path, name: result.name, size: result.size });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '파일을 저장하지 못했어요.');
    } finally {
      setAttaching(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (attaching) return;
    if (file.size > 20 * 1024 * 1024) {
      setSendError('파일은 20MB 이하만 전송할 수 있어요.');
      return;
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
      reader.readAsDataURL(file);
    }).catch((cause: unknown) => {
      setSendError(cause instanceof Error ? cause.message : '파일을 읽지 못했어요.');
      return '';
    });
    if (!data) return;
    await attachData(file.name, data);
  };

  const attachFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void uploadFile(file);
  };

  const pasteFiles = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(event.clipboardData?.files || [])[0];
    if (!file) return;
    event.preventDefault();
    void uploadFile(file);
  };

  const dropFile = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  };

  const attachUrl = async () => {
    const url = window.prompt('다운로드할 파일 URL을 입력하세요.');
    if (!url?.trim()) return;
    setAttaching(true);
    setSendError(null);
    try {
      const result = await orcaApi.attachUrl(url.trim());
      setAttachment({ path: result.path, name: result.name, size: result.size });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : 'URL에서 파일을 받지 못했어요.');
    } finally {
      setAttaching(false);
    }
  };

  const sendReply = async (event?: FormEvent) => {
    event?.preventDefault();
    const outgoingText = reply.trim();
    const text = [outgoingText, attachment ? `첨부 파일: ${attachment.path}` : '']
      .filter(Boolean)
      .join('\n\n');
    if (!text || sending) return;
    const toId = agent.terminalHandle || agent.id;
    if (!toId) {
      setSendError('메시지를 받을 세션을 찾지 못했어요.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      // Freebuff's TUI input is the reliable path for an already-open parallel
      // worktree terminal. Orchestration is kept as a fallback for older hosts.
      if ((isFreebuff || isShell) && agent.terminalHandle) {
        const sent = await orcaApi.sendTerminal(agent.terminalHandle, text, {
          focus: isFreebuff,
          waitSubmit: isFreebuff,
        });
        if (!sent.ok) throw new Error(sent.error || '터미널 입력을 전달하지 못했어요.');
      } else {
        const result = await orcaApi.sendMessage({ text, toId });
        if (result.ok === false || result.error) {
          throw new Error(result.error || 'Freebuff 세션에 메시지를 전달하지 못했어요.');
        }
      }
      setReply('');
      setAttachment(null);
      setSent(true);
      setLastSent(text);
      if (isFreebuff) {
        setSentMessages((current) =>
          [
            ...current,
            {
              id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              text: outgoingText || (attachment ? `첨부 파일: ${attachment.name}` : text),
              at: Date.now(),
              afterBlock: displayBlocks.length,
            },
          ].slice(-FREEBUFF_SENT_LIMIT),
        );
      }
      setView(isShell ? 'terminal' : 'chat');
      followRef.current = true;
      setFollow(true);
      window.setTimeout(() => setSent(false), 1600);
      const refresh = () => {
        void load();
      };
      window.setTimeout(refresh, 700);
      window.setTimeout(refresh, 2200);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '메시지를 전달하지 못했어요.');
    } finally {
      setSending(false);
    }
  };

  const interrupt = async () => {
    if (!agent.terminalHandle || interrupting) return;
    setInterrupting(true);
    setSendError(null);
    try {
      const result = await orcaApi.interrupt(agent.terminalHandle);
      if (!result.ok) throw new Error(result.error || '중단 신호를 보내지 못했어요.');
      setInterrupted(true);
      window.setTimeout(() => setInterrupted(false), 1800);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '중단하지 못했어요.');
    } finally {
      setInterrupting(false);
    }
  };

  const continueSession = async (options?: { automatic?: boolean }) => {
    if (!isFreebuff || continuing) return;
    // The button is already an explicit action. Resume immediately instead of
    // interrupting the flow with a browser confirmation dialog.
    setContinuing(true);
    setSendError(null);
    setError(null);
    const pendingText = [...pendingFreebuffMessages.map((message) => message.text), reply.trim()]
      .map((text) => text.trim())
      .filter(Boolean)
      .filter(
        (text, index, all) =>
          all.findIndex((item) => item.replace(/\s+/g, ' ') === text.replace(/\s+/g, ' ')) ===
          index,
      )
      .join('\n\n');
    if (options?.automatic) {
      setAutoRecovery('resuming');
      setAutoRecoveryNote('세션이 끝나 자동으로 다시 여는 중…');
    }
    try {
      const result = await orcaApi.continueFreebuff({
        handle: agent.terminalHandle,
        path: agent.path,
        chatId: freebuffSession?.chatId || null,
      });
      onOverview(result.overview);
      if (pendingText) {
        // Persist before onContinue remounts the drawer with the new handle.
        writeFreebuffResume(agent.path, {
          text: pendingText,
          chatId: result.chatId || freebuffSession?.chatId || null,
          previousHandle: agent.terminalHandle || null,
          at: Date.now(),
        });
        const pendingIds = new Set(pendingFreebuffMessages.map((message) => message.id));
        const nextSent = [
          ...sentMessages.filter((message) => !pendingIds.has(message.id)),
          {
            id: `fb_resume_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            text: pendingText,
            at: Date.now(),
          },
        ].slice(-FREEBUFF_SENT_LIMIT);
        writeFreebuffSent(agent.path, nextSent);
        setSentMessages(nextSent);
        setReply('');
        setAutoRecovery('sending');
        setAutoRecoveryNote('미전송 메시지를 새 세션으로 전달할 준비 중…');
      } else if (options?.automatic) {
        setAutoRecovery('done');
        setAutoRecoveryNote('끊긴 Freebuff 세션을 다시 열었어요');
      }
      const next = result.overview.agents.find((item) => item.terminalHandle === result.handle);
      onContinue(
        next ?? {
          id: `freebuff-continue:${result.handle}`,
          orcaSessionId: null,
          agent: 'freebuff',
          state: 'waiting',
          title: result.title || 'Freebuff continue',
          prompt: '',
          worktreeId: agent.worktreeId,
          repo: agent.repo,
          path: result.path || agent.path,
          branch: agent.branch,
          terminalHandle: result.handle,
          terminalTitle: result.title,
          terminalPreview: '',
          terminalConnected: true,
          updatedAt: Date.now(),
          interrupted: false,
        },
      );
      if (pendingText) notify('세션을 다시 열고 미전송 메시지를 전송합니다');
      else if (options?.automatic) notify('끊긴 Freebuff 세션을 자동으로 다시 열었어요');
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Freebuff 세션을 이어서 열지 못했어요.';
      setError(message);
      if (options?.automatic) {
        setAutoRecovery('failed');
        setAutoRecoveryNote(`자동 복구 실패: ${message}`);
      }
    } finally {
      setContinuing(false);
    }
  };

  useEffect(() => {
    // After `--continue` the drawer remounts with a new terminal handle. Deliver
    // the merged, previously unsent message once the new TUI is ready.
    if (!isFreebuff || isOpenCode || !resumeTicket) return;
    const handle = agent.terminalHandle;
    if (!handle || handle === resumeTicket.previousHandle) return;
    let cancelled = false;
    setAutoRecovery('sending');
    setAutoRecoveryNote('새 세션에 미전송 메시지를 전달하는 중…');
    const timer = window.setTimeout(async () => {
      try {
        // `--continue` can expose the new handle before the TUI footer is
        // ready. Wait for the prompt so the merged message is not typed into
        // the boot screen and lost.
        for (let attempt = 0; attempt < 7; attempt += 1) {
          const snap = await orcaApi.terminal(handle, { screen: true, limit: 220 });
          const tail = (snap.tail || []).join('\n');
          if (/Enter a coding task|for history|for help|Chat:|model to change/i.test(tail)) {
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 650));
        }
        if (cancelled) return;
        const sent = await orcaApi.sendTerminal(handle, resumeTicket.text, {
          focus: false,
          waitSubmit: true,
        });
        if (!sent.ok) throw new Error(sent.error || '터미널 입력을 전달하지 못했어요.');
        if (cancelled) return;
        writeFreebuffResume(agent.path, null);
        setResumeTicket(null);
        setAutoRecovery('done');
        setAutoRecoveryNote('미전송 메시지를 자동으로 전송했어요');
        notify('미전송 메시지를 자동으로 전송했어요');
        window.setTimeout(() => void load(), 900);
      } catch (cause) {
        if (cancelled) return;
        resumeAttemptsRef.current += 1;
        if (resumeAttemptsRef.current >= 5) {
          setAutoRecovery('failed');
          setAutoRecoveryNote(
            `미전송 메시지를 보내지 못했어요: ${
              cause instanceof Error ? cause.message : '알 수 없는 오류'
            }`,
          );
        } else {
          setResumeRetry((value) => value + 1);
        }
      }
    }, resumeAttemptsRef.current === 0 ? 1200 : 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    agent.path,
    agent.terminalHandle,
    isFreebuff,
    isOpenCode,
    load,
    notify,
    resumeRetry,
    resumeTicket,
  ]);

  useEffect(() => {
    if (!isFreebuff || isOpenCode || continuing || !agent.terminalHandle) return;
    const raw = [
      ...(snapshot?.tail || []),
      ...freebuffSessionEntries.flatMap((entry) =>
        entry.kind === 'error' ? [entry.text] : [],
      ),
    ]
      .join('\n')
      .replace(/\s+/g, ' ');
    if (!FREEBUFF_SESSION_ENDED.test(raw)) return;
    const signature = `${agent.terminalHandle}:${freebuffSession?.chatId || ''}`;
    const bucket = `${signature}:${Math.floor(Date.now() / 20_000)}`;
    if (autoRecoveryRef.current === bucket) return;
    if (!freebuffRecoveryAllowed(agent.path)) {
      setAutoRecovery('failed');
      setAutoRecoveryNote('세션이 반복 종료되어 자동 복구를 멈췄어요. 다시 시도해 주세요.');
      return;
    }
    autoRecoveryRef.current = bucket;
    void continueSession({ automatic: true });
  }, [
    agent.path,
    agent.terminalHandle,
    continueSession,
    continuing,
    freebuffSession?.chatId,
    freebuffSessionEntries,
    isFreebuff,
    isOpenCode,
    snapshot,
  ]);

  const terminate = async () => {
    if (!agent.terminalHandle || closing) return;
    if (!window.confirm('이 터미널을 종료할까요? 실행 중인 에이전트 작업이 중단됩니다.')) return;
    setClosing(true);
    try {
      const result = await orcaApi.closeTerminal(agent.terminalHandle);
      onOverview(result.overview);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '터미널을 종료하지 못했어요.');
    } finally {
      setClosing(false);
    }
  };

  return createPortal(
    <div className="desk-drawer-layer">
      <div className="desk-drawer-backdrop" onClick={onClose} />
      <aside className={`desk-log-panel ${isFreebuff ? 'is-freebuff' : ''}`} role="dialog" aria-modal="true" aria-label="에이전트 로그">
        <div className="desk-log-head">
          <div className="desk-log-title">
            <span className={`desk-agent-badge ${displayMeta.cls}`}>
              <AgentMark id={displayMeta.id} short={displayMeta.short} />
            </span>
            <div>
              <strong title={agent.title}>
                {agent.role && (
                  <em className={`desk-role ${agent.role}`}>{roleLabel(agent.role)}</em>
                )}
                {isFreebuff ? agentLabel : cleanAgentTitle(agent.title)}
              </strong>
              <span>
                {isFreebuff
                  ? `${agent.repo} / ${agent.path.split('/').pop()}`
                  : `${displayMeta.label} · ${agent.repo} / ${agent.path.split('/').pop()}`}
              </span>
            </div>
          </div>
          <div className="desk-log-actions" ref={actionsRef}>
            <button
              className={`desk-icon ${searchOpen ? 'is-active' : ''}`}
              onClick={() => setSearchOpen((value) => !value)}
              title="로그 검색 (Ctrl+F)"
              aria-label="로그 검색"
              aria-expanded={searchOpen}
            >
              <Search size={15} />
            </button>
            <button
              className={`desk-icon ${actionsOpen ? 'is-active' : ''}`}
              onClick={() => setActionsOpen((value) => !value)}
              title="더 보기"
              aria-label="더 보기"
              aria-expanded={actionsOpen}
            >
              <MoreHorizontal size={17} />
            </button>
            <button
              className="desk-icon"
              onClick={onClose}
              title="로그 닫기"
              aria-label="로그 닫기"
            >
              <X size={18} />
            </button>
            {actionsOpen && (
              <div className="desk-log-more" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!snapshot && !hasTranscript}
                  onClick={() => {
                    setActionsOpen(false);
                    void copy();
                  }}
                >
                  <Clipboard size={14} />
                  로그 복사
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsOpen(false);
                    void load();
                  }}
                >
                  <RefreshCw size={14} className={loading ? 'spin' : ''} />
                  새로고침
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsOpen(false);
                    setHandoffOpen(true);
                  }}
                >
                  <ArrowRightLeft size={14} />
                  인수인계
                </button>
                {agent.terminalHandle && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={interrupting}
                    onClick={() => {
                      setActionsOpen(false);
                      void interrupt();
                    }}
                  >
                    <Pause size={14} />
                    {interrupted ? '중단됨' : '작업 중단'}
                  </button>
                )}
                {isFreebuff && !isOpenCode && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={continuing || closing || !agent.path}
                    onClick={() => {
                      setActionsOpen(false);
                      void continueSession();
                    }}
                  >
                    <RotateCcw size={14} />
                    끄고 계속
                  </button>
                )}
                {!isChat && (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    disabled={closing || !agent.terminalHandle}
                    onClick={() => {
                      setActionsOpen(false);
                      void terminate();
                    }}
                  >
                    <Power size={14} />
                    터미널 종료
                  </button>
                )}
                {onOpenInfo && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false);
                      onOpenInfo('info');
                    }}
                  >
                    <PanelRight size={14} />
                    정보 패널
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {searchOpen && (
          <div className="desk-log-searchbar">
            <Search size={14} />
            <input
              value={logQuery}
              onChange={(event) => setLogQuery(event.target.value)}
              placeholder="세션 기록 검색"
              aria-label="세션 기록 검색"
              autoFocus
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();
                if (logQuery) setLogQuery('');
                else setSearchOpen(false);
              }}
            />
            {logNeedle && <span>{searchMatchCount}개</span>}
            <button
              type="button"
              onClick={() => {
                setLogQuery('');
                setSearchOpen(false);
              }}
              aria-label="검색 닫기"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {!isChat && (
        <div className="desk-log-meta">
          <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
          {isAgy && (
            <span className="desk-agy-info" title={`${agyModelLabel} · ${agyUsageText}`}>
              <b>{agyModelLabel}</b>
              {agyScreen.effort ? ` · ${agyScreen.effort}` : ''}
              {` · ${agyUsageText}`}
            </span>
          )}
          <span className={snapshot?.status === 'running' ? 'live' : ''}>
            <span className={`desk-status-dot ${isThinking ? 'working' : agent.state}`} />
            {isChat
              ? isThinking
                ? 'working'
                : transcript?.state || agent.state || 'chat'
              : snapshot?.status || 'reading'}
          </span>
          <span>
            {view === 'chat' && hasTranscript
              ? `${isChat ? 'Orca 채팅' : 'Orca 세션 기록'}${transcript?.state ? ` · ${transcript.state}` : ''}`
              : isFreebuff && freebuffSessionEntries.length
                ? `${agentLabel} 세션 기록 · ${freebuffSessionEntries.length}${
                    freebuffErrorCount ? ` · 오류 ${freebuffErrorCount}` : ''
                  }`
                : snapshot?.source || (isChat ? 'Orca 채팅' : 'screen')}
          </span>
          <span>
            {isChat
              ? 'Orca chat'
              : `handle ${agent.terminalHandle?.replace('term_', '').slice(0, 8) || '—'}`}
          </span>
          {hasTranscript && canShowTerminal && (
            <span className="desk-log-view-toggle">
              <button
                className={view === 'chat' ? 'active' : ''}
                onClick={() => setView('chat')}
              >
                대화
              </button>
              <button
                className={view === 'terminal' ? 'active' : ''}
                onClick={() => setView('terminal')}
              >
                터미널
              </button>
            </span>
          )}
          <button
            className={`desk-follow ${follow ? 'active' : ''}`}
            onClick={() => {
              const next = !follow;
              followRef.current = next;
              setFollow(next);
            }}
          >
            자동 따라가기
          </button>
        </div>
        )}

        {error && !hasTranscript ? (
          <div className="desk-log-error">
            <AlertTriangle size={18} />
            <strong>로그를 읽을 수 없어요</strong>
            <p>{error}</p>
          </div>
        ) : (
          <>
          {error && (
            <div className="desk-log-error inline" role="alert">
              <AlertTriangle size={14} />
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="오류 닫기">
                <X size={13} />
              </button>
            </div>
          )}
          <div
            className={`desk-log-body ${view === 'chat' && hasTranscript ? 'desk-agy-log-body' : ''}`}
            ref={bodyRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              const next = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              followRef.current = next;
              setFollow(next);
            }}
          >
            {view === 'chat' && hasTranscript ? (
              <AgyChatThread
                entries={visibleAgyEntries}
                busy={isThinking}
                copied={copied}
                modelLabel={agyModelLabel}
                effortLabel={agyEffortLabel}
                onCopy={() => void copy()}
                onRefresh={() => void load()}
              />
            ) : isChat ? (
              <div className="desk-loading">
                {loading ? <Loader2 size={17} className="spin" /> : <MessageSquare size={17} />}
                {loading
                  ? '채팅 기록을 불러오는 중…'
                  : isThinking
                    ? '에이전트가 작업 중…'
                    : '아직 표시할 채팅이 없어요.'}
              </div>
            ) : (
              <div className="desk-terminal-lines">
                {isFreebuff && freebuffSessionEntries.length ? (
                  <div className="desk-freebuff-session">
                    {freebuffWindowStart > 0 && (
                      <button
                        type="button"
                        className="desk-freebuff-history-more"
                        onClick={() =>
                          setFreebuffHistoryLimit((value) => value + FREEBUFF_HISTORY_PAGE)
                        }
                      >
                        이전 기록 {freebuffWindowStart.toLocaleString('ko-KR')}개 더 보기
                      </button>
                    )}
                    {renderedFreebuffEntries.map((entry, relativeIndex) => {
                      const index = freebuffWindowStart + relativeIndex;
                      if (entry.kind === 'message') {
                        if (entry.role === 'user') {
                          return (
                            <article className="desk-freebuff-msg" key={freebuffEntryKey(entry, index)}>
                              <p>{cleanUserMessage(entry.text)}</p>
                              {entry.at && (
                                <div className="desk-freebuff-msg-meta">
                                  <time>{entry.at}</time>
                                </div>
                              )}
                            </article>
                          );
                        }
                        const live = freebuffStreaming && index === lastAssistantIndex;
                        return (
                          <article
                            className={`desk-freebuff-agent ${live ? 'is-streaming' : ''}`}
                            key={freebuffEntryKey(entry, index)}
                          >
                            <SmoothTranscriptMarkdown text={entry.text} active={live} />
                          </article>
                        );
                      }
                      if (entry.kind === 'error') {
                        return (
                          <article
                            className="desk-freebuff-error"
                            key={freebuffEntryKey(entry, index)}
                            role="alert"
                          >
                            <AlertTriangle size={14} />
                            <div>
                              <strong>{entry.title || 'Freebuff 오류'}</strong>
                              <p>{entry.text}</p>
                            </div>
                          </article>
                        );
                      }
                      if (entry.kind === 'thinking') {
                        return (
                          <FreebuffThought
                            key={freebuffEntryKey(entry, index)}
                            entry={entry}
                            live={isThinking && index === lastThinkingIndex}
                            streaming={freebuffStreaming && index === lastThinkingIndex}
                          />
                        );
                      }
                      const commandLines = entry.command.split('\n');
                      const firstLine = freebuffToolHead(entry) || entry.name;
                      const commandLineCount = commandLines.filter((line) => line.trim()).length;
                      const hasDiffData =
                        typeof entry.additions === 'number' ||
                        typeof entry.deletions === 'number' ||
                        Boolean(entry.diff) ||
                        typeof entry.oldText === 'string' ||
                        typeof entry.newText === 'string';
                      return (
                        <details
                          className={`desk-tool-card desk-freebuff-tool ${entry.error ? 'has-error' : ''}`}
                          key={freebuffEntryKey(entry, index)}
                        >
                          <summary>
                            <span
                              className={`desk-tool-check ${entry.error ? 'failed' : entry.running ? 'running' : ''}`}
                            >
                              {entry.error ? (
                                <AlertTriangle size={13} />
                              ) : entry.running ? (
                                <Loader2 size={13} className="spin" />
                              ) : (
                                <Check size={13} />
                              )}
                            </span>
                            <span className="desk-tool-terminal">
                              <Terminal size={13} />
                            </span>
                            <strong>{freebuffToolLabel(entry.name)}</strong>
                            <code title={entry.command}>{firstLine}</code>
                            {hasDiffData && (
                              <span className="desk-freebuff-diff-stat" title="변경 줄 수">
                                {typeof entry.additions === 'number' ||
                                typeof entry.deletions === 'number' ? (
                                  <>
                                    <b>+{entry.additions ?? 0}</b>
                                    <i>-{entry.deletions ?? 0}</i>
                                  </>
                                ) : (
                                  <em>DIFF</em>
                                )}
                              </span>
                            )}
                            {entry.error ? (
                              <small className="is-error">실패</small>
                            ) : entry.running ? (
                              <small>실행 중</small>
                            ) : null}
                            <ChevronDown size={12} className="desk-tool-chev" />
                          </summary>
                          <div className="desk-freebuff-tool-detail">
                            <span className="desk-freebuff-tool-label">
                              COMMAND · {commandLineCount}줄
                            </span>
                            <pre>{entry.command || entry.name}</pre>
                            {(entry.diff ||
                              typeof entry.oldText === 'string' ||
                              typeof entry.newText === 'string') && (
                              <ToolDiff
                                oldText={entry.oldText}
                                newText={entry.newText}
                                rawDiff={entry.diff}
                                fileName={entry.file || firstLine}
                              />
                            )}
                            {entry.output ? (
                              <>
                                <span className="desk-freebuff-tool-label">
                                  {entry.error ? 'ERROR' : 'OUTPUT'}
                                </span>
                                <pre
                                  className={`desk-freebuff-tool-output ${entry.error ? 'is-error' : ''}`}
                                >
                                  {entry.output}
                                </pre>
                              </>
                            ) : entry.error ? (
                              <>
                                <span className="desk-freebuff-tool-label">ERROR</span>
                                <pre className="desk-freebuff-tool-output is-error">
                                  명령이 실패했어요.
                                </pre>
                              </>
                            ) : null}
                          </div>
                        </details>
                      );
                    })}
                    {freebuffPendingCommand && (
                      <div className="desk-freebuff-pending">
                        <span className="desk-tool-check running">
                          <Loader2 size={12} className="spin" />
                        </span>
                        <div className="desk-freebuff-pending-copy">
                          <span>도구 실행 중</span>
                          <code>{freebuffPendingCommand}</code>
                        </div>
                      </div>
                    )}
                    {logNeedle && visibleFreebuffEntries.length === 0 && (
                      <div className="desk-log-search-empty">
                        “{logQuery.trim()}”와 일치하는 기록이 없어요.
                      </div>
                    )}
                    {pendingFreebuffMessages.map((message) => (
                      <article className="desk-freebuff-msg" key={`fb-pending-${message.id}`}>
                        <p>{message.text}</p>
                        <div className="desk-freebuff-msg-meta">
                          <time>
                            {new Date(message.at).toLocaleTimeString('ko-KR', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                          </time>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : freebuffFlow.length ? (
                  freebuffFlow.map((item) =>
                    item.kind === 'message' ? (
                      <article className="desk-freebuff-msg" key={item.key}>
                        <p>{item.message.text}</p>
                        <div className="desk-freebuff-msg-meta">
                          <time dateTime={new Date(item.message.at).toISOString()}>
                            {new Date(item.message.at).toLocaleTimeString('ko-KR', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                          </time>
                        </div>
                      </article>
                    ) : (
                      <TerminalBlockContent key={item.key} block={item.block} />
                    ),
                  )
                ) : isFreebuff ? (
                  <div className="empty-state desk-freebuff-empty">
                    <span className="desk-freebuff-empty-mark">
                      <AgentMark id={displayMeta.id} short={displayMeta.short} />
                    </span>
                    <h2>무엇을 도와드릴까요?</h2>
                    <p>{agentLabel}가 이 워크트리를 읽고, 실행하고, 파일을 수정합니다.</p>
                    <div className="desk-freebuff-suggestions">
                      {[
                        '이 프로젝트 구조를 파악해서 요약해줘',
                        '테스트를 실행하고 실패한 부분을 고쳐줘',
                        '최근 변경사항을 리뷰해줘',
                      ].map((text) => (
                        <button
                          type="button"
                          key={text}
                          onClick={() => {
                            setReply(text);
                            replyRef.current?.focus();
                          }}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                    <div className="empty-hint">
                      <Terminal size={13} /> Enter로 전송 · Shift+Enter로 줄바꿈
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {!follow && (
            <button
              type="button"
              className="desk-log-jump"
              onClick={() => {
                followRef.current = true;
                setFollow(true);
                bodyRef.current?.scrollTo({
                  top: bodyRef.current.scrollHeight,
                  behavior: 'smooth',
                });
              }}
            >
              <ArrowDown size={14} />
              최신으로
            </button>
          )}
          </>
        )}

        {isFreebuff && (
          <form className="desk-log-compose desk-freebuff-compose" onSubmit={sendReply}>
            {autoRecovery !== 'idle' && autoRecoveryNote && (
              <div
                className={`desk-freebuff-recovery ${autoRecovery}`}
                role="status"
                aria-live="polite"
              >
                {autoRecovery === 'failed' ? (
                  <AlertTriangle size={13} />
                ) : autoRecovery === 'done' ? (
                  <Check size={13} />
                ) : (
                  <Loader2 size={13} className="spin" />
                )}
                <span>{autoRecoveryNote}</span>
                {autoRecovery === 'failed' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (resumeTicket) {
                        resumeAttemptsRef.current = 0;
                        setResumeRetry((value) => value + 1);
                      } else {
                        void continueSession({ automatic: true });
                      }
                    }}
                  >
                    다시 시도
                  </button>
                )}
                {(autoRecovery === 'done' || autoRecovery === 'failed') && (
                  <button
                    type="button"
                    className="desk-freebuff-recovery-close"
                    onClick={() => {
                      setAutoRecovery('idle');
                      setAutoRecoveryNote(null);
                    }}
                    aria-label="복구 상태 닫기"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
            {!freebuffPanel && (
              <TodoBar
                todos={fbTodos}
                onToast={notify}
                storageKey={`freebuff:${agent.path}`}
              />
            )}
            <div
              className={`desk-freebuff-compose-shell ${freebuffPanel ? 'is-expanded' : ''} ${dragActive ? 'is-dragging' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragActive(false);
                }
              }}
              onDrop={dropFile}
            >
            {freebuffPanel && (
              <div className={`desk-freebuff-panel-slot ${freebuffClosing ? 'is-closing' : ''}`}>
                <div className="desk-freebuff-panel-clip">
            {freebuffPanel === 'model' && (
              <div
                className={`inline-panel desk-freebuff-inline-panel ${freebuffClosing ? 'is-closing' : ''}`}
                role="region"
                aria-label="Freebuff 모델 선택"
                aria-hidden={freebuffClosing || undefined}
              >
                <div className="inline-panel-scroll">
                  <div className="sheet-content model-sheet desk-freebuff-model-sheet">
                    <div className="sheet-head">
                      <span className="sheet-title">모델</span>
                      <span className="sheet-sub">Freebuff CLI</span>
                      <button
                        type="button"
                        className="sheet-close"
                        onClick={closeFreebuffPanel}
                        disabled={freebuffSwitching}
                        aria-label="Freebuff 모델 패널 닫기"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    {freebuffSwitching && (
                      <div className="desk-freebuff-switching" role="status">
                        <Loader2 size={13} className="spin" />
                        모델 피커에서 전환 중…
                      </div>
                    )}
                    <div className="sheet-list">
                      {FREEBUFF_PICKER_MODELS.map((freebuffModel) => (
                        <button
                          type="button"
                          className={`sheet-row model-row ${
                            freebuffModelLabel === freebuffModel.label ? 'selected' : ''
                          }`}
                          key={freebuffModel.id}
                          onClick={() => void selectFreebuffModel(freebuffModel.label)}
                          disabled={freebuffSwitching || !agent.terminalHandle}
                        >
                          <span className="model-name">{freebuffModel.label}</span>
                          <span className="row-provider">
                            {freebuffModel.multiplier && (
                              <b className="model-multiplier">{freebuffModel.multiplier}</b>
                            )}
                            {freebuffModel.description}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="desk-freebuff-panel-note">
                      배수는 이 모델의 시간 소모량입니다. 전환 뒤 현재 모델을 터미널에서 다시 확인합니다.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {freebuffPanel === 'effort' && (
              <div
                className={`inline-panel desk-freebuff-inline-panel ${freebuffClosing ? 'is-closing' : ''}`}
                role="region"
                aria-label="Freebuff Effort 선택"
                aria-hidden={freebuffClosing || undefined}
              >
                <div className="inline-panel-scroll">
                  <div className="sheet-content model-sheet desk-freebuff-model-sheet">
                    <div className="sheet-head">
                      <span className="sheet-title">Effort</span>
                      <span className="sheet-sub">{freebuffModelLabel}</span>
                      <button
                        type="button"
                        className="sheet-close"
                        onClick={closeFreebuffPanel}
                        disabled={freebuffSwitching}
                        aria-label="Freebuff Effort 패널 닫기"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    {freebuffSwitching && (
                      <div className="desk-freebuff-switching" role="status">
                        <Loader2 size={13} className="spin" />
                        Effort 적용 중…
                      </div>
                    )}
                    <div className="sheet-list">
                      {freebuffEfforts.map((effort) => {
                        const selected = freebuffEffortLabel === effort;
                        return (
                          <button
                            type="button"
                            className={`sheet-row model-row ${selected ? 'selected' : ''}`}
                            key={effort}
                            onClick={() => void selectFreebuffEffort(effort)}
                            disabled={freebuffSwitching || !agent.terminalHandle}
                          >
                            <span className="model-name">{FREEBUFF_EFFORT_LABEL[effort]}</span>
                            <span className="row-provider">
                              <b className="model-multiplier">{effort}</b>
                              {selected ? '현재 적용' : '모델 유지'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="desk-freebuff-panel-note">
                      모델은 바꾸지 않고 다음 요청의 추론 강도만 변경합니다. 이 모델이 지원하는 단계만 표시됩니다.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {freebuffPanel === 'usage' && (
              <div
                className={`inline-panel desk-freebuff-inline-panel ${freebuffClosing ? 'is-closing' : ''}`}
                role="region"
                aria-label="Freebuff 사용량"
                aria-hidden={freebuffClosing || undefined}
              >
                <div className="inline-panel-scroll">
                  <section className="desk-freebuff-usage usage-sheet">
                    <div className="sheet-head">
                      <span className="sheet-title">사용량 한도</span>
                      <span className="sheet-sub">Freebuff</span>
                      <button
                        type="button"
                        className="sheet-close"
                        onClick={closeFreebuffPanel}
                        aria-label="Freebuff 사용량 패널 닫기"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="usage-grid">
                      <div className="usage-cell sheet-anim">
                        <div className="usage-title">
                          <span className="status-dot green" />
                          컨텍스트
                        </div>
                        <div className="usage-big">{freebuffMeta.context || '—'}</div>
                        <div className="usage-sub">
                          {Number.isFinite(freebuffMeta.contextPercent)
                            ? `${freebuffMeta.contextPercent}% 사용`
                            : '작업 후 표시'}
                        </div>
                      </div>
                      <div className="usage-cell sheet-anim">
                        <div className="usage-title">
                          <span className="status-dot amber" />
                          남은 시간
                        </div>
                        <div className="usage-big">
                          {freebuffTimeLabel || '—'}
                        </div>
                        <div className={`usage-sub ${freebuffTimeLabel ? '' : 'is-error'}`}>
                          {freebuffTimeLabel ? (
                            freebuffMeta.usedHours !== null && freebuffMeta.totalHours !== null
                              ? `${freebuffMeta.usedHours}h 사용 · 전체 ${freebuffMeta.totalHours}h`
                              : '오늘 남은 시간'
                          ) : (
                            <>
                              <AlertTriangle size={11} />
                              남은 시간을 읽지 못했어요 · 작업 중엔 숨겨져요
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="usage-list sheet-anim">
                      <div>
                        <span>모델</span>
                        <strong>{freebuffModelLabel}</strong>
                      </div>
                      <div>
                        <span>시간 배수</span>
                        <strong>{freebuffMultiplier || '—'}</strong>
                      </div>
                      <div>
                        <span>시간 소모</span>
                        <strong>
                          {freebuffMeta.usedHours !== null && freebuffMeta.totalHours !== null
                            ? `${freebuffMeta.usedHours}h / ${freebuffMeta.totalHours}h`
                            : '—'}
                        </strong>
                      </div>
                      <div>
                        <span>Effort</span>
                        <strong>{freebuffEffortLabel}</strong>
                      </div>
                      <div>
                        <span>컨텍스트</span>
                        <strong>
                          {freebuffMeta.context
                            ? `${freebuffMeta.context}${Number.isFinite(freebuffMeta.contextPercent) ? ` (${freebuffMeta.contextPercent}%)` : ''}`
                            : '—'}
                        </strong>
                      </div>
                      <div>
                        <span>세션</span>
                        <strong>Freebuff CLI</strong>
                      </div>
                    </div>
                    <p className="desk-freebuff-usage-note">
                      사용 가능 시간은 오늘 남은 시간입니다. 모델과 Effort는 하단에서 각각 바꿉니다.
                    </p>
                  </section>
                </div>
              </div>
            )}
                </div>
              </div>
            )}

                {dragActive && (
                  <div className="desk-freebuff-drop-hint" role="status">
                    <Upload size={15} />
                    파일을 여기에 놓아 첨부
                  </div>
                )}
            <div className="composer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="desk-file-input"
                    onChange={(event) => void attachFile(event)}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="plus-btn"
                    title="파일 업로드 · 클릭하거나 입력창에 끌어다 놓기 (최대 20MB)"
                    aria-label="파일 업로드"
                    disabled={attaching || sending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {attaching ? <Loader2 size={17} className="spin" /> : <Plus size={19} />}
                  </button>
                  <textarea
                    ref={replyRef}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void sendReply();
                      }
                    }}
                    placeholder="Freebuff에 메시지를 입력하세요"
                    rows={1}
                    aria-label="Freebuff에 메시지 입력"
                  />
                  <button
                    type="submit"
                    className={`send-btn ${reply.trim() || attachment ? 'ready' : ''}`}
                    disabled={(!reply.trim() && !attachment) || sending || (!agent.terminalHandle && !agent.id)}
                    aria-label={sent ? '전달됨' : '보내기'}
                  >
                    {sending ? <Loader2 size={15} className="spin" /> : <ArrowUp size={17} />}
                  </button>
                </div>
            </div>
                {attachment && (
                  <div className="desk-log-attachment">
                    <FileText size={13} />
                    <div>
                      <strong>{attachment.name}</strong>
                      <code>{attachment.path}</code>
                    </div>
                    <span>{Math.max(1, Math.round(attachment.size / 1024)).toLocaleString('ko-KR')}KB</span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      aria-label="첨부 제거"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

            <div className="toolbar desk-freebuff-toolbar">
              <span
                className={`tb-item desk-freebuff-auto ${isThinking ? 'working' : ''}`}
                title="Freebuff는 안전한 자동 실행 모드로 동작합니다"
              >
                <ShieldCheck size={14} />
                <span>자동</span>
              </span>
              <div className="tb-center desk-freebuff-center">
                <button
                  type="button"
                  className={`tb-item model ${freebuffPanel === 'model' ? 'is-open' : ''}`}
                  onClick={() => toggleFreebuffPanel('model')}
                  aria-expanded={freebuffPanel === 'model'}
                >
                  <span className="tb-label">모델</span>
                  <span className="tb-model-name">{freebuffModelLabel}</span>
                  {freebuffMultiplier && (
                    <span className="tb-model-multiplier">{freebuffMultiplier}</span>
                  )}
                  <ChevronDown
                    size={12}
                    className={`tb-chev ${freebuffPanel === 'model' ? 'flip' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  className={`tb-item ${freebuffPanel === 'effort' ? 'is-open' : ''}`}
                  onClick={() => toggleFreebuffPanel('effort')}
                  title="모델은 유지하고 Effort만 변경합니다"
                  aria-expanded={freebuffPanel === 'effort'}
                >
                  <span className="tb-label">Effort</span>
                  <span className="tb-effort-name">{freebuffEffortLabel}</span>
                  <ChevronDown
                    size={12}
                    className={`tb-chev ${freebuffPanel === 'effort' ? 'flip' : ''}`}
                  />
                </button>
              </div>
              <button
                type="button"
                className={`tb-item timer ${isThinking ? 'busy' : 'idle'} ${freebuffPanel === 'usage' ? 'is-open' : ''} ${freebuffTimeLabel ? '' : 'time-error'}`}
                onClick={() => toggleFreebuffPanel('usage')}
                aria-label={freebuffTimeLabel ? `Freebuff 남은 시간 ${freebuffTimeLabel}` : 'Freebuff 남은 시간 확인 불가'}
                title={
                  freebuffTimeLabel
                    ? `남은 시간 ${freebuffTimeLabel}`
                    : 'Freebuff가 작업 중에는 남은 시간 줄을 숨겨요. 끝나면 다시 표시돼요.'
                }
                aria-expanded={freebuffPanel === 'usage'}
              >
                <span
                  className={`timer-ring ${freebuffTimeLabel ? '' : 'is-missing'}`}
                  style={{
                    background: freebuffTimeLabel
                      ? `conic-gradient(#f2763a 0 ${freebuffContextPct}%, #35251e ${freebuffContextPct}% 360deg)`
                      : 'conic-gradient(#7c4035 0 100%, #2a211e 100%)',
                  }}
                />
                <span>{freebuffTimeLabel || '시간 확인 불가'}</span>
              </button>
            </div>
            {sendError && (
              <div className="desk-log-compose-error">
                <AlertTriangle size={11} />
                {sendError}
              </div>
            )}
          </form>
        )}
        {!isFreebuff && !isShell && (
          <form
            className={`desk-log-compose desk-agy-compose ${dragActive ? 'is-dragging' : ''}`}
            onSubmit={sendReply}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={dropFile}
          >
            {!agyPickerOpen && !agyUsageOpen && (
              <TodoBar
                todos={agyTodos}
                onToast={notify}
                storageKey={`${agent.agent}:${agent.path}`}
              />
            )}
            <div className={`desk-freebuff-compose-shell ${(agyPickerOpen || agyUsageOpen) && (canPickModel || isAgyChat || isCodex || isClaude) ? 'is-expanded' : ''}`}>
            <div
              className={`desk-inline-expand ${agyUsageOpen && (isAgyChat || isCodex || isClaude) ? 'open' : ''}`}
              aria-hidden={!(agyUsageOpen && (isAgyChat || isCodex || isClaude))}
            >
              <div className="desk-inline-expand-inner">
                <div className="inline-panel desk-freebuff-inline-panel desk-agy-usage-panel" role="region" aria-label="사용량 한도">
                  <div className="inline-panel-scroll" style={{ maxHeight: 'min(62vh, 440px)', overflowY: 'auto' }}>
                    <section className="desk-freebuff-usage usage-sheet">
                      <div className="sheet-head">
                        <span className="sheet-title">사용량 한도</span>
                        <span className="sheet-sub">{agyModelLabel}</span>
                        <button
                          type="button"
                          className="sheet-close"
                          onClick={() => setAgyUsageOpen(false)}
                          aria-label="사용량 패널 닫기"
                        >
                          <X size={15} />
                        </button>
                      </div>
                      <QuotaSection
                        quota={agyQuota}
                        loading={agyQuotaLoading}
                        onRefresh={() => void refreshAgyQuota()}
                        codexQuota={codexDrawerQuota}
                        activeEngine={agent.agent}
                      />
                    </section>
                  </div>
                </div>
              </div>
            </div>
            <div
              className={`desk-inline-expand ${agyPickerOpen && canPickModel ? 'open' : ''}`}
              aria-hidden={!(agyPickerOpen && canPickModel)}
            >
              <div className="desk-inline-expand-inner">
                <div
                  className="inline-panel desk-agy-model-panel"
                  role="region"
                  aria-label={agyPickerMode === 'effort' ? '추론 강도 선택' : '모델 선택'}
                >
                  <div className="inline-panel-scroll" style={{ maxHeight: 'min(52vh, 380px)', overflowY: 'auto' }}>
                    <div className="sheet-content model-sheet">
                      <div className="sheet-list">
                        {(() => {
                          const baseModels = MODEL_OPTIONS[agent.agent] || MODEL_OPTIONS.antigravity || [];
                          const seenLive = new Set(liveDrawerModels.map((m) => m.id));
                          const allModels = liveDrawerModels.length
                            ? [...liveDrawerModels, ...baseModels.filter((m) => !seenLive.has(m.id))]
                            : baseModels;
                          const stripEffort = (lbl: string) =>
                            lbl.replace(/\s*\((Low|Medium|High|XHigh|Max|Ultra)\)\s*$/i, '').trim();
                          const extractEffort = (lbl: string) =>
                            lbl.match(/\((Low|Medium|High|XHigh|Max|Ultra)\)\s*$/i)?.[1] || '';

                          if (agyPickerMode === 'effort') {
                            const pickedBaseLabel = pickedAgyModel
                              ? stripEffort(resolveModelLabel(pickedAgyModel, agent.agent, allModels))
                              : '';
                            const targetBase = (pickedBaseLabel || agyModelLabel).toLowerCase();
                            const matching = allModels.filter(
                              (m) => stripEffort(m.label).toLowerCase() === targetBase,
                            );
                            const rawEffortItems = (matching.length > 0 ? matching : allModels).filter((m) =>
                              extractEffort(m.label),
                            );
                            // Deduplicate by normalized effort name so fallback never shows repeats or double selection.
                            const dedupMap = new Map<string, ModelOption>();
                            for (const item of rawEffortItems) {
                              const key = extractEffort(item.label).toLowerCase();
                              if (key && !dedupMap.has(key)) dedupMap.set(key, item);
                            }
                            const effortItems = [...dedupMap.values()];
                            const list =
                              effortItems.length > 0
                                ? effortItems
                                : [
                                    { id: `${pickedAgyModel || allModels[0]?.id || 'model'}:low`, label: `${agyModelLabel} (Low)` },
                                    { id: `${pickedAgyModel || allModels[0]?.id || 'model'}:medium`, label: `${agyModelLabel} (Medium)` },
                                    { id: `${pickedAgyModel || allModels[0]?.id || 'model'}:high`, label: `${agyModelLabel} (High)` },
                                  ];
                            return list.map((item) => {
                              const eff = extractEffort(item.label) || item.label;
                              const selected = agyEffortLabel.toLowerCase() === eff.toLowerCase();
                              return (
                                <button
                                  type="button"
                                  key={item.id}
                                  className={`sheet-row model-row ${selected ? 'selected' : ''}`}
                                  disabled={agySwitching}
                                  onClick={() => void switchAgyModel(item.id)}
                                >
                                  <span className="model-name">{eff}</span>
                                </button>
                              );
                            });
                          }

                          const seen = new Map<string, ModelOption[]>();
                          for (const m of allModels) {
                            const base = stripEffort(m.label);
                            const arr = seen.get(base) || [];
                            arr.push(m);
                            seen.set(base, arr);
                          }
                          return [...seen.entries()].map(([baseName, variants]) => {
                            const selected =
                              agyModelLabel.toLowerCase() === baseName.toLowerCase() ||
                              variants.some((v) => v.id === pickedAgyModel);
                            const preferred =
                              variants.find((v) => extractEffort(v.label).toLowerCase() === agyEffortLabel.toLowerCase()) ||
                              variants.find((v) => /medium/i.test(v.label)) ||
                              variants[0];
                            return (
                              <button
                                type="button"
                                key={preferred.id}
                                className={`sheet-row model-row ${selected ? 'selected' : ''}`}
                                disabled={agySwitching}
                                onClick={() => void switchAgyModel(preferred.id)}
                              >
                                <span className="model-name">{baseName}</span>
                                <span className="row-provider">{displayMeta.label}</span>
                              </button>
                            );
                          });
                        })()}
                      </div>
                      <p className="desk-freebuff-panel-note">
                        {agySwitching
                          ? '변경하는 중…'
                          : agyPickerMode === 'effort'
                            ? `${agyModelLabel}의 추론 강도(effort)를 선택하세요.`
                            : '현재 세션에서 사용할 모델을 선택하세요.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {attachment && (
              <div className="desk-log-attachment">
                <FileText size={13} />
                <div>
                  <strong>{attachment.name}</strong>
                  <code>{attachment.path}</code>
                </div>
                <span>{Math.max(1, Math.round(attachment.size / 1024)).toLocaleString('ko-KR')}KB</span>
                <button type="button" onClick={() => setAttachment(null)} aria-label="첨부 제거">
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="composer">
              <input
                ref={fileInputRef}
                type="file"
                className="desk-file-input"
                onChange={(event) => void attachFile(event)}
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                className="plus-btn"
                title="파일 업로드 · 클릭하거나 끌어다 놓기·붙여넣기 (최대 20MB)"
                aria-label="파일 업로드"
                disabled={attaching || sending}
                onClick={() => fileInputRef.current?.click()}
              >
                {attaching ? <Loader2 size={17} className="spin" /> : <Plus size={19} />}
              </button>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendReply();
                  }
                }}
                placeholder={`${isAgyChat ? 'Agy' : displayMeta.label}에게 메시지를 입력하세요`}
                rows={1}
                onPaste={pasteFiles}
                aria-label="에이전트에 메시지 입력"
              />
              <button
                type="submit"
                className={`send-btn ${reply.trim() || attachment ? 'ready' : ''}`}
                disabled={(!reply.trim() && !attachment) || sending || (!agent.terminalHandle && !agent.id)}
                aria-label={sent ? '전달됨' : '보내기'}
              >
                {sending ? <Loader2 size={15} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
            </div>
            <div className="toolbar desk-agy-toolbar">
              <span className="tb-item desk-agy-auto" title="자동 실행 모드">
                <ShieldCheck size={14} />
                <span>자동</span>
              </span>
              <div className="tb-center desk-agy-center">
                <button
                  type="button"
                  className={`tb-item model ${agyPickerMode === 'model' ? 'is-open' : ''}`}
                  onClick={() => {
                    if (!canPickModel) return;
                    setAgyUsageOpen(false);
                    setAgyPickerMode((mode) => (mode === 'model' ? null : 'model'));
                  }}
                  aria-expanded={agyPickerMode === 'model'}
                >
                  <span>{agyModelLabel}</span>
                  {canPickModel && <ChevronDown size={12} className={`tb-chev ${agyPickerMode === 'model' ? 'flip' : ''}`} />}
                </button>
                <button
                  type="button"
                  className={`tb-item ${agyPickerMode === 'effort' ? 'is-open' : ''}`}
                  onClick={() => {
                    if (!canPickModel) return;
                    setAgyUsageOpen(false);
                    setAgyPickerMode((mode) => (mode === 'effort' ? null : 'effort'));
                  }}
                  aria-expanded={agyPickerMode === 'effort'}
                >
                  <span>{agyEffortLabel}</span>
                  {canPickModel && <ChevronDown size={12} className={`tb-chev ${agyPickerMode === 'effort' ? 'flip' : ''}`} />}
                </button>
              </div>
              <button
                type="button"
                className={`tb-item timer ${agyUsageOpen ? 'is-open' : ''}`}
                onClick={() => {
                  if (!isAgyChat && !isCodex && !isClaude) return;
                  setAgyPickerOpen(false);
                  setAgyUsageOpen((open) => !open);
                }}
                aria-expanded={agyUsageOpen}
                title={
                  isAgyChat
                    ? `${agyModelLabel} · ${agyUsageText}${agyTimeLabel ? ` · ${agyTimeLabel} 후 리셋` : ''}`
                    : `${displayMeta.label} 사용량 보기`
                }
              >
                {(() => {
                  const codexMinPct = (() => {
                    const wins = [codexDrawerQuota?.primary, codexDrawerQuota?.secondary].filter(
                      (w): w is NonNullable<CodexQuotaSnapshot['primary']> =>
                        Boolean(w && typeof w.usedPercent === 'number'),
                    );
                    if (!wins.length) return null;
                    return Math.max(0, Math.min(...wins.map((w) => Math.round(100 - w.usedPercent))));
                  })();
                  const ringPct = isAgyChat ? agyRemainingPct : codexMinPct ?? 0;
                  const ringLabel = isAgyChat
                    ? agyRemainingLabel
                    : codexMinPct !== null
                      ? `${codexMinPct}%`
                      : isChat
                        ? '채팅'
                        : '실시간';
                  return (
                    <>
                      <span
                        className="timer-ring"
                        style={{
                          background: `conic-gradient(#e08a4c 0 ${ringPct}%, #2a211b ${ringPct}% 360deg)`,
                        }}
                      />
                      <span>{ringLabel}</span>
                    </>
                  );
                })()}
              </button>
            </div>
            {sendError && (
              <div className="desk-log-compose-error">
                <AlertTriangle size={11} />
                {sendError}
              </div>
            )}
          </form>
        )}
        {isShell && (
          <form className="desk-log-compose" onSubmit={sendReply}>
            <div className="composer">
              <span className="desk-shell-prompt">$</span>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendReply();
                  }
                }}
                placeholder="이 워크트리에서 실행할 셸 명령"
                rows={1}
                aria-label="워크트리 셸 명령 입력"
              />
              <button
                type="submit"
                className={`send-btn ${reply.trim() ? 'ready' : ''}`}
                disabled={!reply.trim() || sending || !agent.terminalHandle}
                aria-label={sent ? '실행됨' : '명령 실행'}
              >
                {sending ? <Loader2 size={15} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
            <div className="desk-log-compose-hint">
              <ShieldCheck size={11} />
              {sent ? '명령을 보냈어요' : '현재 워크트리 셸'} · Enter 실행 · Shift+Enter 줄바꿈
            </div>
            {lastSent && (
              <div className="desk-log-sent" title={lastSent}>
                <Check size={11} /> 실행됨 · {lastSent.slice(0, 80)}
              </div>
            )}
            {sendError && (
              <div className="desk-log-compose-error">
                <AlertTriangle size={11} />
                {sendError}
              </div>
            )}
          </form>
        )}

        {!isChat && (
          <div className="desk-log-foot">
            <span>
              <Zap size={12} />
              {snapshot?.fetchedAt
                ? `${new Date(snapshot.fetchedAt).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })} 갱신`
                : '실시간'}
            </span>
            <span>
              <Terminal size={12} />
              {`${snapshot?.returnedLineCount ?? 0} lines`}
            </span>
          </div>
        )}
        {handoffOpen && (
          <HandoffSheet
            source={agent}
            overview={overview}
            brief={handoffBrief}
            onClose={() => setHandoffOpen(false)}
            onSent={notify}
          />
        )}
      </aside>
    </div>,
    document.body,
  );
}


function AddProjectDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (overview: OrcaOverview, path: string) => void;
}) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await orcaApi.addProject(path.trim());
      const worktree = result.overview.worktrees.find(
        (item) => item.path === result.path || item.path.startsWith(result.path),
      );
      onAdded(result.overview, worktree?.path || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '프로젝트를 추가하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="desk-modal-layer">
      <div className="desk-modal-backdrop" onClick={onClose} />
      <form className="desk-modal" onSubmit={submit}>
        <div className="desk-modal-head">
          <div>
            <span className="desk-kicker">
              <FolderPlus size={12} /> ADD PROJECT
            </span>
            <h2>프로젝트 추가</h2>
            <p>이미 있는 폴더나 Git 저장소를 Orca에 등록합니다.</p>
          </div>
          <button type="button" className="desk-icon" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <label className="desk-field">
          <span>절대 경로</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="~/my-project"
            autoFocus
            spellCheck={false}
          />
        </label>
        <div className="desk-modal-hint">
          <GitBranch size={13} />
          .git이 있으면 Git 프로젝트로, 없으면 일반 폴더로 등록합니다.
        </div>
        {error && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}
        <div className="desk-modal-actions">
          <button type="button" className="desk-btn ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="desk-btn" disabled={!path.trim() || busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            추가
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
