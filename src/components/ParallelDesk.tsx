import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Activity,
  AlertTriangle,
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
  Github,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Menu,
  MessageSquare,
  Minus,
  Play,
  Pause,
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
import { useAgyQuota } from '../hooks/useQuota';
import {
  orcaApi,
  type FreebuffSessionPayload,
  type FreebuffUsage,
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
} from '../lib/orca';
import { relativeTime, shortPath } from '../data';
import { Sheet } from './Sheet';
import { SelectMenu } from './SelectMenu';

type DeskTab = 'agents' | 'github' | 'instructions' | 'memory' | 'messages';
type RunMode = 'single' | 'parallel';
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
  { id: 'gemini', label: 'Gemini', short: 'GM', cls: 'gemini' },
  { id: 'codex', label: 'Codex', short: 'CX', cls: 'codex' },
];

type ModelOption = { id: string; label: string };

// Model ids are taken from the local agent CLIs. Freebuff does not accept a
// launch-time model, so it is intentionally absent here.
const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  opencode: [
    { id: 'opencode/big-pickle', label: 'Big Pickle' },
    { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash' },
    { id: 'opencode/beam-free', label: 'Beam' },
    { id: 'opencode/flint-40b-free', label: 'Flint 40B' },
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
    { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
    { id: 'gemini-4-neon-low', label: 'Gemini 4 Neon (Low)' },
    { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
    { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
    { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
    { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
    { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
    { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ],
  gemini: [
    { id: 'auto', label: 'Auto (권장)' },
    { id: 'gemini-3.1-pro-preview-customtools', label: 'Gemini 3.1 Pro Preview' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
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

export function ParallelDesk({ onClose }: { onClose: () => void }) {
  const initialDeskState = useRef(readDeskState());
  const [overview, setOverview] = useState<OrcaOverview | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialDeskState.current.path);
  const [tab, setTab] = useState<DeskTab>(initialDeskState.current.tab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sideOpen, setSideOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [logAgent, setLogAgent] = useState<OrcaAgent | null>(null);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
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
      <div className="desk-shell">
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
                                {worktree.displayName}
                                {worktree.isMainWorktree &&
                                  worktree.displayName.toLowerCase() !== 'main' && <em>main</em>}
                              </span>
                              <span className="desk-worktree-meta">
                                {worktree.branch || shortPath(worktree.path)}
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
                        {worktree.agents.length > 0 && (
                          <div
                            className="desk-side-agents"
                            aria-label={`${worktree.displayName} 에이전트`}
                          >
                            {worktree.agents.map((agent) => {
                              const meta = agentMeta(agent.agent);
                              return (
                                <button
                                  type="button"
                                  className={`desk-side-agent ${agent.state}`}
                                  key={agent.id}
                                  onClick={() => {
                                    setSelectedPath(worktree.path);
                                    openLog(agent);
                                    setSideOpen(false);
                                  }}
                                  title={agent.title}
                                >
                                  <span
                                    className={`desk-agent-badge desk-side-agent-badge ${meta.cls}`}
                                  >
                                    <AgentMark id={meta.id} short={meta.short} />
                                  </span>
                                  <span className="desk-side-agent-main">
                                    <strong>{meta.label}</strong>
                                    <small>{agent.title}</small>
                                  </span>
                                  {agent.role ? (
                                    <span className={`desk-role ${agent.role}`}>
                                      {roleLabel(agent.role)}
                                    </span>
                                  ) : (
                                    <span className={`desk-state ${agent.state}`}>
                                      {stateLabel(agent.state)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
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
            <button className="desk-side-link" onClick={() => setCreditsOpen(true)}>
              <Sparkles size={14} />
              크레딧 · 런타임
              <ChevronRight size={13} />
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
            <div className="desk-top-actions">
              <button className="desk-btn ghost" onClick={() => setCreditsOpen(true)}>
                <Sparkles size={14} />
                <span>크레딧</span>
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
                  <strong>{selectedWorktree?.displayName || '워크트리 선택'}</strong>
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

      {logAgent && (
        <LogDrawer
          key={logAgent.terminalHandle || logAgent.id}
          agent={logAgent}
          overview={overview}
          notify={notify}
          onClose={() => setLogAgent(null)}
          onOverview={setOverview}
          onContinue={setLogAgent}
        />
      )}
      {creditsOpen && (
        <CreditsDrawer overview={overview} onClose={() => setCreditsOpen(false)} />
      )}
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

  useEffect(() => {
    setWorkerModel('');
    setCoordinatorModel('');
    setModelTarget(null);
  }, [agentType]);

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
          const nextAgent =
            overviewAgents.find(
              (item) =>
                (launched.sessionId && item.orcaSessionId === launched.sessionId) ||
                (launched.handle && item.terminalHandle === launched.handle),
            ) ||
            (launchedChat
              ? overviewAgents
                  .filter(
                    (item) =>
                      item.kind === 'chat' &&
                      item.agent === (launched.agent || agentType) &&
                      item.path === (launched.path || worktree.path),
                  )
                  .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))[0]
              : undefined);
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
            {modelOptions(agentType).map((option) => {
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
  if (role === 'coordinator') return '코디네이터';
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
      <strong className="desk-agent-name">{agent.title}</strong>
      {agent.prompt && agent.prompt !== agent.title && (
        <p className="desk-agent-prompt">{agent.prompt}</p>
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
          {info.account?.login && (
            <div className="desk-github-account" title={info.account.url || undefined}>
              <Github size={11} />
              @{info.account.login} 연결됨
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

function TranscriptMarkdown({
  text,
  className = 'desk-transcript-md',
}: {
  text: string;
  className?: string;
}) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }) as string, {
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['style', 'form', 'input'],
      }),
    [text],
  );
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

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


type FreebuffPickerModel = {
  id: string;
  label: string;
  description: string;
  multiplier: string | null;
};

const FREEBUFF_PICKER_MODELS: FreebuffPickerModel[] = [
  { id: 'deepseek-v4.1-flash-fast', label: 'DeepSeek V4.1 Flash Fast', description: '가장 빠름 · max', multiplier: '3x' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', description: '안정적 속도 · high', multiplier: '2x' },
  { id: 'muse-spark-1.3', label: 'Muse Spark 1.3', description: '혼잡 시 대체 · high', multiplier: '3x' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: '강력한 범용 · high', multiplier: '4x' },
  { id: 'muse-ember', label: 'Muse Ember', description: 'Meta · 빠름 · medium', multiplier: '6x' },
  { id: 'claude-haiku-5.5', label: 'Claude Haiku 5.5', description: 'Anthropic · 100k · medium', multiplier: '6x' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', description: 'OpenAI · 하루 2회 · medium', multiplier: '30x' },
  { id: 'deepseek-v4.1-flash-slow', label: 'DeepSeek V4.1 Flash Slow', description: '가장 저렴 · low', multiplier: '1x' },
  { id: 'beam-1.0', label: 'Beam 1.0', description: 'Reflection · coding · high', multiplier: null },
  { id: 'nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning', description: '빠름 · high', multiplier: null },
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

const FREEBUFF_TOOL_LABELS: Record<string, string> = {
  run_terminal_command: 'bash',
  read_files: 'read',
  write_file: 'write',
  str_replace: 'edit',
  code_search: 'search',
  list_directory: 'ls',
  glob: 'glob',
  write_todos: 'todo',
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
    if (/^(?:[⎘•△▽█✕■]|•\s*\d+s)/.test(line.trim())) continue;
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
  const prefixed = /^(?:\$|›|❯|➜|⏵|•|●|⏺|✓|✔|☑|→)\s+/.test(trimmed);
  const namedPrefix = /^(?:bash|shell|sh|exec(?:ute)?|command|terminal|tool)\s*[:：]/i.test(trimmed);
  if (!prefixed && !namedPrefix) return null;
  const cleaned = trimmed.replace(/^(?:\$|›|❯|➜|⏵|•|●|⏺|✓|✔|☑|→)\s*/, '');
  const nameMatch = cleaned.match(
    /^(bash|shell|sh|exec(?:ute)?|run|ran|command|read(?:_file)?|write(?:_file)?|edit(?:_file)?|glob|grep|search|apply(?:[_\s-]?patch)?|patch|task|todo(?:write)?|webfetch|fetch|browser|terminal|tool)\b/i,
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
      /^(bash|shell|sh|exec(?:ute)?|command|read(?:_file)?|write(?:_file)?|edit(?:_file)?|glob|grep|search|apply(?:[_\s-]?patch)?|patch|task|todo(?:write)?|webfetch|fetch|browser|terminal|tool)\b[\s:：-]*(.*)$/i,
    );
    if (nested) {
      name = nested[1].toLowerCase().replace(/[_\s-]/g, '');
      command = nested[2].trim() || command;
    } else {
      name = 'bash';
    }
  }
  if (!command) return null;
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
        <div className={`desk-term-line ${block.kind}`} key={`${index}-${line.slice(0, 18)}`}>
          {line || '\u00a0'}
        </div>
      ))}
    </div>
  );
}

function freebuffStatus(lines: string[], working: boolean) {
  const joined = lines.join(' ');
  // The footer always carries the active model. Picker rows can contain
  // every model name, so prefer the footer when the model sheet is open.
  const footer =
    [...lines].reverse().find((line) => /\/model to change|Chat:\s*/i.test(line)) || '';
  const statusSource = footer || joined;
  const knownModels = [...FREEBUFF_PICKER_MODELS].sort(
    (left, right) => right.label.length - left.label.length,
  );
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
    effort: statusSource.match(/(?:•|·|effort[:=]?)\s*(max|high|medium|low)\b/i)?.[1]?.toLowerCase() ?? null,
    context: joined.match(/(\d+(?:\.\d+)?[KkMm]?)\s*\(\s*(\d+(?:\.\d+)?)%\s*\)/)?.[1] ?? null,
    contextPercent: Number(
      joined.match(/(\d+(?:\.\d+)?[KkMm]?)\s*\(\s*(\d+(?:\.\d+)?)%\s*\)/)?.[2] ?? NaN,
    ),
    elapsed: joined.match(/(?:thinking|working)\.\.\.\s*(\d+m\s*\d+s|\d+m|\d+s)/i)?.[1] ?? null,
    thinking: working,
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
  const meta = agyToolDisplay(tool.name || '');
  const state = String(tool.state || 'completed').toLowerCase();
  const running = state === 'running' || state === 'pending';
  const failed = state === 'failed' || state === 'error';
  const label = running ? '실행 중' : failed ? '실패' : '완료';
  const Icon = meta.Icon;

  return (
    <details className={`tool real desk-agy-tool ${failed ? 'failed' : ''}`}>
      <summary className="tool-main">
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
        <span className="tool-kind">{meta.label}</span>
        <span className="tool-name">{tool.name || meta.label}</span>
        <span className="tool-time">{label}</span>
        <ChevronDown size={14} className="tool-chev" />
      </summary>
      <div className="tool-detail">
        <div className="tool-detail-label">ORCA TOOL</div>
        <pre className="tool-args">{`${tool.name || meta.label}\nstate: ${state}`}</pre>
      </div>
    </details>
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
  onCopy,
  onRefresh,
}: {
  entries: TranscriptEntry[];
  busy: boolean;
  copied: boolean;
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
              {group.text}
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
          <span>생각하는 중…</span>
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
        <span className="meta-time">Agy · Orca chat</span>
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
    <Sheet open onClose={onClose} label="에이전트 인수인계">
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
}: {
  agent: OrcaAgent;
  overview: OrcaOverview | null;
  notify: (message: string) => void;
  onClose: () => void;
  onOverview: (overview: OrcaOverview) => void;
  onContinue: (agent: OrcaAgent) => void;
}) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [view, setView] = useState<'chat' | 'terminal'>('chat');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [sentMessages, setSentMessages] = useState<FreebuffSentMessage[]>(() =>
    readFreebuffSent(agent.path),
  );
  const [freebuffSession, setFreebuffSession] = useState<FreebuffSessionPayload | null>(null);
  const [attachment, setAttachment] = useState<{ path: string; name: string; size: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [freebuffPanel, setFreebuffPanel] = useState<'model' | 'usage' | null>(null);
  const [freebuffClosing, setFreebuffClosing] = useState(false);
  const [freebuffSwitching, setFreebuffSwitching] = useState(false);
  const [freebuffTimeLeft, setFreebuffTimeLeft] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const loadInFlightRef = useRef(false);
  const [freebuffModelOverride, setFreebuffModelOverride] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const freebuffPanelTimerRef = useRef<number | undefined>(undefined);
  const sentPathRef = useRef(agent.path);
  const isFreebuff =
    agent.agent === 'freebuff' ||
    /^Freebuff\b/i.test(agent.title) ||
    /^Freebuff\b/i.test(agent.terminalTitle || '');
  const isShell = agent.agent === 'terminal' && !isFreebuff;
  const isChat =
    !isFreebuff &&
    (agent.kind === 'chat' ||
      (!agent.terminalHandle && Boolean(agent.orcaSessionId)));
  const isAgyChat = isChat && agent.agent === 'antigravity';
  const { quota: agyQuota } = useAgyQuota(isAgyChat);
  const displayMeta = isFreebuff
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
  const hasTranscript = isAgyChat ? agyEntries.length > 0 : transcriptEntries.length > 0;
  const agyBucket = useMemo(() => {
    const buckets = agyQuota?.groups?.flatMap((group) => group.buckets) || [];
    return (
      buckets.find((bucket) => !bucket.disabled && typeof bucket.remaining === 'number') ||
      buckets[0] ||
      null
    );
  }, [agyQuota]);
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
  // A chat stays a chat even if Orca also exposes a terminal handle for it.
  const canShowTerminal = Boolean(agent.terminalHandle) && !isChat;
  const isThinking = transcript ? transcript.state === 'working' : agent.state === 'working';
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
  const lastThinkingIndex = useMemo(() => {
    for (let index = freebuffSessionEntries.length - 1; index >= 0; index -= 1) {
      if (freebuffSessionEntries[index].kind === 'thinking') return index;
    }
    return -1;
  }, [freebuffSessionEntries]);
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
    return sentMessages.filter(
      (message) =>
        message.at > updatedAt &&
        !sessionTexts.has(message.text.replace(/\s+/g, ' ').trim()),
    );
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
  const handoffBrief = useMemo(
    () =>
      buildHandoffBrief(
        agent,
        isFreebuff ? freebuffSessionEntries : transcriptEntries,
        displayTail,
      ),
    [agent, displayTail, freebuffSessionEntries, isFreebuff, transcriptEntries],
  );
  const freebuffModelLabel =
    freebuffModelOverride || freebuffMeta.model || FREEBUFF_PICKER_MODELS[0].label;
  const freebuffMultiplier =
    FREEBUFF_PICKER_MODELS.find((model) => model.label === freebuffModelLabel)?.multiplier ??
    freebuffMeta.modelMultiplier;
  const freebuffEffortLabel = freebuffMeta.effort || 'effort';
  const freebuffContextPct = Number.isFinite(freebuffMeta.contextPercent)
    ? Math.max(0, Math.min(100, freebuffMeta.contextPercent))
    : 0;
  const openFreebuffPanel = (panel: 'model' | 'usage') => {
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

  const toggleFreebuffPanel = (panel: 'model' | 'usage') => {
    if (freebuffPanel === panel && !freebuffClosing) closeFreebuffPanel();
    else openFreebuffPanel(panel);
  };

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
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
        void orcaApi
          .transcript(agent.orcaSessionId)
          .then(setTranscript)
          .catch(() => undefined);
      }
      if (isFreebuff) {
        void orcaApi
          .freebuffSession(agent.path)
          .then((next) =>
            setFreebuffSession((current) =>
              current &&
              current.updatedAt === next.updatedAt &&
              current.entries.length === next.entries.length
                ? current
                : next,
            ),
          )
          .catch(() => undefined);
      }
      if (agent.terminalHandle) {
        try {
          const next = await orcaApi.terminal(agent.terminalHandle, {
            screen: !isFreebuff,
            limit: isFreebuff ? 5000 : 800,
          });
          setSnapshot(next);
          setError(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '로그를 읽지 못했어요.');
        }
      }
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
    }
  }, [agent.path, agent.terminalHandle, agent.orcaSessionId, isFreebuff]);

  useEffect(() => {
    void load();
    // Keep the live Freebuff session close to the terminal. 500ms is still
    // one request at a time (loadInFlightRef), so a slow CLI cannot stack up
    // a backlog of polls while the pane is open.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 500);
    return () => window.clearInterval(timer);
  }, [load]);

  /* keep the transcript fresh even when the terminal read is slow */
  useEffect(() => {
    if (!agent.orcaSessionId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void orcaApi
          .transcript(agent.orcaSessionId!)
          .then(setTranscript)
          .catch(() => undefined);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [agent.orcaSessionId]);

  useEffect(() => {
    // A Freebuff terminal can keep running after Orca's transcript stops
    // updating. Prefer the live terminal for it; the user can still switch
    // back to the last Orca transcript with the toggle.
    setView(isFreebuff || isShell ? 'terminal' : 'chat');
  }, [isFreebuff, isShell, agent.terminalHandle]);

  useEffect(() => {
    if (!follow) return;
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
    setFreebuffModelOverride(null);
  }, [agent.terminalHandle]);

  useEffect(() => {
    if (sentPathRef.current === agent.path) return;
    sentPathRef.current = agent.path;
    setSentMessages(readFreebuffSent(agent.path));
    setFreebuffSession(null);
  }, [agent.path]);

  useEffect(() => {
    if (sentPathRef.current !== agent.path) return;
    writeFreebuffSent(agent.path, sentMessages);
  }, [agent.path, sentMessages]);

  const copy = async () => {
    if (!snapshot && !hasTranscript) return;
    const copyEntries = isAgyChat ? agyEntries : transcriptEntries;
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

  const dropFile = (event: DragEvent<HTMLDivElement>) => {
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
      setView(isFreebuff || isShell ? 'terminal' : 'chat');
      window.setTimeout(() => setSent(false), 1600);
      const refresh = () => {
        if (agent.orcaSessionId) {
          void orcaApi.transcript(agent.orcaSessionId).then(setTranscript).catch(() => undefined);
        }
        if (isFreebuff) {
          void orcaApi.freebuffSession(agent.path).then(setFreebuffSession).catch(() => undefined);
        }
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

  const continueSession = async () => {
    if (!isFreebuff || continuing) return;
    // The button is already an explicit action. Resume immediately instead of
    // interrupting the flow with a browser confirmation dialog.
    setContinuing(true);
    setSendError(null);
    setError(null);
    try {
      const result = await orcaApi.continueFreebuff({
        handle: agent.terminalHandle,
        path: agent.path,
        chatId: freebuffSession?.chatId || null,
      });
      onOverview(result.overview);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Freebuff 세션을 이어서 열지 못했어요.');
    } finally {
      setContinuing(false);
    }
  };

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
                {isFreebuff ? 'Freebuff' : agent.title}
              </strong>
              <span>
                {isFreebuff
                  ? `${agent.repo} / ${agent.path.split('/').pop()}`
                  : `${displayMeta.label} · ${agent.repo} / ${agent.path.split('/').pop()}`}
              </span>
            </div>
          </div>
          <div className="desk-log-actions">
            <button
              className="desk-icon"
              onClick={() => void copy()}
              disabled={!snapshot && !hasTranscript}
              title={copied ? '복사됨' : '로그 복사'}
              aria-label={copied ? '복사됨' : '로그 복사'}
            >
              {copied ? <Check size={15} /> : <Clipboard size={15} />}
            </button>
            <button
              className="desk-icon"
              onClick={() => void load()}
              title="로그 새로고침"
              aria-label="로그 새로고침"
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
            </button>
            <button
              className="desk-icon"
              onClick={() => setHandoffOpen(true)}
              title="다른 에이전트에 인수인계"
              aria-label="다른 에이전트에 인수인계"
            >
              <ArrowRightLeft size={15} />
            </button>
            {isFreebuff && (
              <button
                className="desk-icon"
                onClick={() => void interrupt()}
                disabled={interrupting || !agent.terminalHandle}
                title={interrupted ? '중단됨' : '현재 작업 중단 (Ctrl+C)'}
                aria-label={interrupted ? '중단됨' : '현재 작업 중단'}
              >
                {interrupting ? <Loader2 size={15} className="spin" /> : <Pause size={15} />}
              </button>
            )}
            {isFreebuff && (
              <button
                className="desk-icon"
                onClick={() => void continueSession()}
                disabled={continuing || closing || !agent.path}
                title="끄고 계속 (freebuff --continue)"
                aria-label="끄고 계속"
              >
                {continuing ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
              </button>
            )}
            {!isChat && (
              <button
                className="desk-icon"
                onClick={() => void terminate()}
                disabled={closing || !agent.terminalHandle}
                title="터미널 종료"
                aria-label="터미널 종료"
              >
                {closing ? <Loader2 size={15} className="spin" /> : <Power size={15} />}
              </button>
            )}
            <button
              className="desk-icon"
              onClick={onClose}
              title="로그 닫기"
              aria-label="로그 닫기"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {!isChat && (
        <div className="desk-log-meta">
          <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
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
                ? `Freebuff 세션 기록 · ${freebuffSessionEntries.length}`
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
            onClick={() => setFollow((value) => !value)}
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
          <div
            className={`desk-log-body ${isAgyChat ? 'desk-agy-log-body' : ''}`}
            ref={bodyRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
            }}
          >
            {view === 'chat' && hasTranscript ? (
              isAgyChat ? (
                <AgyChatThread
                  entries={agyEntries}
                  busy={isThinking}
                  copied={copied}
                  onCopy={() => void copy()}
                  onRefresh={() => void load()}
                />
              ) : (
                <div className="desk-transcript">
                  {transcriptEntries.map((entry, index) => {
                    const thinking = entry.kind === 'reasoning' || entry.kind === 'thinking';
                    const tool = entry.kind === 'tool';
                    return (
                      <article
                        className={`desk-transcript-entry ${
                          entry.role === 'user'
                            ? 'user'
                            : thinking
                              ? 'thinking'
                              : tool
                                ? 'tool'
                                : 'assistant'
                        }`}
                        key={`${entry.kind}-${entry.role || 'entry'}-${index}`}
                      >
                        <span>
                          {entry.role === 'user' ? 'YOU' : thinking ? 'THINKING' : tool ? 'TOOL' : 'AGENT'}
                        </span>
                        <TranscriptMarkdown text={entry.text || ''} />
                      </article>
                    );
                  })}
                </div>
              )
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
                    {freebuffSessionEntries.map((entry, index) => {
                      if (entry.kind === 'message') {
                        if (entry.role === 'user') {
                          return (
                            <article className="desk-freebuff-msg" key={`fb-session-${index}`}>
                              <p>{entry.text}</p>
                              {entry.at && (
                                <div className="desk-freebuff-msg-meta">
                                  <time>{entry.at}</time>
                                </div>
                              )}
                            </article>
                          );
                        }
                        return (
                          <article className="desk-freebuff-agent" key={`fb-session-${index}`}>
                            <TranscriptMarkdown text={entry.text} />
                          </article>
                        );
                      }
                      if (entry.kind === 'thinking') {
                        return (
                          <details
                            className="desk-freebuff-think"
                            key={`fb-session-${index}`}
                            open={index === lastThinkingIndex}
                          >
                            <summary>
                              <ChevronRight size={13} className="desk-think-chev" />
                              <span>생각</span>
                              <small>{entry.text.length.toLocaleString('ko-KR')}자</small>
                            </summary>
                            <div className="desk-freebuff-think-body">
                              <TranscriptMarkdown text={entry.text} />
                            </div>
                          </details>
                        );
                      }
                      const commandLines = entry.command.split('\n');
                      const firstLine = freebuffToolHead(entry) || entry.name;
                      const commandLineCount = commandLines.filter((line) => line.trim()).length;
                      return (
                        <details
                          className="desk-tool-card desk-freebuff-tool"
                          key={`fb-session-${index}`}
                        >
                          <summary>
                            <span className={`desk-tool-check ${entry.running ? 'running' : ''}`}>
                              {entry.running ? (
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
                            {entry.running && <small>실행 중</small>}
                            <ChevronDown size={12} className="desk-tool-chev" />
                          </summary>
                          <div className="desk-freebuff-tool-detail">
                            <span className="desk-freebuff-tool-label">
                              COMMAND · {commandLineCount}줄
                            </span>
                            <pre>{entry.command || entry.name}</pre>
                            {entry.output ? (
                              <>
                                <span className="desk-freebuff-tool-label">OUTPUT</span>
                                <pre className="desk-freebuff-tool-output">{entry.output}</pre>
                              </>
                            ) : null}
                          </div>
                        </details>
                      );
                    })}
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
                    <p>Freebuff가 이 워크트리를 읽고, 실행하고, 파일을 수정합니다.</p>
                    <div className="empty-hint">
                      <Terminal size={13} /> Enter로 전송 · Shift+Enter로 줄바꿈
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {isFreebuff && (
          <form className="desk-log-compose desk-freebuff-compose" onSubmit={sendReply}>
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
                              남은 시간을 읽지 못했어요
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
                      사용 가능 시간은 오늘 남은 시간입니다. 모델은 하단 모델 버튼에서 바꿉니다.
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
                  <span>{freebuffModelLabel}</span>
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
                  className="tb-item"
                  onClick={() => openFreebuffPanel('model')}
                  title="Effort를 바꾸려면 모델 피커를 엽니다"
                >
                  <span>{freebuffEffortLabel}</span>
                  <ChevronDown size={12} className="tb-chev" />
                </button>
              </div>
              <button
                type="button"
                className={`tb-item timer ${isThinking ? 'busy' : 'idle'} ${freebuffPanel === 'usage' ? 'is-open' : ''} ${freebuffTimeLabel ? '' : 'time-error'}`}
                onClick={() => toggleFreebuffPanel('usage')}
                aria-label={freebuffTimeLabel ? `Freebuff 남은 시간 ${freebuffTimeLabel}` : 'Freebuff 남은 시간 확인 불가'}
                title={freebuffTimeLabel ? `남은 시간 ${freebuffTimeLabel}` : '남은 시간을 읽지 못했어요'}
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
        {isChat && (
          <form className="desk-log-compose desk-agy-compose" onSubmit={sendReply}>
            <div className="composer">
              <button
                type="button"
                className="plus-btn"
                title="파일 첨부는 Freebuff에서 지원합니다"
                aria-label="파일 첨부 안내"
                onClick={() => setSendError('파일 첨부는 Freebuff에서 지원합니다.')}
              >
                <Plus size={19} />
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
                aria-label="에이전트에 메시지 입력"
              />
              <button
                type="submit"
                className={`send-btn ${reply.trim() ? 'ready' : ''}`}
                disabled={!reply.trim() || sending || (!agent.terminalHandle && !agent.id)}
                aria-label={sent ? '전달됨' : '보내기'}
              >
                {sending ? <Loader2 size={15} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
            <div className="toolbar desk-agy-toolbar">
              <span className="tb-item desk-agy-auto" title="자동 실행 모드">
                <ShieldCheck size={14} />
                <span>자동</span>
              </span>
              <div className="tb-center desk-agy-center">
                <span className="tb-item model">
                  <span>{isAgyChat ? 'Agy' : displayMeta.label}</span>
                </span>
                <span className="tb-item">
                  <span>Orca</span>
                </span>
              </div>
              <span
                className="tb-item timer"
                title={
                  isAgyChat
                    ? agyTimeLabel
                      ? `${agyTimeLabel} 후 리셋 · ${agyRemainingLabel}`
                      : `남은 한도 ${agyRemainingLabel}`
                    : 'Orca 채팅'
                }
              >
                <span
                  className="timer-ring"
                  style={{
                    background: `conic-gradient(#e08a4c 0 ${agyRemainingPct}%, #2a211b ${agyRemainingPct}% 360deg)`,
                  }}
                />
                <span>
                  {isAgyChat ? agyTimeLabel || agyRemainingLabel : 'chat'}
                </span>
              </span>
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

type CodexQuotaWindow = {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};

type CodexQuota = {
  ok?: boolean;
  plan?: string | null;
  primary?: CodexQuotaWindow | null;
  secondary?: CodexQuotaWindow | null;
  error?: string;
};

function codexWindowLabel(minutes?: number | null) {
  if (!minutes) return '';
  if (minutes >= 10_080) return `${Math.round(minutes / 1_440)}일`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}시간`;
  return `${minutes}분`;
}

function CreditsDrawer({
  overview,
  onClose,
}: {
  overview: OrcaOverview | null;
  onClose: () => void;
}) {
  const { quota, loading: agyLoading, refresh: refreshAgy } = useAgyQuota(true);
  const [freebuff, setFreebuff] = useState<FreebuffUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codex, setCodex] = useState<CodexQuota | null>(null);
  const [codexLoading, setCodexLoading] = useState(true);
  const [codexError, setCodexError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const next = await orcaApi.usage(refresh);
      setFreebuff(next);
      setError(next.ok ? null : next.error || 'Freebuff 사용량을 불러오지 못했어요.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Freebuff 사용량을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCodex = useCallback(async () => {
    setCodexLoading(true);
    setCodexError(null);
    try {
      const response = await fetch('/codex-api/quota', { credentials: 'include' });
      const body = (await response.json().catch(() => ({}))) as CodexQuota;
      if (!response.ok || body.ok === false) {
        throw new Error(body.error || `Codex 한도 요청 실패 (${response.status})`);
      }
      setCodex(body);
    } catch (cause) {
      setCodexError(cause instanceof Error ? cause.message : 'Codex 계정 한도를 읽지 못했어요.');
    } finally {
      setCodexLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCodex();
  }, [loadCodex]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    refreshAgy();
    void load(true);
    void loadCodex();
  };

  const codexWindows = [
    { label: '5시간', window: codex?.primary },
    { label: '주간', window: codex?.secondary },
  ].filter((entry) => entry.window);

  return createPortal(
    <div className="desk-drawer-layer">
      <div className="desk-drawer-backdrop" onClick={onClose} />
      <aside className="desk-credit-panel" role="dialog" aria-modal="true" aria-label="크레딧과 런타임">
        <div className="desk-drawer-head">
          <div>
            <span className="desk-kicker">
              <Sparkles size={12} /> CREDIT TREE
            </span>
            <h2>크레딧 · 런타임</h2>
            <p>Orca 호스트와 연결된 실제 계정의 상태만 표시합니다.</p>
          </div>
          <button className="desk-icon" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="desk-credit-scroll">
          <section className="desk-credit-node">
            <div className="desk-credit-root">
              <span className="desk-credit-icon freebuff">
                <AgentMark id="freebuff" short="FB" />
              </span>
              <div>
                <strong>Freebuff</strong>
                <span>
                  {freebuff?.configured ? 'CLI 계정 연결됨' : 'CLI 로그인 필요'}
                </span>
              </div>
              <span className={`desk-credit-pill ${freebuff?.ok ? 'ok' : 'warn'}`}>
                {freebuff?.ok ? freebuff.plan || 'free' : '확인 불가'}
              </span>
            </div>
            <div className="desk-credit-branch">
              <div className="desk-credit-row">
                <span>API 크레딧</span>
                <strong>
                  {freebuff?.apiCredits
                    ? freebuff.apiCredits.remaining.toLocaleString('ko-KR')
                    : '—'}
                </strong>
              </div>
              <div className="desk-credit-row">
                <span>이번 달 사용</span>
                <strong>
                  {freebuff?.apiCredits
                    ? freebuff.apiCredits.usage.toLocaleString('ko-KR')
                    : '—'}
                </strong>
              </div>
              <div className="desk-credit-row">
                <span>다음 리셋까지</span>
                <strong>
                  {remainingUntilLabel(freebuff?.apiCredits?.nextResetAt) || '—'}
                </strong>
              </div>
              <div className="desk-credit-row muted">
                <span>컨텍스트 · 추론</span>
                <strong>세션 종료 시 터미널 표시</strong>
              </div>
              <div className="desk-freebuff-model-list">
                <div className="desk-freebuff-model-list-head">
                  <span>모델</span>
                  <span>1시간 세션</span>
                  <span>effort</span>
                </div>
                {FREEBUFF_MODELS.map((freebuffModel) => (
                  <div className="desk-freebuff-model-list-row" key={freebuffModel.id}>
                    <strong>{freebuffModel.label}</strong>
                    <span>{freebuffModel.hours}시간</span>
                    <span>{freebuffModel.effort}</span>
                  </div>
                ))}
                <p>/model은 Freebuff 네이티브 명령입니다.</p>
              </div>
              {freebuff?.note && <p className="desk-credit-note">{freebuff.note}</p>}
              {error && <p className="desk-credit-error">{error}</p>}
              <button className="desk-credit-refresh" onClick={() => void load(true)} disabled={loading}>
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
                Freebuff 다시 읽기
              </button>
            </div>
          </section>

          <section className="desk-credit-node">
            <div className="desk-credit-root">
              <span className="desk-credit-icon agy">
                <AgentMark id="antigravity" short="AGY" />
              </span>
              <div>
                <strong>Agy</strong>
                <span>Agy CLI /usage · 실제 구독 한도</span>
              </div>
              <span className="desk-credit-pill ok">{agyLoading ? '…' : 'live'}</span>
            </div>
            <div className="desk-credit-branch">
              {quota?.groups.length ? (
                quota.groups.map((group) => (
                  <div className="desk-credit-group" key={group.name}>
                    <div className="desk-credit-group-name">{group.name}</div>
                    {group.buckets.map((bucket) => (
                      <div className="desk-credit-bucket" key={`${group.name}-${bucket.id}-${bucket.window}`}>
                        <div>
                          <span>{bucket.window === '5h' ? '5시간' : bucket.window === 'weekly' ? '주간' : bucket.name}</span>
                          <strong>
                            {bucket.disabled
                              ? '미적용'
                              : bucket.remaining === null
                                ? '측정 없음'
                                : `${bucket.remaining}%`}
                          </strong>
                        </div>
                        <div className="desk-credit-bar">
                          <span style={{ width: `${bucket.remaining ?? 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <p className="desk-credit-note">
                  {quota?.error || (agyLoading ? 'Agy 한도를 불러오는 중…' : '표시할 Agy 한도가 없어요.')}
                </p>
              )}
              <button className="desk-credit-refresh" onClick={refreshAgy} disabled={agyLoading}>
                <RefreshCw size={12} className={agyLoading ? 'spin' : ''} />
                Agy 다시 읽기
              </button>
            </div>
          </section>

          <section className="desk-credit-node">
            <div className="desk-credit-root">
              <span className="desk-credit-icon codex">
                <AgentMark id="codex" short="CX" />
              </span>
              <div>
                <strong>Codex</strong>
                <span>Codex CLI · ChatGPT 계정 한도</span>
              </div>
              <span className={`desk-credit-pill ${codex?.plan ? 'ok' : 'warn'}`}>
                {codexLoading ? '…' : codex?.plan || '확인 불가'}
              </span>
            </div>
            <div className="desk-credit-branch">
              {codexLoading && !codex ? (
                <p className="desk-credit-note">Codex 계정 한도를 불러오는 중…</p>
              ) : codexError && !codex ? (
                <p className="desk-credit-error">{codexError}</p>
              ) : codexWindows.length ? (
                codexWindows.map((entry) => {
                  const window = entry.window as CodexQuotaWindow;
                  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
                  return (
                    <div className="desk-credit-bucket" key={entry.label}>
                      <div>
                        <span>{codexWindowLabel(window.windowDurationMins) || entry.label}</span>
                        <strong>{remaining}%</strong>
                      </div>
                      <div className="desk-credit-bar">
                        <span style={{ width: `${remaining}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="desk-credit-note">Codex CLI가 계정 한도 창을 반환하지 않았어요.</p>
              )}
              <div className="desk-credit-row">
                <span>모델</span>
                <strong>GPT-6 Luna</strong>
              </div>
              <div className="desk-credit-row">
                <span>컨텍스트</span>
                <strong>272k</strong>
              </div>
              {codexError && codex && <p className="desk-credit-error">{codexError}</p>}
              <button className="desk-credit-refresh" onClick={() => void loadCodex()} disabled={codexLoading}>
                <RefreshCw size={12} className={codexLoading ? 'spin' : ''} />
                Codex 다시 읽기
              </button>
            </div>
          </section>

          <section className="desk-credit-node">
            <div className="desk-credit-root">
              <span className="desk-credit-icon orca">
                <Boxes size={15} />
              </span>
              <div>
                <strong>Orca runtime</strong>
                <span>{overview?.host || 'local'} · worktree fleet</span>
              </div>
            </div>
            <div className="desk-credit-branch">
              <div className="desk-credit-row">
                <span>워크트리</span>
                <strong>{overview?.counts.worktrees ?? 0}</strong>
              </div>
              <div className="desk-credit-row">
                <span>등록된 에이전트</span>
                <strong>{overview?.counts.agents ?? 0}</strong>
              </div>
              <div className="desk-credit-row">
                <span>작업 중</span>
                <strong className="hot">{overview?.counts.working ?? 0}</strong>
              </div>
            </div>
          </section>
        </div>

        <div className="desk-drawer-foot">
          <button className="desk-btn ghost" onClick={refresh}>
            <RefreshCw size={13} /> 전체 새로고침
          </button>
          <span>값은 서버에서만 읽고 브라우저로 자격 증명을 보내지 않습니다.</span>
        </div>
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
            placeholder="/home/ubuntu/my-project"
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
